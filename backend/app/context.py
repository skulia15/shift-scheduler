"""Derived facts about a Project (day indices, shift times, demand per cell, leave, targets).

Shared by the solver and the validator so both read the problem the same way.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

from .models import MINUTES_PER_DAY, LaborRules, Project, PublicHoliday, ShiftType, Staff, parse_clock


def credited_minutes(shift: ShiftType, day: date, holidays: dict[date, PublicHoliday], rules: LaborRules) -> int:
    """Paid minutes of `shift` starting on `day`, each weighted by the highest band it falls in.

    A public holiday counts as a weekend day from its `starts` time. Its `high_from` time starts the
    165% hours, which run until 08:00 the next morning.
    """
    weighted = 0.0
    start = shift.start_minute
    for minute in range(start, start + shift.length_minutes):
        calendar_day = day + timedelta(days=minute // MINUTES_PER_DAY)
        clock = minute % MINUTES_PER_DAY
        holiday = holidays.get(calendar_day)
        eve_before = holidays.get(calendar_day - timedelta(days=1))
        weekend = calendar_day.weekday() >= 5 or (holiday is not None and clock >= parse_clock(holiday.starts))
        high = (holiday is not None and holiday.high_from is not None and clock >= parse_clock(holiday.high_from)) or (
            eve_before is not None and eve_before.high_from is not None and clock < 8 * 60
        )
        weight = 1.0
        for band in rules.weight_bands:
            applies = {
                "weekday": not weekend,
                "weekend_or_holiday": weekend,
                "high_holiday": high,
                "all": True,
            }[band.days]
            if applies and parse_clock(band.start) <= clock < parse_clock(band.end):
                weight = max(weight, band.weight)
        weighted += weight
    # Breaks are unpaid; scale so weighting applies only to paid time.
    return round(weighted * shift.paid_minutes / shift.length_minutes)


@dataclass
class Context:
    project: Project
    dates: list[date]
    day_of: dict[date, int]
    shifts: list[ShiftType]
    shift_index: dict[str, int]
    staff: list[Staff]
    staff_index: dict[str, int]
    paid: list[int]  # per shift type
    credited: dict[tuple[int, int], int]  # (day, shift) -> paid minutes with band weighting
    coverage: dict[tuple[int, int, str], tuple[int, int | None]] = field(default_factory=dict)
    task_need: dict[tuple[int, int, str], int] = field(default_factory=dict)
    blocked: set[tuple[int, int]] = field(default_factory=set)  # (staff, day): holiday or granted request
    request: set[tuple[int, int]] = field(default_factory=set)  # ungranted requests
    target_minutes: list[int] = field(default_factory=list)
    eligible: list[set[int]] = field(default_factory=list)  # shift indices per staff
    task_group: dict[str, str] = field(default_factory=dict)
    area_need: dict[tuple[int, int, str, str], tuple[int, int | None]] = field(default_factory=dict)  # (d, t, area, group)
    fixed_area: dict[int, str] = field(default_factory=dict)  # staff -> area (enabled fixed_area rules)
    competence_need: dict[tuple[int, int, str, str | None], int] = field(default_factory=dict)  # (d, t, competence, area)
    task_competence: dict[str, str | None] = field(default_factory=dict)
    area_groups: set[tuple[int, int, str]] = field(default_factory=set)  # (d, t, group) with any area demand

    def has_competence(self, staff: int, competence_id: str | None) -> bool:
        return competence_id is None or competence_id in self.staff[staff].competence_ids

    def needs_area(self, staff: int, day: int, shift: int) -> bool:
        """Whether this person, if working this shift, must be placed in an area."""
        if staff in self.fixed_area:
            return True
        return any((day, shift, g) in self.area_groups for g in self.staff[staff].group_ids)

    def area_candidates(self, staff: int, day: int, shift: int) -> list[str]:
        """Areas this person could be placed in on this shift (sorted for determinism)."""
        groups = self.staff[staff].group_ids
        found = {a for (d, t, a, g) in self.area_need if d == day and t == shift and g in groups}
        if staff in self.fixed_area:
            found.add(self.fixed_area[staff])
        return sorted(found)

    @property
    def n_days(self) -> int:
        return len(self.dates)

    def start_abs(self, day: int, shift: int) -> int:
        return day * MINUTES_PER_DAY + self.shifts[shift].start_minute

    def end_abs(self, day: int, shift: int) -> int:
        return self.start_abs(day, shift) + self.shifts[shift].length_minutes

    def rest_minutes(self, day: int, shift: int, next_day: int, next_shift: int) -> int:
        return self.start_abs(next_day, next_shift) - self.end_abs(day, shift)

    def credit_cap(self, worked: int) -> int:
        """Most credited minutes that `worked` actual minutes may earn (min_actual_weekly_hours floor)."""
        floor = self.project.rules.min_actual_weekly_hours
        if not floor:
            return 10**9
        return worked * round(self.project.rules.full_time_weekly_hours * 100) // round(floor * 100)

    def in_group(self, staff: int, group_id: str) -> bool:
        return group_id in self.staff[staff].group_ids

    def weekends(self) -> list[list[int]]:
        """Day indices of each Sat/Sun pair touching the period."""
        result: dict[date, list[int]] = {}
        for d, day in enumerate(self.dates):
            if day.weekday() >= 5:
                saturday = day if day.weekday() == 5 else date.fromordinal(day.toordinal() - 1)
                result.setdefault(saturday, []).append(d)
        return list(result.values())

    def rest_around(self, day: int, before: tuple[int, int] | None, after: tuple[int, int] | None) -> float:
        """Continuous rest (minutes) spanning `day` off, between the shift (day, type) `before` and `after`.
        A missing side counts as unlimited (no history before the period)."""
        if before is None or after is None:
            return math.inf
        return self.start_abs(*after) - self.end_abs(*before)

    def full_weeks(self) -> list[list[int]]:
        """Day indices of each Monday–Sunday week lying entirely inside the period."""
        weeks = []
        for d, day in enumerate(self.dates):
            if day.weekday() == 0 and d + 7 <= self.n_days:
                weeks.append(list(range(d, d + 7)))
        return weeks

    def allowed_weekends(self) -> int | None:
        ratio = self.project.rules.max_weekend_ratio
        if ratio is None:
            return None
        return math.ceil(ratio * len(self.weekends()) - 1e-9)


def _demand_applies(weekdays: list[int], dates: list[date] | None, day: date) -> tuple[bool, bool]:
    """(applies, is_date_override)"""
    if dates is not None:
        return day in dates, True
    return day.weekday() in weekdays, False


def build_context(project: Project) -> Context:
    rules = project.rules
    dates = project.period.dates()
    ctx = Context(
        project=project,
        dates=dates,
        day_of={d: i for i, d in enumerate(dates)},
        shifts=project.shift_types,
        shift_index={s.id: i for i, s in enumerate(project.shift_types)},
        staff=project.staff,
        staff_index={s.id: i for i, s in enumerate(project.staff)},
        paid=[s.paid_minutes for s in project.shift_types],
        credited={},
    )

    holidays = {h.date: h for h in project.public_holidays}
    for d, day in enumerate(dates):
        for t, shift in enumerate(project.shift_types):
            ctx.credited[d, t] = credited_minutes(shift, day, holidays, rules)

    overridden: set[tuple[int, int, str]] = set()
    for c in project.coverage:
        t = ctx.shift_index[c.shift_id]
        for d, day in enumerate(dates):
            applies, is_override = _demand_applies(c.weekdays, c.dates, day)
            key = (d, t, c.group_id)
            if not applies or (key in overridden and not is_override):
                continue
            if is_override:
                overridden.add(key)
            ctx.coverage[key] = (c.min, c.max)

    overridden_tasks: set[tuple[int, int, str]] = set()
    for td in project.task_demand:
        t = ctx.shift_index[td.shift_id]
        for d, day in enumerate(dates):
            applies, is_override = _demand_applies(td.weekdays, td.dates, day)
            key = (d, t, td.task_id)
            if not applies or (key in overridden_tasks and not is_override):
                continue
            if is_override:
                overridden_tasks.add(key)
            ctx.task_need[key] = td.count

    holiday: set[tuple[int, int]] = set()
    for lv in project.leave:
        s = ctx.staff_index[lv.staff_id]
        for day in lv.days():
            if day not in ctx.day_of:
                continue
            key = (s, ctx.day_of[day])
            if lv.kind == "holiday":
                holiday.add(key)
            if lv.kind == "holiday" or lv.granted:
                ctx.blocked.add(key)
            else:
                ctx.request.add(key)
    ctx.request -= ctx.blocked

    weeks = len(dates) / 7
    for s in project.staff:
        if s.target_hours_override is not None:
            target = s.target_hours_override * 60
        else:
            target = rules.full_time_weekly_hours * 60 * s.employment_percent / 100 * weeks
            # Reserved holiday is paid leave: each calendar day off reduces the target by a day's share.
            holiday_days = sum(1 for (si, _) in holiday if si == ctx.staff_index[s.id])
            target -= rules.full_time_weekly_hours * 60 / 7 * s.employment_percent / 100 * holiday_days
            # Public holidays on weekdays reduce duty (betri vinnutími), pro rata.
            reduction = sum(h.duty_reduction_hours for h in project.public_holidays if h.date in ctx.day_of and h.date.weekday() < 5)
            target -= reduction * 60 * s.employment_percent / 100
        ctx.target_minutes.append(max(0, round(target)))
        allowed = s.allowed_shift_ids
        ctx.eligible.append(
            {
                i
                for i, sh in enumerate(project.shift_types)
                if (allowed is None or sh.id in allowed) and sh.paid_minutes <= rules.max_shift_hours * 60
            }
        )

    ctx.task_group = {t.id: t.group_id for t in project.tasks}

    overridden_areas: set[tuple[int, int, str, str]] = set()
    for ad in project.area_demand:
        t = ctx.shift_index[ad.shift_id]
        for d, day in enumerate(dates):
            applies, is_override = _demand_applies(ad.weekdays, ad.dates, day)
            key = (d, t, ad.area_id, ad.group_id)
            if not applies or (key in overridden_areas and not is_override):
                continue
            if is_override:
                overridden_areas.add(key)
            ctx.area_need[key] = (ad.min, ad.max)

    overridden_competences: set[tuple[int, int, str, str | None]] = set()
    for cd in project.competence_demand:
        t = ctx.shift_index[cd.shift_id]
        for d, day in enumerate(dates):
            applies, is_override = _demand_applies(cd.weekdays, cd.dates, day)
            key = (d, t, cd.competence_id, cd.area_id)
            if not applies or (key in overridden_competences and not is_override):
                continue
            if is_override:
                overridden_competences.add(key)
            ctx.competence_need[key] = cd.min
    ctx.task_competence = {t.id: t.competence_id for t in project.tasks}

    ctx.area_groups = {(d, t, g) for (d, t, _, g) in ctx.area_need}
    for rule in project.custom_rules:
        if rule.enabled and rule.type == "fixed_area":
            ctx.fixed_area[ctx.staff_index[rule.staff_id]] = rule.area_id
    return ctx
