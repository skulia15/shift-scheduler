"""Read a roster from a planner's spreadsheet, and write one back out.

Import understands the common grid layout: one row per person, one column per day, shift codes
in the cells. It finds the header row and the name column itself, and reads day headers written as
real dates, "1.12.2026", "1.12", "2026-12-01" or bare day numbers ("Mán 1"). A cell may hold a shift
code or name, a time range ("08-16"), an area code and task names ("M A Böðun").

Export writes the same grid (so a file can go out to Excel and come back), a one-row-per-shift
sheet in the shape time-and-attendance systems import, and a sheet with the rule check.
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter
from datetime import date, datetime, timedelta

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel

from .models import MINUTES_PER_DAY, Assignment, Project, parse_clock
from .validator import evaluate

OFF_MARKERS = {"", "-", "–", "—", "x", "f", "frí", "fri", "off", "s", "v", "veik", "veikur", "veikindi", "sumarfrí", "orlof", "h"}
SHIFT_FILLS = ["E9F4B3", "FAE0FE", "37083E", "DBE7F6", "FDE2C8", "D9EFE6"]
SHIFT_FONTS = ["2F3513", "4E0E58", "FDF0FF", "16325C", "6B3205", "14453A"]


class ImportResult(BaseModel):
    roster: list[Assignment]
    sheet: str
    people_found: int
    shifts_imported: int
    unmatched_names: list[str]
    unknown_codes: dict[str, int]
    outside_period: int
    warnings: list[str]


# ---------------------------------------------------------------- reading


def _rows_from_file(filename: str, content: bytes) -> list[tuple[str, list[list[object]]]]:
    """[(sheet name, rows)] for .xlsx/.xlsm or .csv/.txt."""
    name = filename.lower()
    if name.endswith((".csv", ".txt")):
        text = content.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t")
        except csv.Error:
            dialect = csv.excel
        return [("CSV", [list(r) for r in csv.reader(io.StringIO(text), dialect)])]
    wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    return [(ws.title, [list(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets]


_FULL = re.compile(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})")
_ISO = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
_DAY_MONTH = re.compile(r"(?<!\d)(\d{1,2})[./](\d{1,2})\.?(?!\d)")
_DAY_ONLY = re.compile(r"^\D{0,12}?(\d{1,2})\.?$")


def _nearest_year(day: int, month: int, around: date) -> date | None:
    best = None
    for year in (around.year - 1, around.year, around.year + 1):
        try:
            d = date(year, month, day)
        except ValueError:
            continue
        if best is None or abs((d - around).days) < abs((best - around).days):
            best = d
    return best


def _header_dates(row: list[object], around: date) -> dict[int, date]:
    """Column index -> date for every cell in `row` that reads as a day header."""
    found: dict[int, date] = {}
    pending: list[tuple[int, int]] = []  # bare day numbers, resolved as a sequence
    for i, cell in enumerate(row):
        if isinstance(cell, datetime):
            found[i] = cell.date()
        elif isinstance(cell, date):
            found[i] = cell
        elif isinstance(cell, (int, float)) and not isinstance(cell, bool) and float(cell).is_integer() and 1 <= cell <= 31:
            pending.append((i, int(cell)))
        elif isinstance(cell, str):
            text = cell.strip()
            if m := _ISO.search(text):
                try:
                    found[i] = date(int(m[1]), int(m[2]), int(m[3]))
                except ValueError:
                    pass
            elif m := _FULL.search(text):
                year = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
                try:
                    found[i] = date(year, int(m[2]), int(m[1]))
                except ValueError:
                    pass
            elif m := _DAY_MONTH.search(text):
                if d := _nearest_year(int(m[1]), int(m[2]), around):
                    found[i] = d
            elif (m := _DAY_ONLY.match(text)) and 1 <= int(m[1]) <= 31:
                pending.append((i, int(m[1])))
    if pending and not found:
        # Day numbers only: walk forward from the month around the period start.
        month = date(around.year, around.month, 1)
        if pending[0][1] < around.day - 7:
            month = (month + timedelta(days=32)).replace(day=1)
        prev = 0
        for i, n in pending:
            if n < prev:
                month = (month + timedelta(days=32)).replace(day=1)
            prev = n
            try:
                found[i] = month.replace(day=n)
            except ValueError:
                pass
    return found


def _find_header(rows: list[list[object]], around: date) -> tuple[int, dict[int, date]] | None:
    best: tuple[int, dict[int, date]] | None = None
    for r, row in enumerate(rows[:25]):
        dates = _header_dates(row, around)
        ordered = [dates[c] for c in sorted(dates)]
        increasing = all(a < b for a, b in zip(ordered, ordered[1:]))
        if len(dates) >= 5 and increasing and (best is None or len(dates) > len(best[1])):
            best = (r, dates)
    return best


def _norm(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().casefold()


class _Matcher:
    def __init__(self, project: Project):
        self.by_full = {_norm(s.name): s.id for s in project.staff}
        self.by_number = {_norm(s.employee_number): s.id for s in project.staff if s.employee_number}
        firsts = Counter(_norm(s.name).split(" ")[0] for s in project.staff)
        self.by_first = {_norm(s.name).split(" ")[0]: s.id for s in project.staff if firsts[_norm(s.name).split(" ")[0]] == 1}

    def match(self, name: object, number: object = None) -> str | None:
        if number is not None and _norm(number) in self.by_number:
            return self.by_number[_norm(number)]
        key = _norm(name)
        if not key:
            return None
        if key in self.by_full:
            return self.by_full[key]
        if key in self.by_number:
            return self.by_number[key]
        return self.by_first.get(key.split(" ")[0])


class _CellReader:
    def __init__(self, project: Project):
        self.shift = {}
        for s in project.shift_types:
            self.shift[_norm(s.code)] = s.id
            self.shift[_norm(s.name)] = s.id
        self.times = {(s.start_minute, (s.start_minute + s.length_minutes) % MINUTES_PER_DAY): s.id for s in project.shift_types}
        self.area = {}
        for a in project.areas:
            self.area[_norm(a.code)] = a.id
            self.area[_norm(a.name)] = a.id
        self.task = {}
        for t in project.tasks:
            self.task[_norm(t.name)] = t.id
            self.task[_norm(t.name)[:3]] = t.id
        self.unknown: Counter[str] = Counter()

    _TIME = re.compile(r"(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?")

    def peek(self, cell: object) -> bool:
        """Whether the cell holds a recognisable shift, without recording unknown codes."""
        saved = self.unknown.copy()
        try:
            return self.read(cell)[0] is not None
        finally:
            self.unknown = saved

    def read(self, cell: object) -> tuple[str | None, str | None, list[str]]:
        """(shift id, area id, task ids) for one cell; (None, None, []) for a day off."""
        if cell is None:
            return None, None, []
        text = str(cell).strip()
        if _norm(text) in OFF_MARKERS:
            return None, None, []
        shift = area = None
        tasks: list[str] = []
        if m := self._TIME.search(text):
            start = int(m[1]) * 60 + int(m[2] or 0)
            end = (int(m[3]) * 60 + int(m[4] or 0)) % MINUTES_PER_DAY
            shift = self.times.get((start, end))
            if shift is None:
                self.unknown[m[0]] += 1
            text = text.replace(m[0], " ")
        if _norm(text) in self.shift and shift is None:  # whole cell is a (multi-word) shift name
            return self.shift[_norm(text)], None, []
        for token in re.split(r"[\s,/·+;]+", text):
            key = _norm(token)
            if not key or key in OFF_MARKERS:
                continue
            if shift is None and key in self.shift:
                shift = self.shift[key]
            elif area is None and key in self.area:
                area = self.area[key]
            elif key in self.task:
                tasks.append(self.task[key])
            else:
                self.unknown[token] += 1
        return shift, area, tasks


def import_roster(project: Project, filename: str, content: bytes) -> ImportResult:
    dates = set(project.period.dates())
    for sheet, rows in _rows_from_file(filename, content):
        header = _find_header(rows, project.period.start)
        if header is None:
            continue
        header_row, col_dates = header
        first_date_col = min(col_dates)
        matcher = _Matcher(project)
        body = rows[header_row + 1 :]

        # The name column: the column left of the dates whose cells match the most staff.
        def score(col: int) -> int:
            return sum(1 for row in body if col < len(row) and matcher.match(row[col]))

        candidates = list(range(first_date_col)) or [0]
        name_col = max(candidates, key=score)
        number_col = next(
            (c for c in candidates if c != name_col and any(c < len(r) and _norm(r[c]) in matcher.by_number for r in body)), None
        )
        reader = _CellReader(project)
        roster: list[Assignment] = []
        unmatched: list[str] = []
        people: set[str] = set()
        outside = 0
        warnings: list[str] = []
        for row in body:
            if name_col >= len(row) or not str(row[name_col] or "").strip():
                continue
            staff_id = matcher.match(row[name_col], row[number_col] if number_col is not None and number_col < len(row) else None)
            cells = [(col, row[col] if col < len(row) else None) for col in sorted(col_dates)]
            if staff_id is None:
                # Section headings and totals have no shifts; only report rows that look like people.
                if any(reader.peek(v) for _, v in cells):
                    unmatched.append(str(row[name_col]).strip())
                continue
            if staff_id in people:
                warnings.append(f"{row[name_col]} appears on more than one row; later rows were added too")
            people.add(staff_id)
            for col, value in cells:
                shift, area, tasks = reader.read(value)
                if shift is None:
                    continue
                if col_dates[col] not in dates:
                    outside += 1
                    continue
                roster.append(Assignment(staff_id=staff_id, date=col_dates[col], shift_id=shift, area_id=area, task_ids=tasks))
        if not people and not unmatched:
            continue
        if not dates & set(col_dates.values()):
            warnings.append("None of the sheet's dates fall in the planning period; set the period under Setup first")
        return ImportResult(
            roster=roster,
            sheet=sheet,
            people_found=len(people),
            shifts_imported=len(roster),
            unmatched_names=unmatched,
            unknown_codes=dict(reader.unknown.most_common()),
            outside_period=outside,
            warnings=warnings,
        )
    raise ValueError("Could not find a roster: no row with day headers (dates or day numbers) and staff names below it")


# ---------------------------------------------------------------- writing

WEEKDAYS_IS = ["Mán", "Þri", "Mið", "Fim", "Fös", "Lau", "Sun"]


def export_roster(project: Project, roster: list[Assignment]) -> bytes:
    ev = evaluate(project, roster)
    dates = project.period.dates()
    shift_by_id = {s.id: (i, s) for i, s in enumerate(project.shift_types)}
    area_code = {a.id: a.code for a in project.areas}
    task_name = {t.id: t.name for t in project.tasks}
    cell = {(a.staff_id, a.date): a for a in roster}
    holidays = {h.date for h in project.public_holidays}
    bold = Font(bold=True)

    wb = Workbook()
    grid = wb.active
    grid.title = "Vaktaplan"
    grid.append([project.name])
    grid["A1"].font = Font(bold=True, size=14)
    grid.append(["", ""] + [WEEKDAYS_IS[d.weekday()] for d in dates])
    grid.append(["Starfsmaður", "Nr."] + list(dates) + ["Vaktir", "Klst. (vægi)", "Markmið"])
    for col in range(3, 3 + len(dates)):
        grid.cell(row=3, column=col).number_format = "d.m."
    for c in grid[3]:
        c.font = bold
    stats = {s.staff_id: s for s in ev.staff}
    for staff in project.staff:
        row = [staff.name, staff.employee_number or ""]
        for d in dates:
            a = cell.get((staff.id, d))
            if a and a.shift_id in shift_by_id:
                parts = [shift_by_id[a.shift_id][1].code, area_code.get(a.area_id or "", ""), *(task_name.get(t, t) for t in a.task_ids)]
                row.append(" ".join(p for p in parts if p))
            else:
                row.append("")
        st = stats.get(staff.id)
        row += [st.shifts if st else 0, st.credited_hours if st else 0, st.target_hours if st else 0]
        grid.append(row)
        r = grid.max_row
        for j, d in enumerate(dates):
            a = cell.get((staff.id, d))
            c = grid.cell(row=r, column=3 + j)
            c.alignment = Alignment(horizontal="center")
            if a and a.shift_id in shift_by_id:
                i = shift_by_id[a.shift_id][0] % len(SHIFT_FILLS)
                c.fill = PatternFill("solid", fgColor=SHIFT_FILLS[i])
                c.font = Font(bold=True, color=SHIFT_FONTS[i])
            elif d in holidays or d.weekday() >= 5:
                c.fill = PatternFill("solid", fgColor="F0EEE5")
    grid.column_dimensions["A"].width = 22
    grid.column_dimensions["B"].width = 8
    for j in range(len(dates)):
        grid.column_dimensions[get_column_letter(3 + j)].width = 7
    grid.freeze_panes = "C4"

    shifts = wb.create_sheet("Vaktir")
    shifts.append(["Nafn", "Starfsmannanúmer", "Dagsetning", "Vakt", "Heiti vaktar", "Byrjar", "Endar", "Svæði", "Verkefni"])
    for c in shifts[1]:
        c.font = bold
    staff_by_id = {s.id: s for s in project.staff}
    for a in sorted(roster, key=lambda a: (a.date, shift_by_id.get(a.shift_id, (0,))[0], a.staff_id)):
        if a.shift_id not in shift_by_id or a.staff_id not in staff_by_id:
            continue
        s = shift_by_id[a.shift_id][1]
        start = datetime.combine(a.date, datetime.min.time()) + timedelta(minutes=parse_clock(s.start))
        end = start + timedelta(minutes=s.length_minutes)
        person = staff_by_id[a.staff_id]
        shifts.append(
            [person.name, person.employee_number or "", a.date, s.code, s.name, start, end, area_code.get(a.area_id or "", ""), ", ".join(task_name.get(t, t) for t in a.task_ids)]
        )
    for row in shifts.iter_rows(min_row=2):
        row[2].number_format = "d.m.yyyy"
        row[5].number_format = row[6].number_format = "d.m.yyyy hh:mm"
    for col, width in zip("ABCDEFGHI", (22, 16, 12, 6, 16, 17, 17, 8, 24)):
        shifts.column_dimensions[col].width = width

    notes = wb.create_sheet("Athugasemdir")
    notes.append(["Alvarleiki", "Regla", "Dagsetning", "Starfsmaður", "Lýsing"])
    for c in notes[1]:
        c.font = bold
    for v in ev.violations:
        notes.append(["Villa" if v.severity == "error" else "Ábending", v.rule, v.date, staff_by_id[v.staff_id].name if v.staff_id in staff_by_id else "", v.message])
    for row in notes.iter_rows(min_row=2):
        row[2].number_format = "d.m.yyyy"
    for col, width in zip("ABCDE", (11, 20, 12, 22, 70)):
        notes.column_dimensions[col].width = width

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
