"""Builds docs/samples/manager-roster.xlsx: a manager-style spreadsheet for trying "Import Excel".

Day-number headers, first names, some 08-16 time ranges, a typo'd code, a temp not in Staff and a
night-then-morning clash, so the import report and rule check have something to show.
"""

from datetime import timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

from app.sample import sample_project
from app.solver import solve

OUT = Path(__file__).resolve().parents[2] / "docs" / "samples" / "manager-roster.xlsx"

project = sample_project("is")
project.solve_seconds = 8
roster = solve(project).roster
cell = {(a.staff_id, a.date): a for a in roster}
days = [project.period.start + timedelta(days=i) for i in range(project.period.days)]
weekdays = ["Mán", "Þri", "Mið", "Fim", "Fös", "Lau", "Sun"]

wb = Workbook()
ws = wb.active
ws.title = "Desember"
ws.append(["Vaktaplan 2. hæð — 30. nóv til 27. des"])
ws["A1"].font = Font(bold=True, size=13)
ws.append([])
ws.append(["Starfsmaður", "Hlutf."] + [f"{weekdays[d.weekday()]} {d.day}" for d in days])
for i, s in enumerate(project.staff):
    row = [s.name.split(" ")[0], f"{int(s.employment_percent)}%"]
    for d in days:
        a = cell.get((s.id, d))
        if not a:
            row.append("frí" if d.weekday() >= 5 and i % 3 == 0 else "")
            continue
        text = "08-16" if a.shift_id == "M" and i % 4 == 0 else a.shift_id
        row.append(f"{text} {a.area_id}" if a.area_id else text)
    ws.append(row)
ws.cell(row=5, column=4).value = "N"  # Bjarni: night on 1 Dec ...
ws.cell(row=5, column=5).value = "M"  # ... then a morning straight after it
ws.cell(row=6, column=12).value = "Mk"  # a typo
ws.append(["Afleysing Guðný", "", "M", "M", "", "K"])  # a temp who is not in Staff
ws.append(["Samtals á vakt", ""] + [sum(1 for s in project.staff if (s.id, d) in cell) for d in days])
wb.save(OUT)
print(OUT)
