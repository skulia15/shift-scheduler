"""CP-SAT model that generates a roster for a Project."""

from __future__ import annotations

import math
import time

from ortools.sat.python import cp_model

from .context import Context, build_context
from .models import (
    Assignment,
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


class _Model:
    def __init__(self, ctx: Context, relax_coverage: bool):
        self.ctx = ctx
        self.m = cp_model.CpModel()
        self.objective: list[cp_model.LinearExprT] = []
        self.relax = relax_coverage
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
                if (s, d, t) in self.work and ctx.in_group(s, group):
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

        # Short rests are allowed only occasionally: a soft cap per Mon–Sun week.
        if rules.max_short_rests_per_week is not None:
            for s in range(S):
                for week in ctx.full_weeks():
                    used = [v for d in week for v in shorts.get((s, d), [])]
                    if len(used) > rules.max_short_rests_per_week:
                        self.soft_le(sum(used), rules.max_short_rests_per_week, False, w.short_rest_excess, len(used))

        overtimes: list[cp_model.IntVar] = []
        for s in range(S):
            if rules.max_consecutive_days is not None:
                k = rules.max_consecutive_days
                for d in range(D - k):
                    m.add(sum(self.day_work[s, d + i] for i in range(k + 1)) <= k)
            if rules.max_consecutive_nights is not None:
                k = rules.max_consecutive_nights
                nights = [t for t in range(T) if ctx.shifts[t].is_night]
                for d in range(D - k):
                    m.add(sum(self.work.get((s, d + i, t), 0) for i in range(k + 1) for t in nights) <= k)
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

            allowed = ctx.allowed_weekends()
            if allowed is not None:
                flags = []
                for wk in ctx.weekends():
                    flag = m.new_bool_var("")
                    for d in wk:
                        m.add(flag >= self.day_work[s, d])
                    flags.append(flag)
                self.soft_le(sum(flags), allowed, hard=False, weight=w.weekend_excess, ub=len(flags))

        if overtimes and w.overtime_spread:
            worst = m.new_int_var(0, D * 24 * 60, "worst_overtime")
            m.add_max_equality(worst, overtimes)
            self.penalise(worst, w.overtime_spread)

        self._custom_rules()
        m.minimize(sum(self.objective))

    def _off_if(self, s: int, d: int, literal: cp_model.IntVar) -> None:
        """literal ⇒ person s is off on day d (a no-op when they can't work that day anyway)."""
        expr = self.day_work[s, d]
        if not isinstance(expr, int):
            self.m.add(expr == 0).only_enforce_if(literal)

    def _weekly_rest(self, s: int, minutes: float) -> None:
        """Every 7-day window holds a day off whose surrounding rest is at least `minutes`."""
        ctx, m = self.ctx, self.m
        D = ctx.n_days
        rested: list[cp_model.IntVar] = []
        for x in range(D):
            r = m.new_bool_var(f"rest{s}_{x}")
            self._off_if(s, x, r)
            if 0 < x < D - 1:
                for t1 in ctx.eligible[s]:
                    a = self.work.get((s, x - 1, t1))
                    for t2 in ctx.eligible[s]:
                        b = self.work.get((s, x + 1, t2))
                        if a is not None and b is not None and ctx.rest_around(x, (x - 1, t1), (x + 1, t2)) < minutes:
                            m.add_bool_or([r.Not(), a.Not(), b.Not()])
            rested.append(r)
        for start in range(D - 6):
            m.add(sum(rested[start : start + 7]) >= 1)

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
            )
            for (s, d, t), var in sorted(self.work.items())
            if solver.value(var)
        ]


def _run(ctx: Context, relax: bool, seconds: float) -> tuple[int, _Model, cp_model.CpSolver]:
    model = _Model(ctx, relax_coverage=relax)
    model.build()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_workers = 8
    status = solver.solve(model.m)
    return status, model, solver


def solve(project: Project) -> SolveResult:
    started = time.monotonic()
    ctx = build_context(project)
    status, model, solver = _run(ctx, relax=False, seconds=project.solve_seconds)
    label, message = "optimal", "Optimal roster found."
    if status == cp_model.FEASIBLE:
        label, message = "feasible", "Good roster found within the time limit (may not be optimal)."
    elif status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Hard coverage cannot be met (or not proven in time): plan with gaps instead of nothing.
        status, model, solver = _run(ctx, relax=True, seconds=project.solve_seconds)
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
    evaluation = evaluate(project, roster)
    return SolveResult(
        status=label,
        message=message,
        roster=roster,
        objective=solver.objective_value,
        solve_seconds=round(time.monotonic() - started, 2),
        **evaluation.model_dump(),
    )
