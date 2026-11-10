"""Staffing that matches practice: preferred headcount, fallback shifts, linked shifts."""

from datetime import date, timedelta

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


def test_monthly_period_runs_15th_to_14th_whatever_the_month_length():
    from datetime import date

    from app.models import Period
    from app.periods import next_period

    p = small_project(period=Period(start=date(2027, 1, 15), days=31, monthly=True))
    nxt = next_period(p, [])
    assert (nxt.period.start, nxt.period.days, nxt.period.monthly) == (date(2027, 2, 15), 28, True)
    assert next_period(nxt, []).period.days == 31  # 15 Mar – 14 Apr


def test_export_starts_with_the_planners_layout_and_reads_back():
    import io

    from openpyxl import load_workbook

    from app.spreadsheet import export_roster
    from app.workbook import import_workbook

    p = small_project()
    roster = solve(p).roster
    data = export_roster(p, roster)
    ws = load_workbook(io.BytesIO(data)).worksheets[0]
    assert ws.title == "Vaktaskýrsla" and ws["A2"].value == "S0"
    assert any(str(c.value).startswith("=COUNTIF(") for row in ws.iter_rows() for c in row)
    back = import_workbook(data)
    assert back.people == 6 and back.shifts_imported == len(roster)


def test_workbook_absences_and_sections_come_in():
    """Black and grey cells become leave, a whole coloured row is away all period, an orange line starts a section."""
    import io

    from openpyxl import Workbook
    from openpyxl.styles import PatternFill

    from app.workbook import import_workbook

    days = [date(2027, 1, 4) + timedelta(days=k) for k in range(7)]
    wb = Workbook()
    ws = wb.active
    ws.append([*days, "Hlutfall"])
    ws.append(["08:00-16:00", None, None, None, None, None, "08:00-16:00", 0.5])  # black on days 2-3
    ws.append([None] * 7 + [0.8])  # red all period
    ws.append([None] * 7)  # orange divider
    ws.append(["16:00-24:00", None, None, None, None, None, None, 0.5])  # grey on days 4-6
    black, grey = PatternFill("solid", fgColor="FF000000"), PatternFill("solid", fgColor="FFA6A6A6")  # as Excel writes them
    for c in (2, 3):
        ws.cell(row=2, column=c).fill = black
    for c in range(1, 8):
        ws.cell(row=3, column=c).fill = PatternFill("solid", fgColor="C00000")
        ws.cell(row=4, column=c).fill = PatternFill("solid", fgColor="ED7D31")
    for c in (4, 5, 6):
        ws.cell(row=5, column=c).fill = grey
    out = io.BytesIO()
    wb.save(out)
    p = import_workbook(out.getvalue()).project
    by = {(lv.staff_id, lv.start, lv.end, lv.kind, lv.granted) for lv in p.leave}
    assert ("p1", days[1], days[2], "request", True) in by
    assert ("p2", days[0], days[6], "holiday", False) in by
    assert ("p3", days[3], days[5], "holiday", False) in by
    assert [s.group_ids[0] for s in p.staff] == ["staff", "staff", "staff2"]
    assert p.groups[1].color == "ED7D31"
