"""CP-SAT model that generates a roster for a Project."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import date

from ortools.sat.python import cp_model

from .context import Context, build_context
from .models import (
    Assignment,
    Change,
    AvoidTaskRepeatRule,
    DiverseShiftsRule,
    FixedAreaRule,
    ForbidSequenceRule,
    MaxShiftTypeRule,
    Project,
    RotateTaskEvenlyRule,
    SolveResult,
)
from .validator import evaluate, rotation_targets

# Non-hour weights are per occurrence; hour terms are per minute × weight. Scale the former so an
# occurrence weight of 1 equals one hour of deviation at weight 1.
OCCURRENCE = 60
# Rotation targets are fractional; work in tenths.
ROTATION_SCALE = 10


@dataclass
class Repair:
    """A published roster to change as little as possible. Days before `today` and locked shifts are fixed."""

    base: dict[tuple[int, int], Assignment]  # (staff, day) -> shift
    today: int  # day index; may lie before or after the period
    keep_unlocked: bool = True  # False = regenerate: unlocked shifts and past days are free

    def notice(self, day: int) -> int:
        return day - self.today

    def cost(self, day: int, w) -> int:
        notice = self.notice(day)
        return w.change_day if notice <= 1 else w.change_week if notice <= 7 else w.change

    @staticmethod
    def fee_percent(notice: int) -> float:
        return 2.0 if notice <= 1 else 1.3 if notice <= 7 else 0.0


class _Model:
    def __init__(self, ctx: Context, relax_coverage: bool, repair: Repair | None = None):
        self.ctx = ctx
        self.m = cp_model.CpModel()
        self.objective: list[cp_model.LinearExprT] = []
        self.relax = relax_coverage
        self.repair = repair
        self.work: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.task: dict[tuple[int, int, int, str], cp_model.IntVar] = {}
        self.day_work: dict[tuple[int, int], cp_model.LinearExprT] = {}
        self.area: dict[tuple[int, int, int, str], cp_model.IntVar] = {}

    def penalise(self, expr: cp_model.LinearExprT, weight: int) -> None:
        if weight:
            self.objective.append(expr * weight)

    def soft_le(self, expr: cp_model.LinearExprT, bound: int, hard: bool, weight: int, ub: int) -> None:
        """expr <= bound, either strictly or with `weight` per unit of excess."""
        if hard:
            self.m.add(expr <= bound)
        else:
            excess = self.m.new_int_var(0, max(0, ub), "")
            self.m.add(expr - bound <= excess)
            self.penalise(excess, weight * OCCURRENCE)

    def build(self) -> None:
        ctx, m = self.ctx, self.m
        S, D, T = len(ctx.staff), ctx.n_days, len(ctx.shifts)
        w = ctx.project.weights
        rules = ctx.project.rules

        for s in range(S):
            for d in range(D):
                if (s, d) in ctx.blocked:
                    continue
                for t in ctx.eligible[s]:
                    self.work[s, d, t] = m.new_bool_var(f"w{s}_{d}_{t}")
        for s in range(S):
            for d in range(D):
                self.day_work[s, d] = sum(self.work.get((s, d, t), 0) for t in range(T))
                m.add(self.day_work[s, d] <= 1)

        # Tasks: one per person per shift, only for members of the task's group on that shift.
        for (d, t, task_id), _need in ctx.task_need.items():
            group = ctx.task_group[task_id]
            for s in range(S):
                if (s, d, t) in self.work and ctx.in_group(s, group) and ctx.has_competence(s, ctx.task_competence[task_id]):
                    var = m.new_bool_var(f"k{s}_{d}_{t}_{task_id}")
                    m.add_implication(var, self.work[s, d, t])
                    self.task[s, d, t, task_id] = var
        per_shift: dict[tuple[int, int, int], list[cp_model.IntVar]] = {}
        for (s, d, t, _), var in self.task.items():
            per_shift.setdefault((s, d, t), []).append(var)
        for vars_ in per_shift.values():
            m.add_at_most_one(vars_)

        # Coverage and task headcount.
        for (d, t, group_id), (lo, hi) in ctx.coverage.items():
            n = sum(var for (s, dd, tt), var in self.work.items() if dd == d and tt == t and ctx.in_group(s, group_id))
            self._at_least(n, lo)
            if hi is not None:
                m.add(n <= hi)
            if lo:
                over = m.new_int_var(0, S, "")
                m.add(n - lo <= over)
                self.penalise(over, w.overstaff * OCCURRENCE)
        for (d, t, task_id), need in ctx.task_need.items():
            n = sum(var for (s, dd, tt, k), var in self.task.items() if dd == d and tt == t and k == task_id)
            self._at_least(n, need)
            m.add(n <= need)

        # Areas: everyone working where areas apply is placed in exactly one.
        for (s, d, t), var in self.work.items():
            if not ctx.needs_area(s, d, t):
                continue
            for a in ctx.area_candidates(s, d, t):
                self.area[s, d, t, a] = m.new_bool_var(f"a{s}_{d}_{t}_{a}")
            m.add(sum(self.area[s, d, t, a] for a in ctx.area_candidates(s, d, t)) == var)
        for (d, t, area_id, group_id), (lo, hi) in ctx.area_need.items():
            n = sum(v for (s, dd, tt, a), v in self.area.items() if dd == d and tt == t and a == area_id and ctx.in_group(s, group_id))
            self._at_least(n, lo)
            if hi is not None:
                m.add(n <= hi)

        # Competences: enough people with a skill on the shift (or in an area of it).
        for (d, t, comp, area_id), lo in ctx.competence_need.items():
            if area_id is None:
                n = sum(v for (s, dd, tt), v in self.work.items() if dd == d and tt == t and ctx.has_competence(s, comp))
            else:
                n = sum(
                    v for (s, dd, tt, a), v in self.area.items() if dd == d and tt == t and a == area_id and ctx.has_competence(s, comp)
                )
            self._at_least(n, lo)

        # Rest between consecutive shifts.
        shorts: dict[tuple[int, int], list[cp_model.IntVar]] = {}  # (staff, day of the later shift)
        for s in range(S):
            for d in range(D - 1):
                for t1 in ctx.eligible[s]:
                    a = self.work.get((s, d, t1))
                    if a is None:
                        continue
                    for t2 in ctx.eligible[s]:
                        b = self.work.get((s, d + 1, t2))
                        if b is None:
                            continue
                        rest = ctx.rest_minutes(d, t1, d + 1, t2)
                        if rest < rules.min_rest_hours_absolute * 60:
                            m.add_bool_or([a.Not(), b.Not()])
                        elif rest < rules.min_rest_hours * 60:
                            short = m.new_bool_var("")
                            m.add_bool_or([a.Not(), b.Not(), short])
                            self.penalise(short, w.short_rest * OCCURRENCE)
                            shorts.setdefault((s, d + 1), []).append(short)
            # The previous roster's last shift against day 0.
            t1 = ctx.history.get((s, -1))
            if t1 is not None:
                for t2 in ctx.eligible[s]:
                    b = self.work.get((s, 0, t2))
                    if b is None:
                        continue
                    rest = ctx.rest_minutes(-1, t1, 0, t2)
                    if rest < rules.min_rest_hours_absolute * 60:
                        m.add(b == 0)
                    elif rest < rules.min_rest_hours * 60:
                        self.penalise(b, w.short_rest * OCCURRENCE)
                        shorts.setdefault((s, 0), []).append(b)

        # Short rests are allowed only occasionally: a soft cap per Mon–Sun week.
        if rules.max_short_rests_per_week is not None:
            for s in range(S):
                for week in ctx.full_weeks():
                    used = [v for d in week for v in shorts.get((s, d), [])]
                    if len(used) > rules.max_short_rests_per_week:
                        self.soft_le(sum(used), rules.max_short_rests_per_week, False, w.short_rest_excess, len(used))

        overtimes: list[cp_model.IntVar] = []
        weekends_worked: dict[int, cp_model.LinearExprT] = {}
        holiday_load: dict[int, cp_model.LinearExprT] = {}
        for s in range(S):
            H = ctx.history_days
            if rules.max_consecutive_days is not None:
                k = rules.max_consecutive_days
                for d in range(-min(H, k), D - k):
                    m.add(sum(self._day(s, d + i) for i in range(k + 1)) <= k)
            if rules.max_consecutive_nights is not None:
                k = rules.max_consecutive_nights
                nights = [t for t in range(T) if ctx.shifts[t].is_night]
                for d in range(-min(H, k), D - k):
                    m.add(sum(self._lit(s, d + i, t) for i in range(k + 1) for t in nights) <= k)
            if rules.weekly_rest_hours is not None:
                self._weekly_rest(s, rules.weekly_rest_hours * 60)
            if rules.days_off_per_week:
                self._days_off(s)

            worked = sum(var * ctx.paid[t] for (ss, _, t), var in self.work.items() if ss == s)
            weighted = sum(var * ctx.credited[d, t] for (ss, d, t), var in self.work.items() if ss == s)
            credited = weighted
            if rules.min_actual_weekly_hours:
                # Weighting may not take actual hours below the floor: credit = min(weighted, worked × full/floor).
                full, floor = round(rules.full_time_weekly_hours * 100), round(rules.min_actual_weekly_hours * 100)
                horizon = D * 24 * 60 * 2
                cap = m.new_int_var(0, horizon, f"cap{s}")
                m.add(cap * floor <= worked * full)
                m.add(cap * floor > worked * full - floor)
                credited = m.new_int_var(0, horizon, f"credited{s}")
                m.add_min_equality(credited, [weighted, cap])
            if rules.max_avg_weekly_hours is not None:
                m.add(worked <= math.floor(rules.max_avg_weekly_hours * 60 * D / 7))
            target = ctx.target_minutes[s]
            horizon = D * 24 * 60
            over = m.new_int_var(0, horizon, f"over{s}")
            under = m.new_int_var(0, horizon, f"under{s}")
            m.add(credited - target == over - under)
            if rules.max_overtime_hours is not None:
                m.add(over <= round(rules.max_overtime_hours * 60))
            self.penalise(over, w.overtime_hours)
            overtimes.append(over)
            self.penalise(under, w.under_hours)

            for d in range(D):
                if (s, d) in ctx.request:
                    self.penalise(self.day_work[s, d], w.request_denied * OCCURRENCE)

            flags = []
            for wk in ctx.weekends():
                flag = m.new_bool_var("")
                for d in wk:
                    m.add(flag >= self.day_work[s, d])
                flags.append(flag)
            weekends_worked[s] = sum(flags)
            allowed = ctx.allowed_weekends()
            if allowed is not None:
                self.soft_le(sum(flags), allowed, hard=False, weight=w.weekend_excess, ub=len(flags))
            holiday_load[s] = sum(self.day_work[s, d] * (2 if d in ctx.major_days else 1) for d in ctx.holiday_days)

        # Fairness over time: the most-loaded person's running total (earlier periods + this one, per 100% FTE).
        self._fair_share(weekends_worked, lambda e: e.weekends, w.weekend_fairness, len(ctx.weekends()))
        if ctx.holiday_days:
            self._fair_share(holiday_load, lambda e: e.holiday_shifts + e.major_holiday_shifts, w.holiday_fairness, 2 * len(ctx.holiday_days))

        if overtimes and w.overtime_spread:
            worst = m.new_int_var(0, D * 24 * 60, "worst_overtime")
            m.add_max_equality(worst, overtimes)
            self.penalise(worst, w.overtime_spread)

        if self.repair:
            self._repair_costs()
        self._custom_rules()
        m.minimize(sum(self.objective))

    def _off_if(self, s: int, d: int, literal: cp_model.IntVar) -> None:
        """literal ⇒ person s is off on day d (a no-op when they can't work that day anyway)."""
        expr = self.day_work[s, d]
        if not isinstance(expr, int):
            self.m.add(expr == 0).only_enforce_if(literal)

    def _repair_costs(self) -> None:
        """Keep the published roster: past days and locked shifts are fixed; every other change costs
        more the shorter the notice."""
        ctx, m, w, rep = self.ctx, self.m, self.ctx.project.weights, self.repair
        for (s, d, t), var in self.work.items():
            base = rep.base.get((s, d))
            same = base is not None and ctx.shift_index.get(base.shift_id) == t
            frozen = (base is not None and base.locked) or (rep.keep_unlocked and d < rep.today)
            if frozen:
                m.add(var == int(same))
                continue
            if not rep.keep_unlocked:
                continue
            if same:
                self.penalise(1 - var, rep.cost(d, w) * OCCURRENCE)
                if base.area_id and (s, d, t, base.area_id) in self.area:
                    self.penalise(var - self.area[s, d, t, base.area_id], w.change_detail * OCCURRENCE)
                for k in base.task_ids:
                    if (s, d, t, k) in self.task:
                        self.penalise(var - self.task[s, d, t, k], w.change_detail * OCCURRENCE)
            else:
                self.penalise(var, rep.cost(d, w) * OCCURRENCE)
        # Fixed shifts keep their area and tasks too.
        for (s, d), base in rep.base.items():
            t = ctx.shift_index.get(base.shift_id)
            if t is None or not (base.locked or (rep.keep_unlocked and d < rep.today)):
                continue
            if base.area_id and (s, d, t, base.area_id) in self.area:
                m.add(self.area[s, d, t, base.area_id] == self.work[s, d, t])
            for k in base.task_ids:
                if (s, d, t, k) in self.task:
                    m.add(self.task[s, d, t, k] == self.work[s, d, t])

    def _fair_share(self, current: dict[int, cp_model.LinearExprT], prior_of, weight: int, max_now: int) -> None:
        """Per staff group, penalise the highest (prior + current) load per 100% FTE."""
        ctx, m = self.ctx, self.m
        if not weight:
            return
        for g in ctx.project.groups:
            loads, ub = [], 1
            for s, member in enumerate(ctx.staff):
                if member.group_ids[:1] != [g.id] or member.employment_percent <= 0:
                    continue
                prior = prior_of(ctx.prior[s]) if s in ctx.prior else 0
                scale = round(1000 / member.employment_percent)  # tenths of a unit per 100% FTE
                loads.append((prior + current[s]) * scale)
                ub = max(ub, (prior + max_now) * scale)
            if len(loads) < 2:
                continue
            worst = m.new_int_var(0, ub, "")
            for load in loads:
                m.add(worst >= load)
            self.penalise(worst, weight * OCCURRENCE // 10 or 1)

    def _lit(self, s: int, d: int, t: int):
        """Works shift t on day d: a variable inside the period, a 0/1 constant from history before it."""
        if d < 0:
            return int(self.ctx.history.get((s, d)) == t)
        return self.work.get((s, d, t), 0)

    def _day(self, s: int, d: int):
        if d < 0:
            return int((s, d) in self.ctx.history)
        return self.day_work[s, d]

    def _weekly_rest(self, s: int, minutes: float) -> None:
        """Every 7-day window (reaching back into history) holds a day off with ≥ `minutes` rest around it."""
        ctx, m = self.ctx, self.m
        D, H, T = ctx.n_days, ctx.history_days, len(ctx.shifts)
        rested: dict[int, cp_model.LinearExprT] = {}
        for x in range(-H, D):
            if x < 0 and (s, x) in ctx.history:
                rested[x] = 0
                continue
            r = m.new_bool_var(f"rest{s}_{x}")
            if x >= 0:
                self._off_if(s, x, r)
            if -H < x < D - 1:
                for t1 in range(T):
                    a = self._lit(s, x - 1, t1)
                    if isinstance(a, int) and a == 0:
                        continue
                    for t2 in range(T):
                        b = self._lit(s, x + 1, t2)
                        if isinstance(b, int) and b == 0:
                            continue
                        if ctx.rest_around(x, (x - 1, t1), (x + 1, t2)) < minutes:
                            m.add_bool_or([r.Not()] + [lit.Not() for lit in (a, b) if not isinstance(lit, int)])
            rested[x] = r
        for start in range(-H, D - 6):
            if start + 6 >= 0:
                m.add(sum(rested[x] for x in range(start, start + 7)) >= 1)

    def _days_off(self, s: int) -> None:
        """Expected days off per Mon–Sun week, consecutive if required; hard or soft."""
        ctx, m, rules = self.ctx, self.m, self.ctx.project.rules
        need = rules.days_off_per_week or 0
        for week in ctx.full_weeks():
            ok = m.new_bool_var("")
            worked = sum(self.day_work[s, d] for d in week)
            if not isinstance(worked, int):
                m.add(worked <= 7 - need).only_enforce_if(ok)
            if rules.days_off_consecutive and need >= 2:
                pairs = []
                for d in week[:-1]:
                    pair = m.new_bool_var("")
                    self._off_if(s, d, pair)
                    self._off_if(s, d + 1, pair)
                    pairs.append(pair)
                m.add_bool_or(pairs).only_enforce_if(ok)
            if rules.days_off_hard:
                m.add(ok == 1)
            else:
                self.penalise(1 - ok, ctx.project.weights.days_off * OCCURRENCE)

    def _at_least(self, expr: cp_model.LinearExprT, bound: int) -> None:
        if not bound:
            return
        if self.relax:
            short = self.m.new_int_var(0, bound, "")
            self.m.add(expr + short >= bound)
            self.penalise(short, self.ctx.project.weights.coverage_shortfall * OCCURRENCE)
        else:
            self.m.add(expr >= bound)

    def _task_count(self, s: int, task_id: str, days: range | None = None) -> cp_model.LinearExprT:
        return sum(var for (ss, d, _, k), var in self.task.items() if ss == s and k == task_id and (days is None or d in days))

    def _custom_rules(self) -> None:
        ctx, m = self.ctx, self.m
        S, D = len(ctx.staff), ctx.n_days
        for rule in ctx.project.custom_rules:
            if not rule.enabled:
                continue
            members = [s for s in range(S) if getattr(rule, "group_id", None) is None or ctx.in_group(s, rule.group_id)]

            if isinstance(rule, AvoidTaskRepeatRule):
                for s in members:
                    for start in range(max(1, D - rule.window_days + 1)):
                        window = range(start, min(D, start + rule.window_days))
                        self.soft_le(self._task_count(s, rule.task_id, window), rule.max_count, rule.hard, rule.weight, len(window))

            elif isinstance(rule, RotateTaskEvenlyRule):
                for s, target in rotation_targets(ctx, rule).items():
                    scaled = self._task_count(s, rule.task_id) * ROTATION_SCALE
                    goal = round(target * ROTATION_SCALE)
                    dev = m.new_int_var(0, D * ROTATION_SCALE * 4, "")
                    m.add_abs_equality(dev, scaled - goal)
                    if rule.hard:
                        m.add(dev <= ROTATION_SCALE)
                    else:
                        self.penalise(dev, rule.weight * OCCURRENCE // ROTATION_SCALE or 1)

            elif isinstance(rule, MaxShiftTypeRule):
                t = ctx.shift_index[rule.shift_id]
                for s in members:
                    n = sum(self.work.get((s, d, t), 0) for d in range(D))
                    self.soft_le(n, rule.max_count, rule.hard, rule.weight, D)

            elif isinstance(rule, FixedAreaRule):
                s = ctx.staff_index[rule.staff_id]
                for (ss, _, _, a), v in self.area.items():
                    if ss == s and a != rule.area_id:
                        if rule.hard:
                            m.add(v == 0)
                        else:
                            self.penalise(v, rule.weight * OCCURRENCE)

            elif isinstance(rule, DiverseShiftsRule):
                s = ctx.staff_index[rule.staff_id]
                types = [t for t in sorted(ctx.eligible[s]) if rule.shift_ids is None or ctx.shifts[t].id in rule.shift_ids]
                if len(types) < 2:
                    continue
                counts = [sum(self.work.get((s, d, t), 0) for d in range(D)) for t in types]
                hi, lo = m.new_int_var(0, D, ""), m.new_int_var(0, D, "")
                m.add_max_equality(hi, counts)
                m.add_min_equality(lo, counts)
                if rule.hard:
                    m.add(hi - lo <= 1)
                else:
                    self.penalise(hi - lo, rule.weight * OCCURRENCE)

            elif isinstance(rule, ForbidSequenceRule):
                a, b = ctx.shift_index[rule.from_shift_id], ctx.shift_index[rule.to_shift_id]
                for s in members:
                    for d in range(D - 1):
                        x, y = self.work.get((s, d, a)), self.work.get((s, d + 1, b))
                        if x is None or y is None:
                            continue
                        self.soft_le(x + y, 1, rule.hard, rule.weight, 1)

    def roster(self, solver: cp_model.CpSolver) -> list[Assignment]:
        ctx = self.ctx
        tasks: dict[tuple[int, int, int], list[str]] = {}
        for (s, d, t, k), var in self.task.items():
            if solver.value(var):
                tasks.setdefault((s, d, t), []).append(k)
        areas = {(s, d, t): a for (s, d, t, a), var in self.area.items() if solver.value(var)}
        return [
            Assignment(
                staff_id=ctx.staff[s].id,
                date=ctx.dates[d],
                shift_id=ctx.shifts[t].id,
                task_ids=tasks.get((s, d, t), []),
                area_id=areas.get((s, d, t)),
                locked=bool(self.repair and (b := self.repair.base.get((s, d))) and b.locked and b.shift_id == ctx.shifts[t].id),
            )
            for (s, d, t), var in sorted(self.work.items())
            if solver.value(var)
        ]


def _run(ctx: Context, relax: bool, seconds: float, repair: Repair | None = None) -> tuple[int, _Model, cp_model.CpSolver]:
    model = _Model(ctx, relax_coverage=relax, repair=repair)
    model.build()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_workers = 8
    status = solver.solve(model.m)
    return status, model, solver


def solve(project: Project, lang: str = "en") -> SolveResult:
    return _solve(project, None, lang)


def repair(project: Project, roster: list[Assignment], today: date, mode: str = "repair", lang: str = "en") -> SolveResult:
    """Repair: fix the roster's problems with as few, as late-noticed changes as possible.
    Regenerate: keep only locked shifts and re-plan the rest; changes are still listed."""
    ctx = build_context(project)
    base = {
        (ctx.staff_index[a.staff_id], ctx.day_of[a.date]): a
        for a in roster
        if a.staff_id in ctx.staff_index and a.date in ctx.day_of
    }
    rep = Repair(base=base, today=(today - ctx.dates[0]).days, keep_unlocked=mode == "repair")
    result = _solve(project, rep, lang)
    if result.status == "failed":
        result.message = "No roster keeps every locked shift within the hard rules. Unlock some shifts and repair again."
        return result
    before = {(a.staff_id, a.date): a.shift_id for a in roster}
    after = {(a.staff_id, a.date): a.shift_id for a in result.roster}
    changes = []
    for key in sorted(set(before) | set(after), key=lambda k: (k[1], k[0])):
        if before.get(key) != after.get(key):
            notice = rep.notice(ctx.day_of[key[1]])
            changes.append(
                Change(
                    staff_id=key[0], date=key[1], before=before.get(key), after=after.get(key), notice_days=notice, fee_percent=Repair.fee_percent(notice)
                )
            )
    result.changes = changes
    n = len(changes)
    if mode == "regenerate":
        result.message = f"Regenerated; {n} cell{'s' if n != 1 else ''} changed."
    else:
        result.message = "No changes needed." if n == 0 else f"Repaired with {n} change{'s' if n > 1 else ''}."
    return result


def _solve(project: Project, rep: Repair | None, lang: str = "en") -> SolveResult:
    started = time.monotonic()
    ctx = build_context(project)
    status, model, solver = _run(ctx, relax=False, seconds=project.solve_seconds, repair=rep)
    label, message = "optimal", "Optimal roster found."
    if status == cp_model.FEASIBLE:
        label, message = "feasible", "Good roster found within the time limit (may not be optimal)."
    elif status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Hard coverage cannot be met (or not proven in time): plan with gaps instead of nothing.
        status, model, solver = _run(ctx, relax=True, seconds=project.solve_seconds, repair=rep)
        label = "relaxed"
        message = "Demand cannot be fully covered under the rules; roster shows the gaps as coverage errors."
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return SolveResult(
                status="failed",
                message="No roster found. Check that hard custom rules do not contradict each other.",
                roster=[],
                violations=[],
                staff=[],
                coverage=[],
                solve_seconds=round(time.monotonic() - started, 2),
            )

    roster = model.roster(solver)
    evaluation = evaluate(project, roster, lang)
    return SolveResult(
        status=label,
        message=message,
        roster=roster,
        objective=solver.objective_value,
        solve_seconds=round(time.monotonic() - started, 2),
        **evaluation.model_dump(),
    )
