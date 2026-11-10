"""Problem and result schema shared by the solver, the validator and the API.

The whole planning problem is one `Project` document; the backend keeps no state.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

MINUTES_PER_DAY = 24 * 60
# Alias: models with a field named `date` would otherwise shadow the type in annotations.
DateT = date


def parse_clock(value: str) -> int:
    """'07:30' -> minutes after midnight."""
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


ShiftKind = Literal["morning", "evening", "night"]


class ShiftType(BaseModel):
    id: str
    code: str = Field(description="Short label shown in the roster grid, e.g. 'M', 'K', 'N'")
    name: str
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$", description="May be earlier than start: crosses midnight")
    break_minutes: int = 0
    is_night: bool = False
    category: ShiftKind | None = Field(
        None, description="MV / KV / NV; None = from the start time (night if is_night)"
    )
    text_color: str | None = Field(None, description="Hex text colour in exported sheets, e.g. the planner's red for part shifts")

    @property
    def kind(self) -> str:
        """Morning, evening or night: the category if set, else from the start time."""
        if self.category:
            return self.category
        if self.is_night:
            return "night"
        start = self.start_minute
        return "morning" if start < 12 * 60 else "evening" if start < 20 * 60 + 30 else "night"

    @property
    def start_minute(self) -> int:
        return parse_clock(self.start)

    @property
    def length_minutes(self) -> int:
        """Elapsed time from start to end, including breaks."""
        length = parse_clock(self.end) - self.start_minute
        return length if length > 0 else length + MINUTES_PER_DAY

    @property
    def paid_minutes(self) -> int:
        return self.length_minutes - self.break_minutes


class StaffGroup(BaseModel):
    id: str
    name: str


class Staff(BaseModel):
    id: str
    name: str
    group_ids: list[str]
    employment_percent: float = Field(100, ge=0, le=100, description="Starfshlutfall")
    allowed_shift_ids: list[str] | None = Field(None, description="None = any shift type")
    target_hours_override: float | None = Field(None, description="Hours for the whole period")
    competence_ids: list[str] = Field(default_factory=list, description="e.g. medication rights, Icelandic")
    employee_number: str | None = Field(None, description="Starfsmannanúmer, for matching to MTP / payroll files")
    note: str = Field("", description="The person's wishes, as written (e.g. imported from the planner's sheet)")


class Competence(BaseModel):
    """A skill that cuts across staff groups (Lyfjaréttindi, Íslenska, Vaktstjóri…)."""

    id: str
    name: str


class Task(BaseModel):
    id: str
    name: str
    group_id: str
    competence_id: str | None = Field(None, description="Only people with this competence may do the task")


class CompetenceDemand(BaseModel):
    """At least `min` people with a competence on a shift — in one area, or anywhere when area_id is None.
    `dates` entries override weekday entries."""

    competence_id: str
    shift_id: str
    area_id: str | None = None
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    dates: list[date] | None = None
    min: int = 1


class CoverageDemand(BaseModel):
    """Headcount of a group on a shift. `dates` entries override weekday entries for that date."""

    shift_id: str
    group_id: str
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), description="0=Mon … 6=Sun")
    dates: list[date] | None = None
    min: int = 0
    max: int | None = None
    preferred: int | None = Field(None, description="Soft target above `min` ('helst að hafa 6'); each one short costs points")
    fallback: bool = Field(False, description="Only used when short ('þarf ekki alltaf'): each person on it costs points")
    covers_shift_id: str | None = Field(None, description="Fallback only: its people also count towards this shift's headcount")
    note: str = Field("", description="Where the row came from, e.g. the planner's note it was read from")


class TaskDemand(BaseModel):
    task_id: str
    shift_id: str
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    dates: list[date] | None = None
    count: int = 1


class Area(BaseModel):
    """A floor, wing or hallway. Staff on shift are placed in exactly one area where areas apply."""

    id: str
    code: str
    name: str


class AreaDemand(BaseModel):
    """Headcount of a group in an area on a shift. A group with any area demand on a shift has every
    working member placed in an area on that shift. `dates` entries override weekday entries."""

    area_id: str
    shift_id: str
    group_id: str
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    dates: list[date] | None = None
    min: int = 0
    max: int | None = None


class Leave(BaseModel):
    """`holiday` is reserved leave and is never scheduled over; `sick` likewise (both are paid absence
    and lower the contract target). A `request` is a day-off wish; once `granted` it is binding."""

    staff_id: str
    start: date
    end: date
    kind: Literal["holiday", "request", "sick"]
    granted: bool = False
    note: str = ""

    def days(self) -> list[date]:
        return [self.start + timedelta(days=i) for i in range((self.end - self.start).days + 1)]


class WeightBand(BaseModel):
    """Clock hours whose worked minutes count extra towards contract hours (vægi vinnustunda)."""

    name: str
    days: Literal["weekday", "weekend_or_holiday", "high_holiday", "all"] = Field(
        description="high_holiday = the 165% hours: holiday-eve evenings from `high_from` and the night after"
    )
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$", description="24:00 allowed; must be after start")
    weight: float


def _icelandic_bands() -> list[WeightBand]:
    return [
        WeightBand(name="Weekday evening", days="weekday", start="17:00", end="24:00", weight=1.05),
        WeightBand(name="Weekend and holiday days", days="weekend_or_holiday", start="08:00", end="24:00", weight=1.05),
        WeightBand(name="Night", days="all", start="00:00", end="08:00", weight=1.2),
        WeightBand(name="Christmas and New Year evening", days="high_holiday", start="16:00", end="24:00", weight=1.2),
    ]


class PublicHoliday(BaseModel):
    """Counts as a weekend day for weighting. Reduces full-time duty by `duty_reduction_hours`
    when it falls on a weekday (betri vinnutími: 7.2h, 3.6h for aðfangadagur / gamlársdagur)."""

    date: DateT
    name: str
    duty_reduction_hours: float = 7.2
    major: bool = Field(False, description="Stórhátíðardagur (120% pay); affects pay, not credited hours")
    starts: str = Field("00:00", pattern=r"^\d{2}:\d{2}$", description="Aðfangadagur / gamlársdagur: 12:00")
    high_from: str | None = Field(
        None, pattern=r"^\d{2}:\d{2}$", description="165% from this time until 08:00 next day (aðfangadagur / gamlársdagur: 16:00)"
    )


Agreement = Literal["sfv", "state", "municipal", "reykjavik", "custom"]


class LaborRules(BaseModel):
    """Working-time rules. Defaults follow the SFV agreements (docs/RULE-SPEC.md); the UI's
    agreement selector rewrites the settings that differ between agreements."""

    agreement: Agreement = "sfv"
    full_time_weekly_hours: float = 36.0
    weight_bands: list[WeightBand] = Field(default_factory=_icelandic_bands)
    min_actual_weekly_hours: float | None = Field(
        32.0, description="Weighting may not bring a full-timer's actual hours below this (pro rata)"
    )
    min_rest_hours: float = Field(11, description="Target daily rest; shorter rest is penalised")
    min_rest_hours_absolute: float = Field(8, description="Rest may never be shorter than this (shift-type change)")
    max_short_rests_per_week: int | None = Field(1, description="Rests below the target, per Mon–Sun week (soft)")
    max_shift_hours: float = Field(13, description="Never scheduled longer (13 h per 24 h)")
    min_shift_hours: float | None = Field(4, description="Shift types shorter than this are flagged")
    normal_max_shift_hours: float | None = Field(10, description="Longer shift types need a local agreement (SGS–SNS: 12)")
    weekly_rest_hours: float | None = Field(35, description="Continuous rest within every 7 days (statute)")
    max_consecutive_days: int | None = Field(None, description="Optional local limit; weekly rest already caps it at 6")
    days_off_per_week: int | None = Field(2, description="Days off per Mon–Sun week")
    days_off_consecutive: bool = Field(True, description="The days off should be consecutive")
    days_off_hard: bool = Field(False, description="SFV/state/SNS: 'að jafnaði' (soft); Reykjavík: hard")
    lone_night_warning: bool = Field(False, description="SNS: lone night shifts need a safety assessment")
    max_avg_weekly_hours: float | None = 48
    max_overtime_hours: float | None = Field(None, description="Hard cap on hours above contract for the period")
    max_consecutive_nights: int | None = Field(None, description="No union limit; local practice")
    max_weekend_ratio: float | None = Field(0.5, description="Fairness preference, not a union rule (soft)")


class Weights(BaseModel):
    """Objective weights. Hour terms are per hour; the rest per occurrence."""

    under_hours: int = 2
    overtime_hours: int = 8
    overtime_spread: int = 4  # per hour of the largest individual overtime, so it is shared fairly
    request_denied: int = 60
    short_rest: int = 15
    short_rest_excess: int = 60  # each short rest beyond the weekly allowance
    days_off: int = 20  # a week without the expected (consecutive) days off
    change: int = 100  # repair: each changed shift with more than a week's notice
    change_week: int = 200  # 2–7 days' notice (breytingargjald 1.3%)
    change_day: int = 400  # under ~24 h notice (breytingargjald 2%)
    change_detail: int = 5  # repair: a kept shift's area or task changed
    weekend_fairness: int = 5  # per weekend on the most-loaded person's running total (per 100% FTE)
    holiday_fairness: int = 20  # same for holiday shifts; stórhátíð shifts count double
    weekend_excess: int = 10
    overstaff: int = 1
    coverage_shortfall: int = 500
    preferred_shortfall: int = 30  # each person below a preferred headcount
    fallback_use: int = 25  # each person on a fallback shift; below preferred_shortfall so it fills preferred gaps only


class _RuleBase(BaseModel):
    id: str
    enabled: bool = True
    hard: bool = False
    weight: int = 10
    description: str = ""


class AvoidTaskRepeatRule(_RuleBase):
    """Members of a group do a task at most `max_count` times in any `window_days`-day window."""

    type: Literal["avoid_task_repeat"] = "avoid_task_repeat"
    group_id: str
    task_id: str
    max_count: int = 1
    window_days: int = 3


class RotateTaskEvenlyRule(_RuleBase):
    """A task is shared evenly among a group's members (optionally in proportion to employment %)."""

    type: Literal["rotate_task_evenly"] = "rotate_task_evenly"
    group_id: str
    task_id: str
    proportional_to_employment: bool = False


