"""Turn a planner's roster workbook into a whole Vaktaplan project.

The layout this reads is the one units keep by hand: one row per person, one column per day with a
clock time in each worked cell ("08:00-16:00"), cell colour for the kind of shift, per-person
columns to the right (employment fraction "Hlutfall", wishes "óskir"), and below the people a
block of count rows (people per clock time per day) with a note on what the count should be
("mán-fim - 1; fös-sun - 2").

From that it builds: people (mock names when the sheet has none), employment %, every clock time
as a shift type grouped into morning / evening / night, the roster, each wish as a note, and
staffing rows read from the count notes. Everything it had to guess is listed in the report.
"""

from __future__ import annotations

import io
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from openpyxl import load_workbook
from pydantic import BaseModel, Field

from .holidays import holidays_between
from .models import Assignment, CoverageDemand, Period, Project, ShiftType, Staff, StaffGroup
from .wishes import WishSuggestion, suggest_rules

TIME_RANGE = re.compile(r"^\s*(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\s*$")
CATEGORY_LETTER = {"morning": "M", "evening": "K", "night": "N"}
CATEGORY_NAME = {"morning": "Morgunvakt", "evening": "Kvöldvakt", "night": "Næturvakt"}
GROUP_ID = "staff"

DAYS_IS = {"mán": 0, "man": 0, "þri": 1, "thri": 1, "mið": 2, "mid": 2, "fim": 3, "fös": 4, "fos": 4, "lau": 5, "sun": 6}
ALL, WEEKDAYS, WEEKEND = list(range(7)), [0, 1, 2, 3, 4], [5, 6]


class StaffingRead(BaseModel):
    """One count row from the sheet and what it became."""

    note: str
    shift_id: str | None
    rows: int
    certain: bool
    detail: str


class WorkbookImport(BaseModel):
    project: Project
    roster: list[Assignment]
    sheet: str
    people: int
    named: bool
    shifts_imported: int
    shift_types: int
    staffing: list[StaffingRead]
    wishes: list[WishSuggestion] = Field(default_factory=list, description="Rules suggested from the wishes column")
    warnings: list[str]


# ---------------------------------------------------------------- mock names

_FIRST_F = [
    "Anna", "Sigrún", "Guðrún", "Helga", "Kristín", "Margrét", "Sóley", "Hildur", "Ragnheiður", "Ásdís",
    "Edda", "Elín", "Freyja", "Harpa", "Ingibjörg", "Jóhanna", "Katla", "Rakel", "Sunna", "Thelma",
    "Una", "Vigdís", "Þórunn", "Auður", "Berglind", "Dagný", "Erla", "Fríða", "Gyða", "Hrefna",
    "Íris", "Karen", "Linda", "Nanna", "Ólína", "Rósa", "Svava", "Tinna", "Valgerður", "Yrsa",
]
_FIRST_M = ["Jón", "Gunnar", "Einar", "Ólafur", "Stefán", "Árni", "Björn", "Páll", "Kári", "Hrafn", "Tómas", "Ari"]
# (daughter, son) patronymics
_FATHERS = [
    ("Jónsdóttir", "Jónsson"), ("Gunnarsdóttir", "Gunnarsson"), ("Sigurðardóttir", "Sigurðsson"), ("Einarsdóttir", "Einarsson"),
    ("Ólafsdóttir", "Ólafsson"), ("Magnúsdóttir", "Magnússon"), ("Stefánsdóttir", "Stefánsson"), ("Helgadóttir", "Helgason"),
    ("Árnadóttir", "Árnason"), ("Björnsdóttir", "Björnsson"), ("Pálsdóttir", "Pálsson"), ("Kristjánsdóttir", "Kristjánsson"),
    ("Davíðsdóttir", "Davíðsson"), ("Hauksdóttir", "Hauksson"),
]
_FOREIGN = ["Joanna Kowalska", "Maria Santos", "Agnieszka Nowak", "Rasa Petrauskienė", "Ana Reyes", "Oksana Melnyk", "Daniel Costa", "Lina Jonaitytė"]


