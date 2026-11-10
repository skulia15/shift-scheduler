"""Roll a finished roster forward into the next planning period."""

from __future__ import annotations

from datetime import timedelta

from .holidays import holidays_between
from .models import Assignment, LedgerEntry, Period, Project, same_day_next_month
from .validator import evaluate

HISTORY_DAYS = 7


def next_period(project: Project, roster: list[Assignment]) -> Project:
    """Same unit and rules, the following dates; the last week becomes history and the
    period's weekends, nights, holiday shifts and overtime are added to the ledger."""
    evaluation = evaluate(project, roster)
    start = project.period.start + timedelta(days=project.period.days)
    days = project.period.days
    if project.period.monthly:
        start = same_day_next_month(project.period.start)
        days = (same_day_next_month(start) - start).days
    prior = {e.staff_id: e for e in project.ledger}
    ledger = []
    for st in evaluation.staff:
        e = prior.get(st.staff_id, LedgerEntry(staff_id=st.staff_id))
        ledger.append(
            LedgerEntry(
                staff_id=st.staff_id,
                periods=e.periods + 1,
                weekends=e.weekends + st.weekends_worked,
                nights=e.nights + st.night_shifts,
                holiday_shifts=e.holiday_shifts + st.holiday_shifts,
                major_holiday_shifts=e.major_holiday_shifts + st.major_holiday_shifts,
                overtime_hours=round(e.overtime_hours + st.overtime_hours, 2),
                requests_denied=e.requests_denied + st.requests_denied,
            )
        )
    return project.model_copy(
        update={
            "period": Period(start=start, days=days, monthly=project.period.monthly),
            "history": [a for a in roster if start - timedelta(days=HISTORY_DAYS) <= a.date < start],
            "ledger": ledger,
            "leave": [lv for lv in project.leave if lv.end >= start],
            "public_holidays": holidays_between(start, days, project.rules.agreement),
        }
    )