class MaxShiftTypeRule(_RuleBase):
    """Each member of a group works the shift type at most `max_count` times in the period."""

    type: Literal["max_shift_type"] = "max_shift_type"
    group_id: str
    shift_id: str
    max_count: int


class ForbidSequenceRule(_RuleBase):
    """Shift type `from_shift_id` must not be followed by `to_shift_id` on the next day."""

    type: Literal["forbid_sequence"] = "forbid_sequence"
    group_id: str | None = None
    from_shift_id: str
    to_shift_id: str


class FixedAreaRule(_RuleBase):
    """A person is always placed in one area when on shift."""

    type: Literal["fixed_area"] = "fixed_area"
    staff_id: str
    area_id: str


class DiverseShiftsRule(_RuleBase):
    """A person's shift-type counts stay balanced (max − min ≤ 1 when hard).
    `shift_ids` limits which types are balanced; None = every type they may work.
    `by_kind` balances morning / evening / night instead of individual shift types."""

    type: Literal["diverse_shifts"] = "diverse_shifts"
    staff_id: str
    shift_ids: list[str] | None = None
    by_kind: bool = False
    kinds: list[ShiftKind] | None = Field(None, description="With by_kind: the kinds to balance; None = all they may work")


class _ShiftFilter(BaseModel):
    """Which shifts a person rule is about: kinds and/or shift types (both None = any shift)."""

    kinds: list[ShiftKind] | None = None
    shift_ids: list[str] | None = None