def mock_names(n: int, avoid: set[str]) -> list[str]:
    """Deterministic, unique Icelandic-style names; skips first names that appear in the sheet's notes."""
    names: list[str] = []
    foreign = iter(_FOREIGN)
    i = 0
    while len(names) < n:
        if i % 9 == 8 and (name := next(foreign, None)):
            pass
        elif i % 6 == 5:
            name = f"{_FIRST_M[i % len(_FIRST_M)]} {_FATHERS[(i * 7) % len(_FATHERS)][1]}"
        else:
            name = f"{_FIRST_F[i % len(_FIRST_F)]} {_FATHERS[(i * 5 + i // len(_FIRST_F)) % len(_FATHERS)][0]}"
        i += 1
        if name.split(" ")[0].casefold() in avoid or name in names:
            continue
        names.append(name)
    return names


# ---------------------------------------------------------------- reading


@dataclass
class _Sheet:
    title: str
    values: list[list[object]]
    fills: list[list[str | None]]


def _load(content: bytes) -> list[_Sheet]:
    wb = load_workbook(io.BytesIO(content), data_only=True)
    sheets = []
    for ws in wb.worksheets:
        values, fills = [], []
        for row in ws.iter_rows():
            values.append([c.value for c in row])
            fills.append([_fill(c) for c in row])
        sheets.append(_Sheet(ws.title, values, fills))
    return sheets


def _fill(cell) -> str | None:
    try:
        if cell.fill is None or cell.fill.fill_type is None:
            return None
        rgb = cell.fill.fgColor.rgb
        return rgb if isinstance(rgb, str) and rgb not in ("00000000", "FFFFFFFF") else None
    except (AttributeError, TypeError, ValueError):
        return None


def _as_date(v: object) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def _date_header(values: list[list[object]]) -> tuple[int, list[int], list[date], list[str]] | None:
    """(row, columns, dates, warnings) for the first row with a run of at least 7 dates.
    Fixes a year that goes backwards (31.12 followed by 1.1 of the same year)."""
    for r, row in enumerate(values[:25]):
        cols = [c for c, v in enumerate(row) if _as_date(v)]
        if len(cols) < 7:
            continue
        dates: list[date] = []
        fixed = 0
        for c in cols:
            d = _as_date(row[c])
            while dates and d <= dates[-1]:
                d = d.replace(year=d.year + 1)
                fixed += 1
            dates.append(d)
        warnings = [f"{fixed} day headers had the wrong year and were moved forward"] if fixed else []
        return r, cols, dates, warnings
    return None


def _time_range(v: object) -> tuple[str, str] | None:
    if not isinstance(v, str):
        return None
    m = TIME_RANGE.match(v)
    if not m:
        return None
    h1, m1, h2, m2 = (int(x) for x in m.groups())
    if h1 > 24 or h2 > 24 or m1 > 59 or m2 > 59:
        return None
    return f"{h1:02d}:{m1:02d}", f"{h2 % 24:02d}:{m2:02d}"


def _number(v: object) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


# ---------------------------------------------------------------- staffing notes


def _weekday_set(text: str) -> list[int] | None:
    t = text.casefold()
    if "alla daga" in t:
        return ALL
    if re.search(r"virk(a|ir|um)\s+dag", t):
        return WEEKDAYS
    if "helg" in t:
        return WEEKEND
    m = re.search(r"([a-zþæðöáéíóúý]{3})\w*\.?\s*[-–]\s*([a-zþæðöáéíóúý]{3})", t)
    if m and m.group(1) in DAYS_IS and m.group(2) in DAYS_IS:
        a, b = DAYS_IS[m.group(1)], DAYS_IS[m.group(2)]
        return [(a + i) % 7 for i in range((b - a) % 7 + 1)]
    found = [DAYS_IS[w] for w in re.findall(r"[a-zþæðöáéíóúý]{3}", t) if w in DAYS_IS]
    return sorted(set(found)) or None


_CLOCK = re.compile(r"\d{1,2}[:.]\d{2}|\b\d{1,2}\s*[-–]\s*\d{1,2}\b")
_COUNT = [
    re.compile(r"^\s*[-–]?\s*(\d{1,2})\b"),  # "- 1 á þessari vakt" after the weekdays
    re.compile(r"[-–]\s*(\d{1,2})\b"),
    re.compile(r"\b(\d{1,2})\s+á\s+(?:þ\w*|vakt)"),  # "1 á þessari vakt", "2 á vakt"
    re.compile(r"\b(?:alltaf|hafa|minnst)\s+(\d{1,2})\b"),
]


