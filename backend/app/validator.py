"""Checks any roster — generated or hand-edited — against a Project's rules.

Kept independent of the solver's model so it can serve as the solver's test oracle.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from .context import Context, build_context
from .messages import message
from .models import (
    Assignment,
    AvoidTaskRepeatRule,
    CoverageCell,
    DiverseShiftsRule,
    FixedAreaRule,
    Evaluation,
    ForbidSequenceRule,
    MaxShiftTypeRule,
    Project,
    RotateTaskEvenlyRule,
    StaffStats,
    Violation,
)


def rotation_targets(ctx: Context, rule: RotateTaskEvenlyRule) -> dict[int, float]:
    """Fair share of a task per group member, by availability (and employment % if proportional)."""
    need = {(d, t): n for (d, t, task_id), n in ctx.task_need.items() if task_id == rule.task_id}
    total = sum(need.values())
    weights: dict[int, float] = {}
    for s, member in enumerate(ctx.staff):
        if rule.group_id not in member.group_ids:
            continue
        # Days on which this person could do the task at all (not on leave, allowed on a shift needing it).
        available = sum(
            1 for d in range(ctx.n_days) if (s, d) not in ctx.blocked and any((d, t) in need for t in ctx.eligible[s])
        )
        weight = available / ctx.n_days
        if rule.proportional_to_employment:
            weight *= member.employment_percent / 100
        if weight > 0:
            weights[s] = weight
    norm = sum(weights.values())
    return {s: total * w / norm for s, w in weights.items()} if norm else {}


def _runs(days: list[int]) -> list[list[int]]:
    """Group sorted day indices into runs of consecutive days."""
    runs: list[list[int]] = []
    for d in days:
        if runs and runs[-1][-1] == d - 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    return runs


def _h(hours: float) -> str:
    """Hours for messages: 8, 7.5."""
    return f"{hours:.1f}".rstrip("0").rstrip(".")


def evaluate(project: Project, roster: list[Assignment], lang: str = "en") -> Evaluation:
    ctx = build_context(project)
    rules = project.rules

    def M(template: str, **kw) -> str:
        return message(lang, template, **kw)

    task_name = {t.id: t.name for t in project.tasks}
    group_name = {g.id: g.name for g in project.groups}
    area_name = {a.id: a.name for a in project.areas}
    shift_name = {sh.id: sh.name for sh in project.shift_types}
    competence_name = {c.id: c.name for c in project.competences}
    out: list[Violation] = []

    def v(rule: str, severity: str, message: str, s: int | None = None, d: int | None = None, t: int | None = None):
        out.append(
            Violation(
                rule=rule,
                severity=severity,  # type: ignore[arg-type]
                message=message,
                staff_id=ctx.staff[s].id if s is not None else None,
                date=ctx.dates[d] if d is not None else None,
                shift_id=ctx.shifts[t].id if t is not None else None,
            )
        )

    # (staff, day) -> (shift, tasks)
    work: dict[tuple[int, int], tuple[int, list[str]]] = {}
    area_of: dict[tuple[int, int], str | None] = {}
    for a in roster:
        s, d, t = ctx.staff_index.get(a.staff_id), ctx.day_of.get(a.date), ctx.shift_index.get(a.shift_id)
        if s is None or d is None or t is None:
            out.append(Violation(rule="unknown_reference", severity="error", message=M("Unknown person, date or shift in {what}", what=f"{a.staff_id} {a.date} {a.shift_id}")))
            continue
        if (s, d) in work:
            v("one_shift_per_day", "error", M("{name} has more than one shift", name=ctx.staff[s].name), s, d, t)
            continue
        work[(s, d)] = (t, a.task_ids)
        area_of[(s, d)] = a.area_id

    for (s, d), (t, tasks) in work.items():
        name = ctx.staff[s].name
        if t not in ctx.eligible[s]:
            v("eligibility", "error", M("{name} may not work {shift}", name=name, shift=ctx.shifts[t].name), s, d, t)
        if (s, d) in ctx.blocked:
            v("leave", "error", M("{name} is on leave or a granted day off", name=name), s, d, t)
        elif (s, d) in ctx.request:
            v("request_denied", "warning", M("{name} asked for this day off", name=name), s, d, t)
        for task_id in tasks:
            if task_id not in ctx.task_group:
                v("unknown_reference", "error", M("Unknown task {task}", task=task_id), s, d, t)
            elif not ctx.in_group(s, ctx.task_group[task_id]):
                v("task_group", "error", M("{name} is not in the group that does {task}", name=name, task=task_name.get(task_id, task_id)), s, d, t)
            elif not ctx.has_competence(s, ctx.task_competence[task_id]):
                v("task_competence", "error", M("{name} lacks {skill}, needed for {task}", name=name, skill=competence_name.get(ctx.task_competence[task_id], ctx.task_competence[task_id]), task=task_name.get(task_id, task_id)), s, d, t)
        area = area_of[(s, d)]
        if area is not None and area not in {x.id for x in ctx.project.areas}:
            v("unknown_reference", "error", M("Unknown area {area}", area=area), s, d, t)
        elif area is None and ctx.needs_area(s, d, t):
            v("area_missing", "error", M("{name} has no area on this shift", name=name), s, d, t)
        if len(tasks) > 1:
            v("one_task_per_shift", "error", M("{name} has {n} tasks on one shift", name=name, n=len(tasks)), s, d, t)

    # Shift types outside the normal length (a local agreement is needed).
    used_types = {t for (t, _) in work.values()}
    for t in sorted(used_types):
        hours = ctx.shifts[t].paid_minutes / 60
        if rules.min_shift_hours is not None and hours < rules.min_shift_hours:
            v("shift_length", "warning", M("{shift} is {h} h, shorter than {limit} h", shift=ctx.shifts[t].name, h=f"{hours:g}", limit=f"{rules.min_shift_hours:g}"), t=t)
        if rules.normal_max_shift_hours is not None and hours > rules.normal_max_shift_hours:
            v("shift_length", "warning", M("{shift} is {h} h, longer than the normal {limit} h", shift=ctx.shifts[t].name, h=f"{hours:g}", limit=f"{rules.normal_max_shift_hours:g}"), t=t)

    # Coverage
    cells: list[CoverageCell] = []
    for (d, t, group_id), (lo, hi) in sorted(ctx.coverage.items()):
        n = sum(1 for (s, dd), (tt, _) in work.items() if dd == d and tt == t and ctx.in_group(s, group_id))
        cells.append(CoverageCell(date=ctx.dates[d], shift_id=ctx.shifts[t].id, group_id=group_id, required=lo, assigned=n))
        if n < lo:
            v("coverage", "error", M("{group}: {n} of {need} required", group=group_name.get(group_id, group_id), n=n, need=lo), d=d, t=t)
        if hi is not None and n > hi:
            v("coverage", "error", M("{group}: {n}, more than the maximum {max}", group=group_name.get(group_id, group_id), n=n, max=hi), d=d, t=t)

    for (d, t, area_id, group_id), (lo, hi) in sorted(ctx.area_need.items()):
        n = sum(
            1 for (s, dd), (tt, _) in work.items() if dd == d and tt == t and area_of[(s, dd)] == area_id and ctx.in_group(s, group_id)
        )
        cells.append(
            CoverageCell(date=ctx.dates[d], shift_id=ctx.shifts[t].id, group_id=group_id, area_id=area_id, required=lo, assigned=n)
        )
        if n < lo:
            v("area_coverage", "error", M("{area}, {group}: {n} of {need} required", area=area_name.get(area_id, area_id), group=group_name.get(group_id, group_id), n=n, need=lo), d=d, t=t)
        if hi is not None and n > hi:
            v("area_coverage", "error", M("{area}, {group}: {n}, more than the maximum {max}", area=area_name.get(area_id, area_id), group=group_name.get(group_id, group_id), n=n, max=hi), d=d, t=t)

    for (d, t, comp, area_id), lo in sorted(ctx.competence_need.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2], kv[0][3] or "")):
        n = sum(
            1
            for (s, dd), (tt, _) in work.items()
            if dd == d and tt == t and ctx.has_competence(s, comp) and (area_id is None or area_of[(s, dd)] == area_id)
        )
        cells.append(
            CoverageCell(date=ctx.dates[d], shift_id=ctx.shifts[t].id, competence_id=comp, area_id=area_id, required=lo, assigned=n)
        )
        if n < lo:
            where = f" in {area_id}" if area_id else ""
            v("competence", "error", (M("{skill} in {area}: {n} of {need} required", skill=competence_name.get(comp, comp), area=area_name.get(area_id, area_id), n=n, need=lo) if area_id else M("{skill}: {n} of {need} required", skill=competence_name.get(comp, comp), n=n, need=lo)), d=d, t=t)

    if rules.lone_night_warning:
        for d in range(ctx.n_days):
            for t, shift in enumerate(ctx.shifts):
                if shift.is_night and sum(1 for (_, dd), (tt, _) in work.items() if dd == d and tt == t) == 1:
                    v("lone_night", "warning", M("Only one person on {shift}: a safety assessment is required", shift=shift.name), d=d, t=t)

    task_done: Counter[tuple[int, int, str]] = Counter()
    for (s, d), (t, tasks) in work.items():
        for task_id in tasks:
            task_done[(d, t, task_id)] += 1
    for key in set(ctx.task_need) | set(task_done):
        d, t, task_id = key
        need, done = ctx.task_need.get(key, 0), task_done.get(key, 0)
        if done < need:
            v("task_coverage", "error", M("{task}: {n} of {need} assigned", task=task_name.get(task_id, task_id), n=done, need=need), d=d, t=t)
        elif done > need:
            v("task_coverage", "warning", M("{task}: {n} assigned, {need} needed", task=task_name.get(task_id, task_id), n=done, need=need), d=d, t=t)

    # Per-person working-time rules
    stats: list[StaffStats] = []
    weekends = ctx.weekends()
    allowed_weekends = ctx.allowed_weekends()
    for s, member in enumerate(ctx.staff):
        mine = sorted((d, t, tasks) for (ss, d), (t, tasks) in work.items() if ss == s)
        days = [d for d, _, _ in mine]
        name = member.name
        # The previous roster's last days take part in rest and run checks; only this period is reported.
        past = sorted((d, t, []) for (ss, d), t in ctx.history.items() if ss == s)
        seq = past + mine
        seq_days = [d for d, _, _ in seq]

        short_days: list[int] = []
        for (d1, t1, _), (d2, t2, _) in zip(seq, seq[1:]):
            if d2 < 0:
                continue
            rest = ctx.rest_minutes(d1, t1, d2, t2)
            if rest < rules.min_rest_hours_absolute * 60:
                v("rest", "error", M("{name}: only {h} h rest (minimum {limit} h)", name=name, h=_h(rest / 60), limit=_h(rules.min_rest_hours_absolute)), s, d2, t2)
            elif rest < rules.min_rest_hours * 60:
                v("short_rest", "warning", M("{name}: {h} h rest (target {limit} h)", name=name, h=_h(rest / 60), limit=_h(rules.min_rest_hours)), s, d2, t2)
                short_days.append(d2)
        if rules.max_short_rests_per_week is not None:
            for week in ctx.full_weeks():
                n = sum(1 for d in short_days if d in week)
                if n > rules.max_short_rests_per_week:
                    v("short_rest_week", "warning", M("{name}: {n} short rests in one week (max {max})", name=name, n=n, max=rules.max_short_rests_per_week), s, week[0])

        if rules.max_consecutive_days is not None:
            for run in _runs(seq_days):
                if len(run) > rules.max_consecutive_days and run[-1] >= 0:
                    v("consecutive_days", "error", M("{name}: {n} days in a row (max {max})", name=name, n=len(run), max=rules.max_consecutive_days), s, max(run[0], 0))

        if rules.max_consecutive_nights is not None:
            nights = [d for d, t, _ in seq if ctx.shifts[t].is_night]
            for run in _runs(nights):
                if len(run) > rules.max_consecutive_nights and run[-1] >= 0:
                    v("consecutive_nights", "error", M("{name}: {n} nights in a row (max {max})", name=name, n=len(run), max=rules.max_consecutive_nights), s, max(run[0], 0))

        shift_on = {d: t for d, t, _ in seq}
        if rules.weekly_rest_hours is not None:
            limit = rules.weekly_rest_hours * 60
            H = ctx.history_days
            rested: dict[int, bool] = {}
            for x in range(-H, ctx.n_days):
                # A missing or off neighbour means the rest runs on past it: long enough.
                before = (x - 1, shift_on[x - 1]) if x - 1 in shift_on else None
                after = (x + 1, shift_on[x + 1]) if x + 1 in shift_on else None
                rested[x] = x not in shift_on and ctx.rest_around(x, before, after) >= limit
            for start in range(-H, ctx.n_days - 6):
                if start + 6 >= 0 and not any(rested[x] for x in range(start, start + 7)):
                    v("weekly_rest", "error", M("{name}: no {h} h continuous rest in 7 days", name=name, h=_h(rules.weekly_rest_hours)), s, max(start, 0))
                    break

        if rules.days_off_per_week:
            need = rules.days_off_per_week
            for week in ctx.full_weeks():
                off = [d for d in week if d not in shift_on]
                consecutive = any(d + 1 in off for d in off if d + 1 in week)
                if len(off) < need or (rules.days_off_consecutive and need >= 2 and not consecutive):
                    severity = "error" if rules.days_off_hard else "warning"
                    week_of = f"{ctx.dates[week[0]].day}.{ctx.dates[week[0]].month}."
                    if len(off) < need:
                        text = M("{name}: {n} days off in the week of {week}", name=name, n=len(off), week=week_of)
                    else:
                        text = M("{name}: days off not consecutive in the week of {week}", name=name, week=week_of)
                    v("days_off", severity, text, s, week[0])

        worked = sum(ctx.paid[t] for _, t, _ in mine)
        credited = min(sum(ctx.credited[d, t] for d, t, _ in mine), ctx.credit_cap(worked))
        target = ctx.target_minutes[s]
        overtime, under = max(0, credited - target), max(0, target - credited)
        if rules.max_avg_weekly_hours is not None and worked > rules.max_avg_weekly_hours * 60 * ctx.n_days / 7:
            v("max_avg_weekly_hours", "error", M("{name}: averages {h} h a week", name=name, h=_h(worked / 60 / ctx.n_days * 7)), s)
        if rules.max_overtime_hours is not None and overtime > rules.max_overtime_hours * 60:
            v("overtime_cap", "error", M("{name}: {h} h overtime (cap {limit} h)", name=name, h=_h(overtime / 60), limit=_h(rules.max_overtime_hours)), s)
        elif overtime >= 60:
            v("overtime", "warning", M("{name}: {h} h above contract", name=name, h=_h(overtime / 60)), s)
        if under >= 4 * 60:
            v("under_hours", "warning", M("{name}: {h} h below contract", name=name, h=_h(under / 60)), s)

        worked_weekends = sum(1 for wk in weekends if any(d in days for d in wk))
        if allowed_weekends is not None and worked_weekends > allowed_weekends:
            v("weekends", "warning", M("{name}: works {n} weekends (target at most {max})", name=name, n=worked_weekends, max=allowed_weekends), s)

        stats.append(
            StaffStats(
                staff_id=member.id,
                shifts=len(mine),
                worked_hours=round(worked / 60, 2),
                credited_hours=round(credited / 60, 2),
                target_hours=round(target / 60, 2),
                overtime_hours=round(overtime / 60, 2),
                under_hours=round(under / 60, 2),
                night_shifts=sum(1 for _, t, _ in mine if ctx.shifts[t].is_night),
                weekends_worked=worked_weekends,
                holiday_shifts=sum(1 for d in days if d in ctx.holiday_days),
                major_holiday_shifts=sum(1 for d in days if d in ctx.major_days),
                requests_denied=sum(1 for d in days if (s, d) in ctx.request),
                task_counts=dict(Counter(task for _, _, tasks in mine for task in tasks)),
            )
        )

    _custom_rules(ctx, work, area_of, v, M, task_name, area_name, shift_name)
    return Evaluation(violations=out, staff=stats, coverage=cells)


def _custom_rules(
    ctx: Context,
    work: dict[tuple[int, int], tuple[int, list[str]]],
    area_of: dict[tuple[int, int], str | None],
    v,
    M,
    task_name: dict[str, str],
    area_name: dict[str, str],
    shift_name: dict[str, str],
) -> None:
    by_staff: dict[int, dict[int, tuple[int, list[str]]]] = defaultdict(dict)
    for (s, d), entry in work.items():
        by_staff[s][d] = entry

    for rule in ctx.project.custom_rules:
        if not rule.enabled:
            continue
        severity = "error" if rule.hard else "warning"
        label = rule.description or rule.type

        if isinstance(rule, AvoidTaskRepeatRule):
            for s in range(len(ctx.staff)):
                if not ctx.in_group(s, rule.group_id):
                    continue
                task_days = [d for d, (_, tasks) in sorted(by_staff[s].items()) if rule.task_id in tasks]
                for start in range(max(1, ctx.n_days - rule.window_days + 1)):
                    n = sum(1 for d in task_days if start <= d < start + rule.window_days)
                    if n > rule.max_count:
                        v(rule.id, severity, M("{label}: {name} does {task} {n}× in {days} days", label=label, name=ctx.staff[s].name, task=task_name.get(rule.task_id, rule.task_id), n=n, days=rule.window_days), s, start)
                        break

        elif isinstance(rule, RotateTaskEvenlyRule):
            targets = rotation_targets(ctx, rule)
            for s, target in targets.items():
                n = sum(1 for _, tasks in by_staff[s].values() if rule.task_id in tasks)
                if abs(n - target) > 1:
                    v(rule.id, severity, M("{label}: {name} does {task} {n}×, fair share about {share}", label=label, name=ctx.staff[s].name, task=task_name.get(rule.task_id, rule.task_id), n=n, share=_h(target)), s)

        elif isinstance(rule, MaxShiftTypeRule):
            t = ctx.shift_index[rule.shift_id]
            for s in range(len(ctx.staff)):
                if not ctx.in_group(s, rule.group_id):
                    continue
                n = sum(1 for tt, _ in by_staff[s].values() if tt == t)
                if n > rule.max_count:
                    v(rule.id, severity, M("{label}: {name} works {shift} {n}× (max {max})", label=label, name=ctx.staff[s].name, shift=shift_name.get(rule.shift_id, rule.shift_id), n=n, max=rule.max_count), s)

        elif isinstance(rule, FixedAreaRule):
            s = ctx.staff_index[rule.staff_id]
            for d, (t, _) in sorted(by_staff[s].items()):
                if area_of[(s, d)] != rule.area_id:
                    v(rule.id, severity, M("{label}: {name} is in {area}, not {wanted}", label=label, name=ctx.staff[s].name, area=area_name.get(area_of[(s, d)] or "", M("no area")), wanted=area_name.get(rule.area_id, rule.area_id)), s, d, t)

        elif isinstance(rule, DiverseShiftsRule):
            s = ctx.staff_index[rule.staff_id]
            types = [t for t in sorted(ctx.eligible[s]) if rule.shift_ids is None or ctx.shifts[t].id in rule.shift_ids]
            if len(types) >= 2:
                counts = {ctx.shifts[t].code: sum(1 for tt, _ in by_staff[s].values() if tt == t) for t in types}
                if max(counts.values()) - min(counts.values()) > 1:
                    mix = ", ".join(f"{code} {n}" for code, n in counts.items())
                    v(rule.id, severity, M("{label}: {name} has an uneven shift mix ({mix})", label=label, name=ctx.staff[s].name, mix=mix), s)

        elif isinstance(rule, ForbidSequenceRule):
            a, b = ctx.shift_index[rule.from_shift_id], ctx.shift_index[rule.to_shift_id]
            for s in range(len(ctx.staff)):
                if rule.group_id and not ctx.in_group(s, rule.group_id):
                    continue
                for d, (t, _) in by_staff[s].items():
                    nxt = by_staff[s].get(d + 1)
                    if t == a and nxt and nxt[0] == b:
                        v(rule.id, severity, M("{label}: {name} {a} → {b}", label=label, name=ctx.staff[s].name, a=shift_name.get(rule.from_shift_id, rule.from_shift_id), b=shift_name.get(rule.to_shift_id, rule.to_shift_id)), s, d + 1, b)
