"""Icelandic public holidays as the collective agreements define them (gr. 2.1.4.2–3).

17 sérstakir frídagar; of these, 8 are stórhátíðardagar (9 with 1. maí under the SNS agreements).
Aðfangadagur and gamlársdagur are holidays from 12:00, carry 165% from 16:00 until 08:00 the next
morning, and reduce full-time duty by 3.6 h instead of 7.2 h.
"""

from __future__ import annotations

from datetime import date, timedelta

from .models import Agreement, PublicHoliday


def easter_sunday(year: int) -> date:
    """Gregorian Easter (anonymous Gregorian / Meeus algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = (h + l_ - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def _first_thursday_after_april_18(year: int) -> date:
    d = date(year, 4, 19)
    return d + timedelta(days=(3 - d.weekday()) % 7)


def _first_monday_of_august(year: int) -> date:
    d = date(year, 8, 1)
    return d + timedelta(days=(0 - d.weekday()) % 7)


def icelandic_holidays(year: int, agreement: Agreement = "sfv") -> list[PublicHoliday]:
    easter = easter_sunday(year)
    may_day_major = agreement == "municipal"

    def h(day: date, name: str, major: bool = False, eve: bool = False) -> PublicHoliday:
        if eve:
            return PublicHoliday(date=day, name=name, major=True, duty_reduction_hours=3.6, starts="12:00", high_from="16:00")
        return PublicHoliday(date=day, name=name, major=major)

    return [
        h(date(year, 1, 1), "Nýársdagur", major=True),
        h(easter - timedelta(days=3), "Skírdagur"),
        h(easter - timedelta(days=2), "Föstudagurinn langi", major=True),
        h(easter - timedelta(days=1), "Laugardagur fyrir páska"),
        h(easter, "Páskadagur", major=True),
        h(easter + timedelta(days=1), "Annar í páskum"),
        h(_first_thursday_after_april_18(year), "Sumardagurinn fyrsti"),
        h(date(year, 5, 1), "1. maí", major=may_day_major),
        h(easter + timedelta(days=39), "Uppstigningardagur"),
        h(easter + timedelta(days=49), "Hvítasunnudagur", major=True),
        h(easter + timedelta(days=50), "Annar í hvítasunnu"),
        h(date(year, 6, 17), "Þjóðhátíðardagurinn 17. júní", major=True),
        h(_first_monday_of_august(year), "Frídagur verslunarmanna"),
        h(date(year, 12, 24), "Aðfangadagur", eve=True),
        h(date(year, 12, 25), "Jóladagur", major=True),
        h(date(year, 12, 26), "Annar í jólum"),
        h(date(year, 12, 31), "Gamlársdagur", eve=True),
    ]


def holidays_between(start: date, days: int, agreement: Agreement = "sfv") -> list[PublicHoliday]:
    end = start + timedelta(days=days - 1)
    found = [hol for year in range(start.year, end.year + 1) for hol in icelandic_holidays(year, agreement)]
    return sorted((hol for hol in found if start <= hol.date <= end), key=lambda hol: hol.date)
