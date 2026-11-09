from collections import Counter
from datetime import date, timedelta

import pytest

from app.context import credited_minutes
from app.periods import next_period
from app.holidays import easter_sunday, holidays_between, icelandic_holidays
from app.models import (
    LedgerEntry,
    Competence,
    CompetenceDemand,
    Task,
    TaskDemand,
    Area,
    AreaDemand,
    DiverseShiftsRule,
    FixedAreaRule,
    Assignment,
    CoverageDemand,
    ForbidSequenceRule,
    LaborRules,
    Leave,
    PublicHoliday,
    Period,
    Project,
    ShiftType,
    Staff,
    StaffGroup,
)
from app.sample import sample_project
from app.solver import repair, solve
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
    assert credited_minutes(DAY, monday, {}, rules) == 480
    # 16–17 at 1.0, 17–24 at 1.05
    assert credited_minutes(EVE, monday, {}, rules) == 60 + 441
    # 23:30–24 at 1.05, 00–08 at 1.2
    assert credited_minutes(NIGHT, monday, {}, rules) == round(30 * 1.05 + 480 * 1.2)
    assert credited_minutes(DAY, saturday, {}, rules) == 504
    assert credited_minutes(DAY, monday, {monday: PublicHoliday(date=monday, name="h")}, rules) == 504


def test_holiday_eve_counts_from_noon_and_165_percent_hours_weigh_1_2():
    rules = LaborRules()
    eve = date(2026, 12, 24)  # Thursday
    holidays = {eve: PublicHoliday(date=eve, name="Aðfangadagur", starts="12:00", high_from="16:00")}
    # 08–12 weekday 1.0, 12–16 holiday day 1.05
    assert credited_minutes(DAY, eve, holidays, rules) == round(240 + 240 * 1.05)
    # 16–24 is 165% → 1.2
    assert credited_minutes(EVE, eve, holidays, rules) == round(480 * 1.2)


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


def test_validator_flags_leave_rest_and_missing_weekly_rest():
    project = small_project(leave=[Leave(staff_id="s0", start=START, end=START, kind="holiday")])
    roster = [Assignment(staff_id="s0", date=START + timedelta(days=i), shift_id="D") for i in range(7)]
    roster.append(Assignment(staff_id="s1", date=START, shift_id="N"))
    roster.append(Assignment(staff_id="s1", date=START + timedelta(days=1), shift_id="D"))
    rules = {v.rule for v in evaluate(project, roster).violations if v.severity == "error"}
    assert {"leave", "rest", "weekly_rest"} <= rules


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


def shifts_for(staff_id: str, plan: dict[int, str]) -> list[Assignment]:
    return [Assignment(staff_id=staff_id, date=START + timedelta(days=d), shift_id=t) for d, t in plan.items()]


def rule_hits(project: Project, roster: list[Assignment], rule: str) -> list[str]:
    return [v.severity for v in evaluate(project, roster).violations if v.rule == rule]


def test_one_day_off_after_a_night_is_not_35h_weekly_rest():
    # Night ends Tue 08:00, Tue off, evening Wed 16:00 → 32 h; no other day off in the week.
    after_night = shifts_for("s0", {0: "N", **{d: "E" for d in range(2, 8)}})
    assert rule_hits(small_project(), after_night, "weekly_rest") == ["error"]
    # A day shift ending Mon 16:00 leaves 48 h over the same day off.
    after_day = shifts_for("s0", {0: "D", **{d: "E" for d in range(2, 8)}})
    assert rule_hits(small_project(), after_day, "weekly_rest") == []


@pytest.mark.parametrize("hard,severity", [(False, "warning"), (True, "error")])
def test_two_days_off_that_are_not_consecutive_are_flagged(hard, severity):
    project = small_project(rules=LaborRules(days_off_hard=hard))
    # Week of 30 Nov: off Mon and Wed only.
    roster = shifts_for("s0", {1: "D", 3: "D", 4: "D", 5: "D", 6: "D"})
    assert rule_hits(project, roster, "days_off") == [severity]


def test_more_than_one_short_rest_in_a_week_is_flagged():
    # Evening → day twice in one week: two 8 h rests.
    roster = shifts_for("s0", {0: "E", 1: "D", 2: "E", 3: "D"})
    assert rule_hits(small_project(), roster, "short_rest_week") == ["warning"]


def test_solver_gives_two_consecutive_days_off_when_hard():
    project = small_project(rules=LaborRules(days_off_hard=True))
    result = solve(project)
    assert result.status in ("optimal", "feasible")
    assert [v for v in result.violations if v.rule in ("days_off", "weekly_rest")] == []


def test_easter_and_moving_holidays():
    assert easter_sunday(2026) == date(2026, 4, 5)
    assert easter_sunday(2027) == date(2027, 3, 28)
    days = {h.name: h.date for h in icelandic_holidays(2026)}
    assert days["Sumardagurinn fyrsti"] == date(2026, 4, 23)
    assert days["Uppstigningardagur"] == date(2026, 5, 14)
    assert days["Hvítasunnudagur"] == date(2026, 5, 24)
    assert days["Frídagur verslunarmanna"] == date(2026, 8, 3)


@pytest.mark.parametrize("agreement,majors", [("sfv", 8), ("state", 8), ("municipal", 9)])
def test_seventeen_holidays_with_agreement_specific_major_days(agreement, majors):
    holidays = icelandic_holidays(2026, agreement)
    assert len(holidays) == 17
    assert sum(h.major for h in holidays) == majors


