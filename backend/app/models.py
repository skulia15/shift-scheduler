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


class Task(BaseModel):
    id: str
    name: str
    group_id: str


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
    days: Literal["weekday", "weekend_or_holiday", "all"]
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$", description="24:00 allowed; must be after start")
    weight: float


def _icelandic_bands() -> list[WeightBand]:
    return [
        WeightBand(name="Weekday evening", days="weekday", start="17:00", end="24:00", weight=1.05),
        WeightBand(name="Weekend / holiday day", days="weekend_or_holiday", start="08:00", end="24:00", weight=1.05),
        WeightBand(name="Night", days="all", start="00:00", end="08:00", weight=1.2),
    ]


class PublicHoliday(BaseModel):
    """Counts as a weekend day for weighting. Reduces full-time duty by `duty_reduction_hours`
    when it falls on a weekday (betri vinnutími: 7.2h, 3.6h for aðfangadagur / gamlársdagur)."""

    date: DateT
    name: str
    duty_reduction_hours: float = 7.2


class LaborRules(BaseModel):
    """Working-time rules. Defaults follow Icelandic shift-work agreements (docs/research)."""

    full_time_weekly_hours: float = 36.0
    weight_bands: list[WeightBand] = Field(default_factory=_icelandic_bands)
    min_actual_weekly_hours: float | None = Field(
        32.0, description="Weighting may not bring a full-timer's actual hours below this (pro rata)"
    )
    min_rest_hours: float = Field(11, description="Target daily rest; shorter rest is penalised")
    min_rest_hours_absolute: float = Field(8, description="Rest may never be shorter than this (shift-type change)")
    max_shift_hours: float = 13
    max_consecutive_days: int | None = Field(6, description="Statute: a day off in every 7")
    min_days_off_per_week: int | None = Field(2, description="Per Mon–Sun week")
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


CustomRule = Annotated[
    AvoidTaskRepeatRule | RotateTaskEvenlyRule | MaxShiftTypeRule | ForbidSequenceRule,
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
        if problems:
            raise ValueError("; ".join(problems))
        return self


class Assignment(BaseModel):
    staff_id: str
    date: DateT
    shift_id: str
    task_ids: list[str] = []


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
    group_id: str
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