def _count_in(text: str) -> int | None:
    """A headcount in a planner's note; clock times ("7:30", "17:00-23:00", "8-13") are not counts."""
    t = _CLOCK.sub(" ", text)
    for pattern in _COUNT:
        m = pattern.search(t)
        if m:
            return int(m.group(1))
    return None


def parse_staffing_note(note: str, observed_min: int, observed_median: int) -> tuple[list[tuple[list[int], int, int | None]], bool, str]:
    """[(weekdays, min, max)] from a planner's note, whether it is certain, and how it was read."""
    t = note.casefold().strip()
    rules: list[tuple[list[int], int, int | None]] = []
    guessed = False
    if "þarf ekki alltaf" in t:
        days = _weekday_set(t) or ALL
        cap = 1 if re.search(r"(ekki|ekki leyfi).{0,30}fleiri en 1", t) else None
        return [(days, 0, cap)], True, "optional shift (min 0)"
    if "helst" in t:
        days = _weekday_set(t) or ALL
        return [(days, observed_min, None)], False, f"preferred, not required; set to the lowest count in the sheet ({observed_min})"
    clauses = [c for c in re.split(r";", t) if c.strip()]
    for k, clause in enumerate(clauses):
        main, _, exception = clause.partition("nema")
        days = _weekday_set(_CLOCK.sub(" ", main))
        n = _count_in(main.split(" - ", 1)[1] if " - " in main else main)
        if days is None:
            continue
        if n is None:
            if k > 0:
                continue  # a remark after the rule ("the one on Saturday gets Sunday too"), not a count
            n = observed_median
            guessed = True
        if exception:
            ex_days = _weekday_set(exception) or []
            ex_n = _count_in(exception)
            rules.append(([d for d in days if d not in ex_days], n, None))
            if ex_n:
                rules.append((ex_days, ex_n, None))
        else:
            rules.append((days, n, None))
    if not rules:
        days = _weekday_set(t) or ALL
        return [(days, 0, None)], False, "no count in the note; not required (min 0)"
    if guessed:
        return rules, False, f"no count in the note; set to the usual count in the sheet ({observed_median})"
    return rules, True, "read from the note"


# ---------------------------------------------------------------- import


def import_workbook(content: bytes, lang: str = "is") -> WorkbookImport:
    for sheet in _load(content):
        header = _date_header(sheet.values)
        if header is None:
            continue
        return _import_sheet(sheet, header, lang)
    raise ValueError("No sheet with a row of day dates (at least 7) was found")