def test_christmas_roster_target_matches_worked_example():
    # 4 weeks from Mon 14 Dec 2026: 144 h − (3.6 + 7.2 + 3.6 + 7.2) = 122.4 h (26 Dec is a Saturday).
    start = date(2026, 12, 14)
    project = small_project(
        period=Period(start=start, days=28),
        staff=[Staff(id="s0", name="A", group_ids=["g"])],
        coverage=[],
        public_holidays=holidays_between(start, 28),
    )
    assert evaluate(project, []).staff[0].target_hours == 122.4


def competence_project(**overrides) -> Project:
    staff = [Staff(id=f"s{i}", name=f"S{i}", group_ids=["g"], competence_ids=["med"] if i < 2 else []) for i in range(6)]
    return small_project(staff=staff, competences=[Competence(id="med", name="Medication")], **overrides)


def test_task_requiring_a_competence_goes_only_to_people_with_it():
    project = competence_project(
        tasks=[Task(id="meds", name="Meds", group_id="g", competence_id="med")],
        task_demand=[TaskDemand(task_id="meds", shift_id="D", count=1)],
    )
    result = solve(project)
    doers = {a.staff_id for a in result.roster if "meds" in a.task_ids}
    assert doers and doers <= {"s0", "s1"}
    assert errors(result) == []


def test_competence_minimum_is_met_on_every_shift():
    project = competence_project(competence_demand=[CompetenceDemand(competence_id="med", shift_id="D", min=1)])
    result = solve(project)
    assert errors(result) == []
    day_shift_people = Counter(a.date for a in result.roster if a.shift_id == "D" and a.staff_id in ("s0", "s1"))
    assert len(day_shift_people) == 14


def test_validator_flags_missing_competence():
    project = competence_project(competence_demand=[CompetenceDemand(competence_id="med", shift_id="D", min=1)])
    roster = [Assignment(staff_id="s4", date=START, shift_id="D")]
    assert "competence" in {v.rule for v in evaluate(project, roster).violations if v.severity == "error"}


def test_night_at_end_of_previous_roster_blocks_a_morning_on_day_one():
    history = [Assignment(staff_id="s0", date=START - timedelta(days=1), shift_id="N")]
    result = solve(small_project(history=history))
    assert not any(a.staff_id == "s0" and a.date == START and a.shift_id == "D" for a in result.roster)
    flagged = rule_hits(small_project(history=history), shifts_for("s0", {0: "D"}), "rest")
    assert flagged == ["error"]


def test_six_days_worked_before_the_period_force_rest_at_its_start():
    history = [Assignment(staff_id="s0", date=START - timedelta(days=i), shift_id="D") for i in range(1, 7)]
    result = solve(small_project(history=history))
    assert errors(result) == []
    assert not any(a.staff_id == "s0" and a.date == START for a in result.roster)


def test_next_period_moves_dates_keeps_last_week_and_adds_to_ledger():
    project = small_project(ledger=[LedgerEntry(staff_id="s0", periods=2, weekends=5)])
    roster = solve(project).roster
    nxt = next_period(project, roster)
    assert nxt.period.start == START + timedelta(days=14)
    assert nxt.history and all(START + timedelta(days=7) <= a.date < nxt.period.start for a in nxt.history)
    s0 = next(e for e in nxt.ledger if e.staff_id == "s0")
    worked = evaluate(project, roster).staff[0].weekends_worked
    assert (s0.periods, s0.weekends) == (3, 5 + worked)


def test_holiday_shifts_go_to_whoever_has_carried_fewer_before():
    holiday = START + timedelta(days=3)
    project = small_project(
        public_holidays=[PublicHoliday(date=holiday, name="H", major=True)],
        ledger=[LedgerEntry(staff_id="s0", holiday_shifts=4, major_holiday_shifts=4)],
    )
    result = solve(project)
    assert not any(a.staff_id == "s0" and a.date == holiday for a in result.roster)


def test_repair_of_a_valid_roster_changes_nothing():
    project = small_project()
    roster = solve(project).roster
    result = repair(project, roster, today=START)
    assert result.changes == []
    assert {(a.staff_id, a.date, a.shift_id) for a in result.roster} == {(a.staff_id, a.date, a.shift_id) for a in roster}


def test_sick_call_is_covered_with_few_changes_and_fee_noted():
    project = small_project()
    roster = solve(project).roster
    sick = next(a for a in roster if a.date == START + timedelta(days=5))
    project = project.model_copy(update={"leave": [Leave(staff_id=sick.staff_id, start=sick.date, end=sick.date, kind="sick")]})
    result = repair(project, roster, today=START + timedelta(days=4))
    assert errors(result) == []
    assert 1 <= len(result.changes) <= 4
    dropped = next(c for c in result.changes if c.staff_id == sick.staff_id and c.date == sick.date)
    assert dropped.after is None
    assert dropped.fee_percent == 2.0  # one day's notice


def test_repair_keeps_locked_shifts_and_the_past():
    project = small_project()
    roster = solve(project).roster
    today = START + timedelta(days=7)
    locked = next(a for a in roster if a.date == START + timedelta(days=10))
    roster = [a.model_copy(update={"locked": True}) if a is locked else a for a in roster]
    # Breaking a later day forces changes; the past and the locked shift must survive them.
    broken = [a for a in roster if not (a.date == START + timedelta(days=11) and a.shift_id == "D")]
    result = repair(project, broken, today=today)
    kept = {(a.staff_id, a.date, a.shift_id) for a in result.roster}
    assert (locked.staff_id, locked.date, locked.shift_id) in kept
    assert {(a.staff_id, a.date, a.shift_id) for a in roster if a.date < today} <= kept
    assert all(c.date >= today for c in result.changes)
    assert errors(result) == []
