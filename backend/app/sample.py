"""Demo project: one unit of an elderly care home, 4 weeks over Christmas."""

from __future__ import annotations

from datetime import date

from .holidays import holidays_between
from .models import (
    Area,
    AreaDemand,
    Competence,
    CompetenceDemand,
    DiverseShiftsRule,
    FixedAreaRule,
    AvoidTaskRepeatRule,
    CoverageDemand,
    LaborRules,
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


def sample_project(lang: str = "en") -> Project:
    icelandic = lang == "is"
    nurses = [
        ("Anna Jónsdóttir", 100, None),
        ("Bjarni Pálsson", 100, None),
        ("Guðrún Helgadóttir", 80, None),
        ("Helga Sigurðardóttir", 80, DAY_SHIFTS),
        ("Jón Einarsson", 60, ["N"]),
        ("Katrín Ólafsdóttir", 60, None),
        ("Lára Björnsdóttir", 80, None),
    ]
    floor = [
        ("Lilja Magnúsdóttir", 100, None),
        ("Magnús Gunnarsson", 100, None),
        ("Nína Árnadóttir", 100, DAY_SHIFTS),
        ("Ólafur Stefánsson", 100, None),
        ("Petra Kristjánsdóttir", 80, None),
        ("Tomasz Nowak", 80, DAY_SHIFTS),
        ("Sigríður Guðmundsdóttir", 80, None),
        ("Joy Dela Cruz", 80, None),
        ("Unnur Davíðsdóttir", 60, ["M"]),
        ("Vala Friðriksdóttir", 60, None),
        ("Þóra Sveinsdóttir", 60, ["N", "K"]),
        ("Aistė Kazlauskienė", 80, None),
        ("Örn Baldursson", 100, None),
    ]
    # Sjúkraliðar with medication rights; floor staff still learning Icelandic.
    medication = {"Lilja Magnúsdóttir", "Ólafur Stefánsson", "Sigríður Guðmundsdóttir", "Örn Baldursson"}
    no_icelandic = {"Tomasz Nowak", "Joy Dela Cruz", "Aistė Kazlauskienė"}
    staff = [
        Staff(
            id=f"n{i}", name=name, group_ids=["nurse"], employment_percent=pct, allowed_shift_ids=allowed, competence_ids=["med", "is"]
        )
        for i, (name, pct, allowed) in enumerate(nurses, 1)
    ] + [
        Staff(
            id=f"f{i}",
            name=name,
            group_ids=["floor"],
            employment_percent=pct,
            allowed_shift_ids=allowed,
            competence_ids=(["med"] if name in medication else []) + ([] if name in no_icelandic else ["is"]),
        )
        for i, (name, pct, allowed) in enumerate(floor, 1)
    ]

    return Project(
        name="Hjúkrunarheimili — 2. hæð",
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
            Task(id="meds", name="Lyfjaumsjón", group_id="nurse", competence_id="med"),
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
        competences=[Competence(id="med", name="Lyfjaréttindi"), Competence(id="is", name="Íslenska")],
        competence_demand=[
            # Two Icelandic speakers on day and evening shifts, one at night.
            CompetenceDemand(competence_id="is", shift_id="M", min=2),
            CompetenceDemand(competence_id="is", shift_id="K", min=2),
            CompetenceDemand(competence_id="is", shift_id="N", min=1),
            # Someone with medication rights in each hallway in the morning.
            CompetenceDemand(competence_id="med", shift_id="M", area_id="A", min=1),
            CompetenceDemand(competence_id="med", shift_id="M", area_id="B", min=1),
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
        rules=_rules(icelandic),
        custom_rules=[
            AvoidTaskRepeatRule(
                id="bath-repeat",
                description="Sami starfsmaður baðar ekki íbúa tvo daga í röð" if icelandic else "Floor staff should not bathe residents two days running",
                group_id="floor",
                task_id="bath",
                max_count=1,
                window_days=2,
                weight=20,
            ),
            RotateTaskEvenlyRule(
                id="dining-rotation",
                description="Vakt í matsal dreifist jafnt á starfsfólk í umönnun" if icelandic else "Dining room duty rotates evenly among floor staff",
                group_id="floor",
                task_id="dining",
                proportional_to_employment=True,
                weight=10,
            ),
            RotateTaskEvenlyRule(
                id="bath-rotation",
                description="Böðun dreifist jafnt á starfsfólk í umönnun" if icelandic else "Bathing rotates evenly among floor staff",
                group_id="floor",
                task_id="bath",
                proportional_to_employment=True,
                weight=10,
            ),
            FixedAreaRule(
                id="lilja-hallway",
                description="Lilja vinnur alltaf á Gangi A" if icelandic else "Lilja always works in Gangur A",
                staff_id="f1",
                area_id="A",
                hard=True,
            ),
            DiverseShiftsRule(
                id="petra-variety",
                description="Petra vill fjölbreytta blöndu af vöktum" if icelandic else "Petra wants a varied mix of shifts",
                staff_id="f5",
                weight=15,
            ),
            MaxShiftTypeRule(
                id="floor-nights",
                description="Starfsfólk í umönnun tekur mest 8 næturvaktir á tímabili" if icelandic else "Floor staff work at most 8 night shifts per period",
                group_id="floor",
                shift_id="N",
                max_count=8,
                hard=True,
            ),
        ],
        solve_seconds=20,
    )


def _rules(icelandic: bool) -> LaborRules:
    rules = LaborRules()
    if icelandic:
        names = ["Kvöld á virkum dögum", "Dagur um helgar og á helgidögum", "Nótt", "Aðfangadags- og gamlárskvöld"]
        rules.weight_bands = [b.model_copy(update={"name": n}) for b, n in zip(rules.weight_bands, names)]
    return rules
