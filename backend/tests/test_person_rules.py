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


# Wish notes → suggested rules (synthetic notes in the planner's style).
from app.models import FixedAreaRule  # noqa: E402
from app.wishes import parse_wish  # noqa: E402
from app.models import ShiftType  # noqa: E402

UNIT_SHIFTS = [
    ShiftType(id="M", code="M", name="M", start="08:00", end="16:00"),
    ShiftType(id="M730", code="M730", name="M730", start="07:30", end="15:30"),
    ShiftType(id="M-13", code="M-13", name="M-13", start="08:00", end="13:00"),
    ShiftType(id="K", code="K", name="K", start="16:00", end="23:30"),
    ShiftType(id="K17", code="K17", name="K17", start="17:00", end="23:00"),
    ShiftType(id="K18", code="K18", name="K18", start="18:00", end="00:00"),
    ShiftType(id="N", code="N", name="N", start="23:30", end="07:30", is_night=True),
]


def wish(note):
    out = []
    for _, r in parse_wish(note, "p", UNIT_SHIFTS, [("yellow", "Guli gangur")]):
        d = r.model_dump(exclude={"id", "staff_id", "description", "enabled", "hard", "weight"}, exclude_none=True)
        if d.get("weekdays") == list(range(7)):
            d.pop("weekdays")
        out.append(d)
    return out


@pytest.mark.parametrize(
    "note,expected",
    [
        ("Önnur hver helgi", [{"type": "weekend_pattern", "every": 2, "both_days": False}]),
        ("Engar helgar", [{"type": "weekend_pattern", "every": 0, "both_days": False}]),
        ("Þriðju hverja helgi NV", [{"type": "weekend_pattern", "every": 3, "both_days": False}, {"type": "allowed_shifts", "kinds": ["night"], "weekdays": [5, 6]}]),
        ("önnur hvor helgi 8-13", [{"type": "weekend_pattern", "every": 2, "both_days": False}, {"type": "allowed_shifts", "shift_ids": ["M-13"], "weekdays": [5, 6]}]),
        ("Bara KV", [{"type": "allowed_shifts", "kinds": ["evening"]}]),
        ("bara MV á virkum dögum", [{"type": "allowed_shifts", "kinds": ["morning"], "weekdays": [0, 1, 2, 3, 4]}]),
        ("Ekki kvöldvaktir", [{"type": "allowed_shifts", "kinds": ["morning", "night"]}]),
        ("Ekki vakt á þri og fös", [{"type": "unavailable_weekdays", "weekdays": [1, 4]}]),
        ("Tvær MV í viku", [{"type": "shifts_per_week", "kinds": ["morning"], "min": 2, "max": 2}]),
        ("ca 1 kvöldvakt í viku", [{"type": "shifts_per_week", "kinds": ["evening"], "max": 1}]),
        ("Alla miðvikudaga 18-00", [{"type": "recurring_shift", "weekdays": [2], "shift_ids": ["K18"]}]),
        ("KV á fimmtudögum", [{"type": "recurring_shift", "weekdays": [3], "kinds": ["evening"]}]),
        ("alltaf 7.30-15.30", [{"type": "allowed_shifts", "shift_ids": ["M730", "K", "K17", "K18", "N"]}]),
        ("kemst ekki kl. 16", [{"type": "allowed_shifts", "shift_ids": ["M", "M730", "M-13", "K17", "K18", "N"]}]),
        ("Blandaðar vaktir MV og KV", [{"type": "diverse_shifts", "by_kind": True, "kinds": ["morning", "evening"]}, {"type": "allowed_shifts", "kinds": ["morning", "evening"]}]),
        ("Alltaf á gula ganginum", [{"type": "fixed_area", "area_id": "yellow"}]),
        ("Stundum KV á mánudögum", []),
        ("Einn föstudag í mánuði", []),
    ],
)
def test_wish_notes_become_rule_suggestions(note, expected):
    assert wish(note) == expected


def test_suggested_rules_solve_and_are_soft():
    project = small_project()
    project.staff[0].note = "Önnur hver helgi. Ekki vakt á miðvikudögum, Tvær MV í viku"
    from app.wishes import suggest_rules

    found = suggest_rules(project)
    assert found and all(not s.rule.hard for s in found)
    project.custom_rules = [s.rule for s in found]
    assert not errors(solve(project))
    assert suggest_rules(project) == []  # already accepted


def test_evaluation_reports_each_wish_with_its_misses():
    from app.models import Leave

    rules = [UnavailableWeekdaysRule(id="u", staff_id="s0", weekdays=[0], description="Not Mondays")]
    leave = [Leave(staff_id="s0", start=START + timedelta(days=2), end=START + timedelta(days=3), kind="request")]
    roster = _on("s0", {0: "D", 7: "D", 2: "E"})
    wishes = evaluate(small_project(custom_rules=rules, leave=leave), roster).wishes
    by = {w.rule_id: w for w in wishes}
    assert (by["u"].description, by["u"].misses) == ("Not Mondays", 2)
    assert (by["requests"].misses, by["requests"].total) == (1, 2)
