"""Demo project: one unit of an elderly care home, 4 weeks over Christmas."""

from __future__ import annotations

from datetime import date

from .holidays import holidays_between
from .models import (
    Area,
    AreaDemand,
    DiverseShiftsRule,
    FixedAreaRule,
    AvoidTaskRepeatRule,
    CoverageDemand,
    Leave,
    MaxShiftTypeRule,
    Period,
    Project,
    RotateTaskEvenlyRule,
    ShiftType,
    Staff,
    StaffGroup,
    Task,
    TaskDemand,
)

WEEKDAYS = [0, 1, 2, 3, 4]
DAY_SHIFTS = ["M", "K"]


def sample_project() -> Project:
    nurses = [
        ("Anna", 100, None),
        ("Bjarni", 100, None),
        ("Guðrún", 80, None),
        ("Helga", 80, DAY_SHIFTS),
        ("Jón", 60, ["N"]),
        ("Katrín", 60, None),
        ("Lára", 80, None),
    ]
    floor = [
        ("Lilja", 100, None),
        ("Magnús", 100, None),
        ("Nína", 100, DAY_SHIFTS),
        ("Ólafur", 100, None),
        ("Petra", 80, None),
        ("Ragnar", 80, DAY_SHIFTS),
        ("Sigríður", 80, None),
        ("Tómas", 80, None),
        ("Unnur", 60, ["M"]),
        ("Vala", 60, None),
        ("Þóra", 60, ["N", "K"]),
        ("Ýr", 80, None),
        ("Örn", 100, None),
    ]
    staff = [
        Staff(id=f"n{i}", name=name, group_ids=["nurse"], employment_percent=pct, allowed_shift_ids=allowed)
        for i, (name, pct, allowed) in enumerate(nurses, 1)
    ] + [
        Staff(id=f"f{i}", name=name, group_ids=["floor"], employment_percent=pct, allowed_shift_ids=allowed)
        for i, (name, pct, allowed) in enumerate(floor, 1)
    ]

    return Project(
        name="Hjúkrunarheimili — 2. hæð (demo)",
        period=Period(start=date(2026, 11, 30), days=28),
        shift_types=[
            ShiftType(id="M", code="M", name="Morgunvakt", start="08:00", end="16:00"),
            ShiftType(id="K", code="K", name="Kvöldvakt", start="16:00", end="24:00"),
            ShiftType(id="N", code="N", name="Næturvakt", start="23:30", end="08:00", is_night=True),
        ],
        groups=[StaffGroup(id="nurse", name="Hjúkrunarfræðingar"), StaffGroup(id="floor", name="Sjúkraliðar / umönnun")],
        staff=staff,
        tasks=[
            Task(id="bath", name="Böðun", group_id="floor"),
            Task(id="dining", name="Matsalur", group_id="floor"),
            Task(id="meds", name="Lyfjaumsjón", group_id="nurse"),
        ],
        coverage=[
            CoverageDemand(shift_id="M", group_id="nurse", min=1, max=2),
            CoverageDemand(shift_id="K", group_id="nurse", min=1, max=1),
            CoverageDemand(shift_id="N", group_id="nurse", min=1, max=1),
            CoverageDemand(shift_id="M", group_id="floor", min=3),
            CoverageDemand(shift_id="K", group_id="floor", min=2),
            CoverageDemand(shift_id="N", group_id="floor", min=1, max=1),
            # Christmas Eve and Christmas Day: lighter day programme.
            CoverageDemand(shift_id="M", group_id="floor", dates=[date(2026, 12, 24), date(2026, 12, 25)], min=2, max=3),
        ],
        task_demand=[
            TaskDemand(task_id="bath", shift_id="M", weekdays=WEEKDAYS, count=2),
            TaskDemand(task_id="dining", shift_id="M", count=1),
            TaskDemand(task_id="dining", shift_id="K", count=1),
            TaskDemand(task_id="meds", shift_id="M", count=1),
            TaskDemand(task_id="meds", shift_id="K", count=1),
        ],
        areas=[Area(id="A", code="A", name="Gangur A"), Area(id="B", code="B", name="Gangur B")],
        # Floor staff on day and evening shifts work in a hallway; the night floor person covers both.
        area_demand=[
            AreaDemand(area_id="A", shift_id="M", group_id="floor", min=2),
            AreaDemand(area_id="B", shift_id="M", group_id="floor", min=1),
            AreaDemand(area_id="A", shift_id="K", group_id="floor", min=1),
            AreaDemand(area_id="B", shift_id="K", group_id="floor", min=1),
            AreaDemand(area_id="A", shift_id="M", group_id="floor", dates=[date(2026, 12, 24), date(2026, 12, 25)], min=1),
        ],
        leave=[
            Leave(staff_id="n1", start=date(2026, 12, 21), end=date(2026, 12, 27), kind="holiday", note="Jólafrí"),
            Leave(staff_id="f2", start=date(2026, 12, 7), end=date(2026, 12, 11), kind="holiday"),
            Leave(staff_id="f5", start=date(2026, 12, 24), end=date(2026, 12, 24), kind="request", note="Aðfangadagur"),
            Leave(staff_id="f7", start=date(2026, 12, 24), end=date(2026, 12, 25), kind="request"),
            Leave(staff_id="n3", start=date(2026, 12, 5), end=date(2026, 12, 6), kind="request", granted=True, note="Brúðkaup"),
            Leave(staff_id="f10", start=date(2026, 12, 18), end=date(2026, 12, 18), kind="request"),
        ],
        public_holidays=holidays_between(date(2026, 11, 30), 28),
        custom_rules=[
            AvoidTaskRepeatRule(
                id="bath-repeat",
                description="Floor staff should not bathe residents two days running",
                group_id="floor",
                task_id="bath",
                max_count=1,
                window_days=2,
                weight=20,
            ),
            RotateTaskEvenlyRule(
                id="dining-rotation",
                description="Dining room duty rotates evenly among floor staff",
                group_id="floor",
                task_id="dining",
                proportional_to_employment=True,
                weight=10,
            ),
            RotateTaskEvenlyRule(
                id="bath-rotation",
                description="Bathing rotates evenly among floor staff",
                group_id="floor",
                task_id="bath",
                proportional_to_employment=True,
                weight=10,
            ),
            FixedAreaRule(
                id="lilja-hallway",
                description="Lilja always works in Gangur A",
                staff_id="f1",
                area_id="A",
                hard=True,
            ),
            DiverseShiftsRule(
                id="petra-variety",
                description="Petra wants a varied mix of shifts",
                staff_id="f5",
                weight=15,
            ),
            MaxShiftTypeRule(
                id="floor-nights",
                description="Floor staff work at most 8 night shifts per period",
                group_id="floor",
                shift_id="N",
                max_count=8,
                hard=True,
            ),
        ],
        solve_seconds=20,
    )