class WeekendPatternRule(_RuleBase):
    """Works at most one of every `every` weekends (0 = no weekends), counting the weekend just
    before the period. With `both_days`, a worked weekend is Saturday and Sunday."""

    type: Literal["weekend_pattern"] = "weekend_pattern"
    staff_id: str
    every: int = Field(2, ge=0, le=8)
    both_days: bool = False


class AllowedShiftsRule(_RuleBase, _ShiftFilter):
    """On the given weekdays, a person works only these shifts (soft: prefers them)."""

    type: Literal["allowed_shifts"] = "allowed_shifts"
    staff_id: str
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), description="0=Mon … 6=Sun")


class RecurringShiftRule(_RuleBase, _ShiftFilter):
    """A person works on these weekdays every week (with one of these shifts, if given)."""

    type: Literal["recurring_shift"] = "recurring_shift"
    staff_id: str
    weekdays: list[int]


class UnavailableWeekdaysRule(_RuleBase):
    """A person does not work on these weekdays."""

    type: Literal["unavailable_weekdays"] = "unavailable_weekdays"
    staff_id: str
    weekdays: list[int]


class ShiftsPerWeekRule(_RuleBase, _ShiftFilter):
    """Matching shifts per Monday–Sunday week. `min` applies to full weeks only."""

    type: Literal["shifts_per_week"] = "shifts_per_week"
    staff_id: str
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    min: int | None = None
    max: int | None = None


