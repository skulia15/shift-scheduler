"""Per-person wish rules: weekends, allowed shifts, recurring days, unavailability, shifts per week, pairs."""

from datetime import timedelta

import pytest

from app.models import (
    AllowedShiftsRule,
    Assignment,
    DiverseShiftsRule,
    RecurringShiftRule,
    ShiftsPerWeekRule,
    UnavailableWeekdaysRule,
    WeekendPatternRule,
    WorkTogetherRule,
)
from app.solver import solve
from app.validator import evaluate
from tests.test_scheduler import START, errors, small_project


def mine(result, staff_id="s0"):
    return {a.date: a.shift_id for a in result.roster if a.staff_id == staff_id}


def test_no_weekends_keeps_a_person_off_saturday_and_sunday():
    r = solve(small_project(custom_rules=[WeekendPatternRule(id="w", staff_id="s0", every=0, hard=True)]))
    assert not errors(r)
    assert all(d.weekday() < 5 for d in mine(r))


def test_every_other_weekend_counts_the_weekend_before_the_period():
    before = [Assignment(staff_id="s0", date=START - timedelta(days=n), shift_id="D") for n in (2, 1)]
    r = solve(small_project(history=before, custom_rules=[WeekendPatternRule(id="w", staff_id="s0", every=2, hard=True)]))
    assert not errors(r)
    assert not any(d.weekday() >= 5 and (d - START).days < 7 for d in mine(r))


def test_allowed_shifts_by_kind_only_on_the_given_days():
    rule = AllowedShiftsRule(id="a", staff_id="s0", kinds=["evening"], weekdays=[0, 1, 2, 3, 4], hard=True)
    r = solve(small_project(custom_rules=[rule]))
    assert not errors(r)
    assert all(t == "E" for d, t in mine(r).items() if d.weekday() < 5)


def test_recurring_shift_every_monday():
    r = solve(small_project(custom_rules=[RecurringShiftRule(id="r", staff_id="s0", weekdays=[0], kinds=["morning"], hard=True)]))
    assert not errors(r)
    mondays = [START + timedelta(days=7 * k) for k in range(2)]
    assert all(mine(r).get(d) == "D" for d in mondays)


def test_unavailable_weekday_is_never_worked():
    r = solve(small_project(custom_rules=[UnavailableWeekdaysRule(id="u", staff_id="s0", weekdays=[3], hard=True)]))
    assert not errors(r)
    assert all(d.weekday() != 3 for d in mine(r))


def test_shifts_per_week_of_a_kind():
    rule = ShiftsPerWeekRule(id="p", staff_id="s0", kinds=["night"], min=1, max=1, hard=True)
    r = solve(small_project(custom_rules=[rule]))
    assert not errors(r)
    for week in range(2):
        days = {START + timedelta(days=7 * week + i) for i in range(7)}
        assert sum(1 for d, t in mine(r).items() if d in days and t == "N") == 1


def test_diverse_by_kind_balances_morning_evening_night():
    r = solve(small_project(custom_rules=[DiverseShiftsRule(id="v", staff_id="s0", by_kind=True, hard=True)]))
    assert not errors(r)
    counts = [list(mine(r).values()).count(t) for t in ("D", "E", "N")]
    assert max(counts) - min(counts) <= 1


def _on(staff_id, plan):
    return [Assignment(staff_id=staff_id, date=START + timedelta(days=d), shift_id=t) for d, t in plan.items()]


@pytest.mark.parametrize(
    "rule,roster",
    [
        (WeekendPatternRule(id="x", staff_id="s0", every=0), _on("s0", {5: "D"})),
        (WeekendPatternRule(id="x", staff_id="s0", every=2), _on("s0", {5: "D", 12: "D"})),
        (WeekendPatternRule(id="x", staff_id="s0", every=2, both_days=True), _on("s0", {5: "D"})),
        (AllowedShiftsRule(id="x", staff_id="s0", kinds=["morning"]), _on("s0", {0: "E"})),
        (RecurringShiftRule(id="x", staff_id="s0", weekdays=[0], shift_ids=["D"]), _on("s0", {0: "E"})),
        (UnavailableWeekdaysRule(id="x", staff_id="s0", weekdays=[0]), _on("s0", {0: "D"})),
        (ShiftsPerWeekRule(id="x", staff_id="s0", kinds=["evening"], max=1), _on("s0", {0: "E", 1: "E"})),
        (ShiftsPerWeekRule(id="x", staff_id="s0", kinds=["evening"], min=1), _on("s0", {0: "D"})),
        (WorkTogetherRule(id="x", staff_id="s0", other_staff_id="s1"), _on("s0", {0: "D"})),
    ],
)
def test_validator_reports_each_unmet_wish(rule, roster):
    hits = [v for v in evaluate(small_project(custom_rules=[rule]), roster).violations if v.rule == "x"]
    assert hits and all(v.severity == "warning" and v.staff_id == "s0" for v in hits)


def test_validator_is_quiet_when_wishes_are_met():
    rules = [
        WeekendPatternRule(id="x1", staff_id="s0", every=2, both_days=True),
        RecurringShiftRule(id="x2", staff_id="s0", weekdays=[0], kinds=["morning"]),
        WorkTogetherRule(id="x3", staff_id="s0", other_staff_id="s1"),
    ]
    roster = _on("s0", {0: "D", 5: "E", 6: "E", 7: "D"}) + _on("s1", {0: "D", 5: "E", 6: "E", 7: "D"})
    assert not [v for v in evaluate(small_project(custom_rules=rules), roster).violations if v.rule.startswith("x")]