def _import_sheet(sheet: _Sheet, header: tuple[int, list[int], list[date], list[str]], lang: str) -> WorkbookImport:
    hrow, cols, dates, warnings = header
    warnings = list(warnings)
    values, fills = sheet.values, sheet.fills
    head = values[hrow]
    after = range(max(cols) + 1, len(head))
    label = {c: str(head[c]).strip().casefold() for c in after if isinstance(head[c], str)}
    hlutfall_col = next((c for c, v in label.items() if v == "hlutfall"), None) or next((c for c, v in label.items() if "hlutfall" in v and "/" not in v), None)
    wish_col = next((c for c, v in label.items() if v in ("óskir", "oskir", "óskir starfsmanna")), None)
    name_col = next((c for c in range(min(cols)) if any(isinstance(r[c], str) and r[c].strip() and not _time_range(r[c]) for r in values[hrow + 1 :] if c < len(r))), None)

    people_rows: list[int] = []
    count_rows: list[int] = []
    for r in range(hrow + 1, len(values)):
        row = values[r]
        day_vals = [row[c] if c < len(row) else None for c in cols]
        times = sum(1 for v in day_vals if _time_range(v))
        numbers = sum(1 for v in day_vals if _number(v) is not None)
        extra = [row[c] for c in after if c < len(row) and row[c] not in (None, "")]
        if numbers >= len(cols) // 2 and times == 0:
            count_rows.append(r)
        elif times or (hlutfall_col is not None and hlutfall_col < len(row) and _number(row[hlutfall_col]) is not None):
            people_rows.append(r)
        elif any(v not in (None, "") for v in day_vals) or extra:
            stray = [str(v) for v in day_vals if v not in (None, "")]
            if stray:
                warnings.append(f"Row {r + 1}: skipped, no shifts or employment (found {', '.join(stray[:3])})")

    # Clock times → shift types, grouped by the colour planners gave them, falling back to start time.
    time_count: Counter[tuple[str, str]] = Counter()
    time_colour: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for r in people_rows:
        for c in cols:
            if c >= len(values[r]):
                continue
            tr = _time_range(values[r][c])
            if tr:
                time_count[tr] += 1
                if fills[r][c]:
                    time_colour[tr][fills[r][c]] += 1
    probe = {tr: ShiftType(id="x", code="x", name="x", start=tr[0], end=tr[1]).kind for tr in time_count}
    colour_kind: dict[str, Counter[str]] = defaultdict(Counter)
    for tr, colours in time_colour.items():
        for colour, n in colours.items():
            colour_kind[colour][probe[tr]] += n
    kind_of = {}
    for tr in time_count:
        colour = time_colour[tr].most_common(1)[0][0] if time_colour[tr] else None
        kind_of[tr] = colour_kind[colour].most_common(1)[0][0] if colour else probe[tr]
    shift_types = _shift_types(time_count, kind_of, lang)
    shift_by_time = {(s.start, s.end): s.id for s in shift_types}

    # People.
    wishes_text = " ".join(str(values[r][wish_col]) for r in people_rows + count_rows if wish_col is not None and wish_col < len(values[r]) and values[r][wish_col])
    notes_text = " ".join(str(v) for r in count_rows for v in values[r] if isinstance(v, str))
    avoid = {w.casefold() for w in re.findall(r"[A-ZÁÐÉÍÓÚÝÞÆÖ][a-záðéíóúýþæö]+", wishes_text + " " + notes_text)}
    named = name_col is not None
    names = mock_names(len(people_rows), avoid) if not named else []
    staff: list[Staff] = []
    roster: list[Assignment] = []
    worked_minutes: dict[str, int] = {}
    for i, r in enumerate(people_rows):
        row = values[r]
        sid = f"p{i + 1}"
        name = str(row[name_col]).strip() if named and row[name_col] else (names[i] if not named else f"Starfsmaður {i + 1}")
        fraction = _number(row[hlutfall_col]) if hlutfall_col is not None and hlutfall_col < len(row) else None
        minutes = 0
        for c, d in zip(cols, dates):
            tr = _time_range(row[c]) if c < len(row) else None
            if tr:
                shift_id = shift_by_time[tr]
                roster.append(Assignment(staff_id=sid, date=d, shift_id=shift_id))
                minutes += next(s for s in shift_types if s.id == shift_id).paid_minutes
        worked_minutes[sid] = minutes
        if fraction is None or fraction <= 0:
            # Estimate from the hours in the sheet; 36 h a week is full time.
            estimate = minutes / (36 * 60 * len(dates) / 7) if minutes else 0
            percent = max(10, min(100, round(estimate * 10) * 10)) if minutes else 50
            warnings.append(f"{name}: no employment fraction in the sheet; set to {percent}% from the hours worked")
        else:
            percent = round(min(fraction, 1) * 100)
        note = str(row[wish_col]).strip() if wish_col is not None and wish_col < len(row) and row[wish_col] else ""
        staff.append(Staff(id=sid, name=name, group_ids=[GROUP_ID], employment_percent=percent, note=note))

    # Count rows → staffing rows on the clock time whose daily counts they match.
    # The count formulas cover the people listed above them; rows further down are often extras.
    first_count = min(count_rows) if count_rows else len(values)
    counted = {f"p{i + 1}" for i, r in enumerate(people_rows) if r < first_count}
    daily: dict[str, list[int]] = {s.id: [0] * len(dates) for s in shift_types}
    for a in roster:
        if a.staff_id in counted:
            daily[a.shift_id][dates.index(a.date)] += 1
    coverage: list[CoverageDemand] = []
    staffing: list[StaffingRead] = []
    labelled = []
    for r in count_rows:
        row = values[r]
        note = next((str(row[c]).strip() for c in after if c < len(row) and isinstance(row[c], str) and row[c].strip()), "")
        if note:  # rows without a note are category totals
            labelled.append((r, note, [int(_number(row[c]) or 0) if c < len(row) else 0 for c in cols]))

    # Each count row tracks one clock time: give every row its own, closest matches first.
    order = sorted(daily, key=lambda sid: next(s.start_minute for s in shift_types if s.id == sid))
    diffs = {(r, sid): sum(abs(a - b) for a, b in zip(daily[sid], counts)) for r, _, counts in labelled for sid in daily}
    match: dict[int, tuple[str, int]] = {}
    used: set[str] = set()
    for r, sid in sorted(diffs, key=lambda k: (diffs[k], k[0], order.index(k[1]))):
        counts = next(c for rr, _, c in labelled if rr == r)
        if r in match or sid in used or not any(counts):
            continue
        match[r] = (sid, diffs[(r, sid)])
        used.add(sid)
    for r, note, counts in labelled:
        if r not in match:
            reason = "it counts nobody in this period" if not any(counts) else "every clock time already has a row"
            staffing.append(StaffingRead(note=note, shift_id=None, rows=0, certain=False, detail=f"not used: {reason}; pick the clock time under Demand"))
            continue
        sid, diff = match[r]
        seen = daily[sid]
        observed_min, observed_median = min(seen), sorted(seen)[len(seen) // 2]
        rules, certain, how = parse_staffing_note(note, observed_min, observed_median)
        for days, lo, hi in rules:
            coverage.append(CoverageDemand(shift_id=sid, group_id=GROUP_ID, weekdays=days, min=lo, max=hi, note=note))
        staffing.append(
            StaffingRead(
                note=note,
                shift_id=sid,
                rows=len(rules),
                certain=certain and diff == 0,
                detail=how if diff == 0 else f"{how}; matched to the closest clock time ({diff} days differ)",
            )
        )

    period = Period(start=dates[0], days=len(dates))
    project = Project(
        name=sheet.title if sheet.title.casefold() not in ("sheet1", "blað1") else ("Deildin" if lang == "is" else "The unit"),
        period=period,
        shift_types=shift_types,
        groups=[StaffGroup(id=GROUP_ID, name="Starfsfólk" if lang == "is" else "Staff")],
        staff=staff,
        coverage=coverage,
        public_holidays=holidays_between(period.start, period.days),
        solve_seconds=30,
    )
    return WorkbookImport(
        project=project,
        roster=roster,
        sheet=sheet.title,
        people=len(staff),
        named=named,
        shifts_imported=len(roster),
        shift_types=len(shift_types),
        staffing=staffing,
        wishes=suggest_rules(project),
        warnings=warnings,
    )


def _shift_types(time_count: Counter[tuple[str, str]], kind_of: dict[tuple[str, str], str], lang: str) -> list[ShiftType]:
    """One shift type per clock time. The most used time in each kind gets the bare letter (M, K, N);
    the others add their start hour, or their end hour when they start with the main one."""
    by_kind: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for tr in time_count:
        by_kind[kind_of[tr]].append(tr)
    out: list[ShiftType] = []
    for kind in ("morning", "evening", "night"):
        trs = sorted(by_kind.get(kind, []), key=lambda tr: (-time_count[tr], tr))
        if not trs:
            continue
        letter = CATEGORY_LETTER[kind]
        main = trs[0]
        used: set[str] = set()
        rows = []
        for tr in trs:
            start, end = tr
            if tr == main:
                code = letter
            elif start != main[0]:
                code = f"{letter}{int(start[:2])}" + ("" if start.endswith(":00") else start[3:])
            else:
                code = f"{letter}-{int(end[:2]) or 24}" + ("" if end.endswith(":00") else end[3:])
            base, n = code, 2
            while code in used:
                code = f"{base}{'-' if not base.endswith('-') else ''}{int(end[:2]) or 24}" if n == 2 else f"{base}{n}"
                n += 1
            used.add(code)
            hm = lambda x: x[:2] if x.endswith(":00") else x  # noqa: E731
            name = CATEGORY_NAME[kind] if tr == main else f"{CATEGORY_NAME[kind]} {hm(start)}–{hm(end) if end != '00:00' else '24'}"
            rows.append(
                ShiftType(
                    id=code,
                    code=code,
                    name=name,
                    start=start,
                    end=end,
                    is_night=kind == "night",
                    category=kind,  # type: ignore[arg-type]
                )
            )
        out += sorted(rows, key=lambda s: (s.start_minute, s.length_minutes))
    return out
