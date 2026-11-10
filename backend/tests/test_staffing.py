"""Staffing that matches practice: preferred headcount, fallback shifts, linked shifts."""

from datetime import timedelta

from app.models import Assignment, CoverageDemand, LinkedShiftRule, ShiftType, Staff
from app.solver import solve
from app.validator import evaluate
from tests.test_scheduler import DAY, EVE, NIGHT, START, errors, small_project

PART = ShiftType(id="P", code="P", name="Part", start="08:00", end="13:00")


def count(result, shift_id):
    return [sum(1 for a in result.roster if a.date == START + timedelta(days=d) and a.shift_id == shift_id) for d in range(14)]


def test_preferred_headcount_is_reached_when_staff_allow():
    cov = [CoverageDemand(shift_id="D", group_id="g", min=1, preferred=2), CoverageDemand(shift_id="E", group_id="g", min=1, max=1), CoverageDemand(shift_id="N", group_id="g", min=1, max=1)]
    staff = [Staff(id=f"s{i}", name=f"S{i}", group_ids=["g"]) for i in range(8)]
    r = solve(small_project(coverage=cov, staff=staff))
    assert not errors(r)
    assert all(n >= 2 for n in count(r, "D"))
    assert not [v for v in r.violations if v.rule == "preferred_coverage"]


def test_validator_warns_below_preferred_but_not_below_min():
    cov = [CoverageDemand(shift_id="D", group_id="g", min=1, preferred=3)]
    roster = [Assignment(staff_id="s0", date=START, shift_id="D")]
    hits = [v for v in evaluate(small_project(coverage=cov, period={"start": START, "days": 1}), roster).violations if v.rule.endswith("coverage")]
    assert [v.rule for v in hits] == ["preferred_coverage"] and hits[0].severity == "warning"


def test_fallback_shift_counts_for_the_shift_it_covers():
    cov = [CoverageDemand(shift_id="D", group_id="g", min=2), CoverageDemand(shift_id="P", group_id="g", max=1, fallback=True, covers_shift_id="D")]
    roster = [Assignment(staff_id="s0", date=START, shift_id="D"), Assignment(staff_id="s1", date=START, shift_id="P")]
    p = small_project(shift_types=[DAY, EVE, NIGHT, PART], coverage=cov, period={"start": START, "days": 1})
    assert not [v for v in evaluate(p, roster).violations if v.rule == "coverage"]


def test_fallback_shift_is_left_empty_when_not_needed():
    cov = [
        CoverageDemand(shift_id="D", group_id="g", min=1, max=2),
        CoverageDemand(shift_id="E", group_id="g", min=1, max=1),
        CoverageDemand(shift_id="N", group_id="g", min=1, max=1),
        CoverageDemand(shift_id="P", group_id="g", max=1, fallback=True, covers_shift_id="D"),
    ]
    r = solve(small_project(shift_types=[DAY, EVE, NIGHT, PART], coverage=cov))
    assert not errors(r)
    assert sum(count(r, "P")) == 0


def test_linked_shift_saturday_evening_then_sunday_evening():
    rule = LinkedShiftRule(id="l", from_shift_id="E", weekdays=[5], to_shift_id="E", hard=True)
    r = solve(small_project(custom_rules=[rule]))
    assert not errors(r)
    by = {(a.staff_id, a.date): a.shift_id for a in r.roster}
    for sat in (START + timedelta(days=5), START + timedelta(days=12)):
        who = [s for (s, d), t in by.items() if d == sat and t == "E"]
        assert who and all(by.get((s, sat + timedelta(days=1))) == "E" for s in who)


def test_validator_flags_a_broken_link():
    rule = LinkedShiftRule(id="l", from_shift_id="E", weekdays=[5], to_shift_id="E")
    roster = [Assignment(staff_id="s0", date=START + timedelta(days=5), shift_id="E")]
    hits = [v for v in evaluate(small_project(custom_rules=[rule]), roster).violations if v.rule == "l"]
    assert len(hits) == 1 and hits[0].date == START + timedelta(days=6)


def test_count_notes_read_preferred_and_linked_shifts():
    from app.workbook import linked_shift, parse_staffing_note, preferred_count

    assert preferred_count("alla daga - helst að hafa 5") == 5
    rules, certain, _ = parse_staffing_note("alla daga - helst að hafa 5", observed_min=5, observed_median=5)
    assert rules == [([0, 1, 2, 3, 4, 5, 6], 4, None)] and not certain
    late = ShiftType(id="L", code="L", name="Late", start="17:00", end="23:00")
    assert linked_shift("lau - 1; sú á laugardegi fær 17:00-23:00 á sun", [DAY, late]) == (5, "L", 1)
    assert linked_shift("lau - 1", [DAY, late]) is None