class WorkTogetherRule(_RuleBase, _ShiftFilter):
    """Two people prefer the same shifts: each matching shift one works without the other costs."""

    type: Literal["work_together"] = "work_together"
    staff_id: str
    other_staff_id: str


class LinkedShiftRule(_RuleBase):
    """Whoever works `from_shift_id` on one of `weekdays` works `to_shift_id` `days_after` days later
    ('the one on Saturday's 17:30 gets Sunday 17:00-23:00')."""

    type: Literal["linked_shift"] = "linked_shift"
    group_id: str | None = None
    from_shift_id: str
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    to_shift_id: str
    days_after: int = Field(1, ge=1, le=6)


CustomRule = Annotated[
    AvoidTaskRepeatRule
    | RotateTaskEvenlyRule
    | MaxShiftTypeRule
    | ForbidSequenceRule
    | FixedAreaRule
    | DiverseShiftsRule
    | WeekendPatternRule
    | AllowedShiftsRule
    | RecurringShiftRule
    | UnavailableWeekdaysRule
    | ShiftsPerWeekRule
    | WorkTogetherRule
    | LinkedShiftRule,
    Field(discriminator="type"),
]


class LedgerEntry(BaseModel):
    """Totals carried from earlier periods, so fairness is judged over time, not one roster."""

    staff_id: str
    periods: int = 0
    weekends: int = 0
    nights: int = 0
    holiday_shifts: int = 0
    major_holiday_shifts: int = 0
    overtime_hours: float = 0
    requests_denied: int = 0


