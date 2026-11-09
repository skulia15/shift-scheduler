from collections import Counter
from datetime import date, timedelta

import pytest

from app.context import credited_minutes
from app.models import (
    Area,
    AreaDemand,
    DiverseShiftsRule,
    FixedAreaRule,
    Assignment,
    CoverageDemand,
    ForbidSequenceRule,
    LaborRules,
    Leave,
    Period,
    Project,
    ShiftType,
    Staff,
    StaffGroup,
)
from app.sample import sample_project
from app.solver import solve
from app.validator import evaluate

START = date(2026, 11, 30)  # a Monday
DAY = ShiftType(id="D", code="D", name="Day", start="08:00", end="16:00")
EVE = ShiftType(id="E", code="E", name="Evening", start="16:00", end="24:00")
NIGHT = ShiftType(id="N", code="N", name="Night", start="23:30", end="08:00", is_night=True)


def small_project(**overrides) -> Project:
    fields = dict(
        name="test",
        period=Period(start=START, days=14),
        shift_types=[DAY, EVE, NIGHT],
        groups=[StaffGroup(id="g", name="G")],
        staff=[Staff(id=f"s{i}", name=f"S{i}", group_ids=["g"]) for i in range(6)],
        coverage=[CoverageDemand(shift_id=t, group_id="g", min=1, max=1) for t in ("D", "E", "N")],
        solve_seconds=5,
    )
    fields.update(overrides)
    return Project(**fields)


def errors(result):
    return [v for v in result.violations if v.severity == "error"]


def test_credited_minutes_apply_icelandic_weighting_bands():
    rules = LaborRules()
    monday, saturday = date(2026, 11, 30), date(2026, 12, 5)
    assert credited_minutes(DAY, monday, set(), rules) == 480
    # 16–17 at 1.0, 17–24 at 1.05
    assert credited_minutes(EVE, monday, set(), rules) == 60 + 441
    # 23:30–24 at 1.05, 00–08 at 1.2
    assert credited_minutes(NIGHT, monday, set(), rules) == round(30 * 1.05 + 480 * 1.2)
    assert credited_minutes(DAY, saturday, set(), rules) == 504
    assert credited_minutes(DAY, monday, {monday}, rules) == 504


def test_weighting_cannot_take_actual_hours_below_floor():
    project = small_project(staff=[Staff(id="s0", name="A", group_ids=["g"])], coverage=[])
    # 9 weekday nights = 76.5h worked, weighted ≈ 92.6h; cap = 76.5 × 36/32 ≈ 86.1h
    nights = [Assignment(staff_id="s0", date=START + timedelta(days=i), shift_id="N") for i in (0, 1, 2, 3, 7, 8, 9, 10, 11)]
    stats = evaluate(project, nights).staff[0]
    assert stats.worked_hours == 76.5
    assert stats.credited_hours == pytest.approx(76.5 * 36 / 32, abs=0.02)


def test_sample_project_solves_without_hard_violations():
    result = solve(sample_project())
    assert result.status in ("optimal", "feasible")
    assert errors(result) == []


def test_reserved_holiday_is_never_scheduled():
    leave = [Leave(staff_id="s0", start=START, end=START + timedelta(days=6), kind="holiday")]
    result = solve(small_project(leave=leave))
    worked = {a.date for a in result.roster if a.staff_id == "s0"}
    assert worked.isdisjoint(leave[0].days())


def test_night_is_never_followed_by_a_day_shift_the_next_morning():
    result = solve(small_project())
    by_staff_day = {(a.staff_id, a.date): a.shift_id for a in result.roster}
    nights_then_day = [
        (s, d) for (s, d), t in by_staff_day.items() if t == "N" and by_staff_day.get((s, d + timedelta(days=1))) == "D"
    ]
    assert nights_then_day == []


def test_uncoverable_demand_returns_relaxed_roster_listing_gaps():
    project = small_project(staff=[Staff(id="s0", name="Solo", group_ids=["g"])])
    result = solve(project)
    assert result.status == "relaxed"
    assert {v.rule for v in errors(result)} == {"coverage"}


def test_hard_custom_sequence_rule_is_respected():
    rule = ForbidSequenceRule(id="no-e-d", from_shift_id="E", to_shift_id="D", hard=True)
    result = solve(small_project(custom_rules=[rule]))
    shifts = {(a.staff_id, a.date): a.shift_id for a in result.roster}
    assert not any(t == "E" and shifts.get((s, d + timedelta(days=1))) == "D" for (s, d), t in shifts.items())


def test_validator_flags_leave_rest_and_consecutive_days():
    project = small_project(leave=[Leave(staff_id="s0", start=START, end=START, kind="holiday")])
    roster = [Assignment(staff_id="s0", date=START + timedelta(days=i), shift_id="D") for i in range(7)]
    roster.append(Assignment(staff_id="s1", date=START, shift_id="N"))
    roster.append(Assignment(staff_id="s1", date=START + timedelta(days=1), shift_id="D"))
    rules = {v.rule for v in evaluate(project, roster).violations if v.severity == "error"}
    assert {"leave", "rest", "consecutive_days", "days_off_per_week"} <= rules


@pytest.mark.parametrize("percent,expected_hours", [(100, 72.0), (50, 36.0)])
def test_target_hours_scale_with_employment_percent(percent, expected_hours):
    project = small_project(staff=[Staff(id="s0", name="A", group_ids=["g"], employment_percent=percent)], coverage=[])
    stats = evaluate(project, []).staff[0]
    assert stats.target_hours == expected_hours


def area_project(**overrides) -> Project:
    return small_project(
        areas=[Area(id="A", code="A", name="A"), Area(id="B", code="B", name="B")],
        area_demand=[AreaDemand(area_id=a, shift_id="D", group_id="g", min=1) for a in ("A", "B")],
        coverage=[CoverageDemand(shift_id="D", group_id="g", min=2, max=2), CoverageDemand(shift_id="E", group_id="g", min=1, max=1)],
        **overrides,
    )


def test_everyone_on_an_area_shift_is_placed_and_area_headcount_met():
    result = solve(area_project())
    assert errors(result) == []
    day_shifts = [a for a in result.roster if a.shift_id == "D"]
    assert all(a.area_id in ("A", "B") for a in day_shifts)
    assert all(a.area_id is None for a in result.roster if a.shift_id == "E")


def test_fixed_area_rule_pins_person_to_their_area():
    rule = FixedAreaRule(id="pin", staff_id="s0", area_id="B", hard=True)
    result = solve(area_project(custom_rules=[rule]))
    mine = [a for a in result.roster if a.staff_id == "s0"]
    assert mine and all(a.area_id == "B" for a in mine)


def test_validator_flags_wrong_area_for_pinned_person():
    rule = FixedAreaRule(id="pin", staff_id="s0", area_id="B", hard=True)
    roster = [Assignment(staff_id="s0", date=START, shift_id="D", area_id="A")]
    found = {(v.rule, v.severity) for v in evaluate(area_project(custom_rules=[rule]), roster).violations}
    assert ("pin", "error") in found


def test_diverse_shifts_rule_balances_a_persons_shift_mix():
    rule = DiverseShiftsRule(id="mix", staff_id="s0", hard=True)
    result = solve(small_project(custom_rules=[rule]))
    counts = Counter(a.shift_id for a in result.roster if a.staff_id == "s0")
    assert max(counts[t] for t in "DEN") - min(counts[t] for t in "DEN") <= 1
    assert not [v for v in result.violations if v.rule == "mix"]
