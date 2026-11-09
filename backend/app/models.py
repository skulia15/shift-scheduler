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


class ShiftType(BaseModel):
    id: str
    code: str = Field(description="Short label shown in the roster grid, e.g. 'M', 'K', 'N'")
    name: str
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$", description="May be earlier than start: crosses midnight")
    break_minutes: int = 0
    is_night: bool = False

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
    """`holiday` is reserved leave and is never scheduled over.
    A `request` is a day-off wish; once `granted` it is binding."""

    staff_id: str
    start: date
    end: date
    kind: Literal["holiday", "request"]
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
        WeightBand(name="Weekend / holiday day", days="weekend_or_holiday", start="08:00", end="24:00", weight=1.05),
        WeightBand(name="Night", days="all", start="00:00", end="08:00", weight=1.2),
        WeightBand(name="Christmas / New Year evening (165%)", days="high_holiday", start="00:00", end="24:00", weight=1.2),
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
    weekend_excess: int = 10
    overstaff: int = 1
    coverage_shortfall: int = 500


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
    `shift_ids` limits which types are balanced; None = every type they may work."""

    type: Literal["diverse_shifts"] = "diverse_shifts"
    staff_id: str
    shift_ids: list[str] | None = None


CustomRule = Annotated[
    AvoidTaskRepeatRule
    | RotateTaskEvenlyRule
    | MaxShiftTypeRule
    | ForbidSequenceRule
    | FixedAreaRule
    | DiverseShiftsRule,
    Field(discriminator="type"),
]


class Period(BaseModel):
    start: date
    days: int = Field(28, ge=1, le=84)

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
            if c.shift_id not in shift_ids or c.group_id not in group_ids:
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
            if isinstance(rule, (FixedAreaRule, DiverseShiftsRule)) and rule.staff_id not in staff_ids:
                problems.append(f"rule {rule.id}: unknown staff {rule.staff_id}")
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


class Evaluation(BaseModel):
    violations: list[Violation]
    staff: list[StaffStats]
    coverage: list[CoverageCell]


class ValidateRequest(BaseModel):
    project: Project
    roster: list[Assignment]


class SolveResult(Evaluation):
    status: Literal["optimal", "feasible", "relaxed", "failed"]
    message: str
    roster: list[Assignment]
    objective: float | None = None
    solve_seconds: float