def same_day_next_month(day: date) -> date:
    """15 Dec -> 15 Jan; a day past the next month's end becomes its last day."""
    year, month = (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
    for d in (day.day, 30, 29, 28):
        try:
            return date(year, month, d)
        except ValueError:
            continue
    raise AssertionError("unreachable")


class Period(BaseModel):
    start: date
    days: int = Field(28, ge=1, le=84)
    monthly: bool = Field(False, description="Runs from the start's day of the month to the day before it next month (15th → 14th)")

    def dates(self) -> list[date]:
        return [self.start + timedelta(days=i) for i in range(self.days)]


class Project(BaseModel):
    name: str
    period: Period
    shift_types: list[ShiftType]
    groups: list[StaffGroup]
    staff: list[Staff]
    tasks: list[Task] = []
    coverage: list[CoverageDemand] = []
    task_demand: list[TaskDemand] = []
    areas: list[Area] = []
    area_demand: list[AreaDemand] = []
    competences: list[Competence] = []
    competence_demand: list[CompetenceDemand] = []
    leave: list[Leave] = []
    public_holidays: list[PublicHoliday] = []
    history: list["Assignment"] = Field(default_factory=list, description="Previous roster's last days, for rest rules")
    ledger: list[LedgerEntry] = []
    rules: LaborRules = LaborRules()
    weights: Weights = Weights()
    custom_rules: list[CustomRule] = []
    solve_seconds: float = Field(20, gt=0, le=300)

    @model_validator(mode="after")
    def _check_references(self) -> Project:
        shift_ids = {s.id for s in self.shift_types}
        group_ids = {g.id for g in self.groups}
        task_ids = {t.id for t in self.tasks}
        staff_ids = {s.id for s in self.staff}
        problems: list[str] = []
        for s in self.staff:
            problems += [f"staff {s.id}: unknown group {g}" for g in s.group_ids if g not in group_ids]
            problems += [f"staff {s.id}: unknown shift {t}" for t in s.allowed_shift_ids or [] if t not in shift_ids]
        for t in self.tasks:
            if t.group_id not in group_ids:
                problems.append(f"task {t.id}: unknown group {t.group_id}")
        for c in self.coverage:
            if c.shift_id not in shift_ids or c.group_id not in group_ids or (c.covers_shift_id and c.covers_shift_id not in shift_ids):
                problems.append(f"coverage {c.shift_id}/{c.group_id}: unknown shift or group")
        for td in self.task_demand:
            if td.task_id not in task_ids or td.shift_id not in shift_ids:
                problems.append(f"task demand {td.task_id}/{td.shift_id}: unknown task or shift")
        for lv in self.leave:
            if lv.staff_id not in staff_ids:
                problems.append(f"leave: unknown staff {lv.staff_id}")
        area_ids = {a.id for a in self.areas}
        competence_ids = {c.id for c in self.competences}
        for st in self.staff:
            problems += [f"staff {st.id}: unknown competence {c}" for c in st.competence_ids if c not in competence_ids]
        for t in self.tasks:
            if t.competence_id is not None and t.competence_id not in competence_ids:
                problems.append(f"task {t.id}: unknown competence {t.competence_id}")
        for cd in self.competence_demand:
            if cd.competence_id not in competence_ids or cd.shift_id not in shift_ids or (cd.area_id and cd.area_id not in area_ids):
                problems.append(f"competence demand {cd.competence_id}/{cd.shift_id}: unknown competence, shift or area")
        for ad in self.area_demand:
            if ad.area_id not in area_ids or ad.shift_id not in shift_ids or ad.group_id not in group_ids:
                problems.append(f"area demand {ad.area_id}/{ad.shift_id}/{ad.group_id}: unknown area, shift or group")
        for rule in self.custom_rules:
            staff_id = getattr(rule, "staff_id", None)
            if staff_id is not None and staff_id not in staff_ids:
                problems.append(f"rule {rule.id}: unknown staff {staff_id}")
            if isinstance(rule, WorkTogetherRule) and rule.other_staff_id not in staff_ids:
                problems.append(f"rule {rule.id}: unknown staff {rule.other_staff_id}")
            problems += [f"rule {rule.id}: unknown shift {t}" for t in getattr(rule, "shift_ids", None) or [] if t not in shift_ids]
            if isinstance(rule, LinkedShiftRule) and (rule.from_shift_id not in shift_ids or rule.to_shift_id not in shift_ids):
                problems.append(f"rule {rule.id}: unknown shift")
            if isinstance(rule, FixedAreaRule) and rule.area_id not in area_ids:
                problems.append(f"rule {rule.id}: unknown area {rule.area_id}")
        if problems:
            raise ValueError("; ".join(problems))
        return self


class Assignment(BaseModel):
    staff_id: str
    date: DateT
    shift_id: str
    task_ids: list[str] = []
    area_id: str | None = None
    locked: bool = Field(False, description="Repair never moves a locked shift")


class Violation(BaseModel):
    rule: str
    severity: Literal["error", "warning"]
    message: str
    staff_id: str | None = None
    date: DateT | None = None
    shift_id: str | None = None


class StaffStats(BaseModel):
    staff_id: str
    shifts: int
    worked_hours: float
    credited_hours: float = Field(description="Worked hours with night weighting applied")
    target_hours: float
    overtime_hours: float
    under_hours: float
    night_shifts: int
    weekends_worked: int
    holiday_shifts: int = 0
    major_holiday_shifts: int = 0
    requests_denied: int
    task_counts: dict[str, int]


class CoverageCell(BaseModel):
    date: DateT
    shift_id: str
    group_id: str | None = None
    area_id: str | None = None
    competence_id: str | None = None
    required: int
    assigned: int
    preferred: int | None = None


class WishResult(BaseModel):
    """Whether one person's wish (a person rule, or their day-off requests) is met in the roster."""

    staff_id: str
    rule_id: str = Field(description="The rule's id, or 'requests' for day-off requests")
    description: str
    hard: bool = False
    misses: int = 0
    total: int | None = Field(None, description="Requests only: how many days were asked for")
    examples: list[str] = Field(default_factory=list, description="Up to three messages about the misses")


class Evaluation(BaseModel):
    violations: list[Violation]
    staff: list[StaffStats]
    coverage: list[CoverageCell]
    wishes: list[WishResult] = []


class ValidateRequest(BaseModel):
    project: Project
    roster: list[Assignment]


class RepairRequest(BaseModel):
    project: Project
    roster: list[Assignment]
    today: DateT = Field(description="Days before this are history and are never changed")
    mode: Literal["repair", "regenerate"] = Field(
        "repair", description="repair: fewest changes; regenerate: keep only locked shifts, re-plan everything else"
    )


class Change(BaseModel):
    staff_id: str
    date: DateT
    before: str | None
    after: str | None
    notice_days: int
    fee_percent: float = Field(description="Breytingargjald as % of monthly salary (2% < 24 h, 1.3% < 1 week)")


class SolveResult(Evaluation):
    status: Literal["optimal", "feasible", "relaxed", "failed"]
    message: str
    roster: list[Assignment]
    objective: float | None = None
    solve_seconds: float
    changes: list[Change] = []


Project.model_rebuild()
