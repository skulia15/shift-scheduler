"""Checks any roster — generated or hand-edited — against a Project's rules.

Kept independent of the solver's model so it can serve as the solver's test oracle.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from .context import Context, build_context
from .models import (
    Assignment,
    AvoidTaskRepeatRule,
    CoverageCell,
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


def evaluate(project: Project, roster: list[Assignment]) -> Evaluation:
    ctx = build_context(project)
    rules = project.rules
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
    for a in roster:
        s, d, t = ctx.staff_index.get(a.staff_id), ctx.day_of.get(a.date), ctx.shift_index.get(a.shift_id)
        if s is None or d is None or t is None:
            out.append(Violation(rule="unknown_reference", severity="error", message=f"Unknown staff, date or shift in {a}"))
            continue
        if (s, d) in work:
            v("one_shift_per_day", "error", f"{ctx.staff[s].name} has more than one shift", s, d, t)
            continue
        work[(s, d)] = (t, a.task_ids)

    for (s, d), (t, tasks) in work.items():
        name = ctx.staff[s].name
        if t not in ctx.eligible[s]:
            v("eligibility", "error", f"{name} may not work {ctx.shifts[t].name}", s, d, t)
        if (s, d) in ctx.blocked:
            v("leave", "error", f"{name} is on holiday / granted day off", s, d, t)
        elif (s, d) in ctx.request:
            v("request_denied", "warning", f"{name} asked for this day off", s, d, t)
        for task_id in tasks:
            if task_id not in ctx.task_group:
                v("unknown_reference", "error", f"Unknown task {task_id}", s, d, t)
            elif not ctx.in_group(s, ctx.task_group[task_id]):
                v("task_group", "error", f"{name} is not in the group that does {task_id}", s, d, t)
        if len(tasks) > 1:
            v("one_task_per_shift", "error", f"{name} has {len(tasks)} tasks on one shift", s, d, t)

    # Coverage
    cells: list[CoverageCell] = []
    for (d, t, group_id), (lo, hi) in sorted(ctx.coverage.items()):
        n = sum(1 for (s, dd), (tt, _) in work.items() if dd == d and tt == t and ctx.in_group(s, group_id))
        cells.append(CoverageCell(date=ctx.dates[d], shift_id=ctx.shifts[t].id, group_id=group_id, required=lo, assigned=n))
        if n < lo:
            v("coverage", "error", f"{group_id}: {n} of {lo} required", d=d, t=t)
        if hi is not None and n > hi:
            v("coverage", "error", f"{group_id}: {n} exceeds maximum {hi}", d=d, t=t)

    task_done: Counter[tuple[int, int, str]] = Counter()
    for (s, d), (t, tasks) in work.items():
        for task_id in tasks:
            task_done[(d, t, task_id)] += 1
    for key in set(ctx.task_need) | set(task_done):
        d, t, task_id = key
        need, done = ctx.task_need.get(key, 0), task_done.get(key, 0)
        if done < need:
            v("task_coverage", "error", f"{task_id}: {done} of {need} assigned", d=d, t=t)
        elif done > need:
            v("task_coverage", "warning", f"{task_id}: {done} assigned, {need} needed", d=d, t=t)

    # Per-person working-time rules
    stats: list[StaffStats] = []
    weekends = ctx.weekends()
    allowed_weekends = ctx.allowed_weekends()
    for s, member in enumerate(ctx.staff):
        mine = sorted((d, t, tasks) for (ss, d), (t, tasks) in work.items() if ss == s)
        days = [d for d, _, _ in mine]
        name = member.name

        for (d1, t1, _), (d2, t2, _) in zip(mine, mine[1:]):
            rest = ctx.rest_minutes(d1, t1, d2, t2)
            if rest < rules.min_rest_hours_absolute * 60:
                v("rest", "error", f"{name}: only {rest / 60:.1f}h rest (minimum {rules.min_rest_hours_absolute}h)", s, d2, t2)
            elif rest < rules.min_rest_hours * 60:
                v("short_rest", "warning", f"{name}: {rest / 60:.1f}h rest (target {rules.min_rest_hours}h)", s, d2, t2)

        if rules.max_consecutive_days is not None:
            for run in _runs(days):
                if len(run) > rules.max_consecutive_days:
                    v("consecutive_days", "error", f"{name}: {len(run)} days in a row (max {rules.max_consecutive_days})", s, run[0])

        if rules.max_consecutive_nights is not None:
            nights = [d for d, t, _ in mine if ctx.shifts[t].is_night]
            for run in _runs(nights):
                if len(run) > rules.max_consecutive_nights:
                    v("consecutive_nights", "error", f"{name}: {len(run)} nights in a row (max {rules.max_consecutive_nights})", s, run[0])

        if rules.min_days_off_per_week is not None:
            for week in ctx.full_weeks():
                off = sum(1 for d in week if d not in days)
                if off < rules.min_days_off_per_week:
                    v("days_off_per_week", "error", f"{name}: {off} days off in week (min {rules.min_days_off_per_week})", s, week[0])

        worked = sum(ctx.paid[t] for _, t, _ in mine)
        credited = min(sum(ctx.credited[d, t] for d, t, _ in mine), ctx.credit_cap(worked))
        target = ctx.target_minutes[s]
        overtime, under = max(0, credited - target), max(0, target - credited)
        if rules.max_avg_weekly_hours is not None and worked > rules.max_avg_weekly_hours * 60 * ctx.n_days / 7:
            v("max_avg_weekly_hours", "error", f"{name}: averages {worked / 60 / ctx.n_days * 7:.1f}h/week", s)
        if rules.max_overtime_hours is not None and overtime > rules.max_overtime_hours * 60:
            v("overtime_cap", "error", f"{name}: {overtime / 60:.1f}h overtime (cap {rules.max_overtime_hours}h)", s)
        elif overtime >= 60:
            v("overtime", "warning", f"{name}: {overtime / 60:.1f}h above contract", s)
        if under >= 4 * 60:
            v("under_hours", "warning", f"{name}: {under / 60:.1f}h below contract", s)

        worked_weekends = sum(1 for wk in weekends if any(d in days for d in wk))
        if allowed_weekends is not None and worked_weekends > allowed_weekends:
            v("weekends", "warning", f"{name}: works {worked_weekends} weekends (target max {allowed_weekends})", s)

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
                requests_denied=sum(1 for d in days if (s, d) in ctx.request),
                task_counts=dict(Counter(task for _, _, tasks in mine for task in tasks)),
            )
        )

    _custom_rules(ctx, work, v)
    return Evaluation(violations=out, staff=stats, coverage=cells)


def _custom_rules(ctx: Context, work: dict[tuple[int, int], tuple[int, list[str]]], v) -> None:
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
                        v(rule.id, severity, f"{label}: {ctx.staff[s].name} does {rule.task_id} {n}× in {rule.window_days} days", s, start)
                        break

        elif isinstance(rule, RotateTaskEvenlyRule):
            targets = rotation_targets(ctx, rule)
            for s, target in targets.items():
                n = sum(1 for _, tasks in by_staff[s].values() if rule.task_id in tasks)
                if abs(n - target) > 1:
                    v(rule.id, severity, f"{label}: {ctx.staff[s].name} does {rule.task_id} {n}×, fair share ≈{target:.1f}", s)

        elif isinstance(rule, MaxShiftTypeRule):
            t = ctx.shift_index[rule.shift_id]
            for s in range(len(ctx.staff)):
                if not ctx.in_group(s, rule.group_id):
                    continue
                n = sum(1 for tt, _ in by_staff[s].values() if tt == t)
                if n > rule.max_count:
                    v(rule.id, severity, f"{label}: {ctx.staff[s].name} works {rule.shift_id} {n}× (max {rule.max_count})", s)

        elif isinstance(rule, ForbidSequenceRule):
            a, b = ctx.shift_index[rule.from_shift_id], ctx.shift_index[rule.to_shift_id]
            for s in range(len(ctx.staff)):
                if rule.group_id and not ctx.in_group(s, rule.group_id):
                    continue
                for d, (t, _) in by_staff[s].items():
                    nxt = by_staff[s].get(d + 1)
                    if t == a and nxt and nxt[0] == b:
                        v(rule.id, severity, f"{label}: {ctx.staff[s].name} {rule.from_shift_id} → {rule.to_shift_id}", s, d + 1, b)
