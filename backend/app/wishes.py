"""Suggest per-person rules from wishes written in Icelandic ("Önnur hver helgi KV", "Ekki vakt á fim",
"Tvær MV í viku", "Alla mánudaga 18-00"). Suggestions are soft; the planner accepts, edits or drops them.

Only patterns that read unambiguously are suggested; the rest of the note stays for the planner.
"""

from __future__ import annotations

import re

from pydantic import BaseModel

from .models import (
    AllowedShiftsRule,
    CustomRule,
    DiverseShiftsRule,
    FixedAreaRule,
    Project,
    RecurringShiftRule,
    ShiftsPerWeekRule,
    ShiftType,
    UnavailableWeekdaysRule,
    WeekendPatternRule,
    parse_clock,
)

WEAK, NORMAL, STRONG = 8, 20, 40

_KINDS = {
    "morning": re.compile(r"\bmv\b|\bmorgunv\w*|\bmorgn\w*"),
    "evening": re.compile(r"\bkv\b|\bkvöldv\w*|\bkvöldakt\w*"),
    "night": re.compile(r"\bnv\b|\bnæturv\w*"),
}
_DAY = re.compile(r"\b(mán|þri|mið|fim|fös|lau|sun)\w*")
_DAY_INDEX = {"mán": 0, "þri": 1, "mið": 2, "fim": 3, "fös": 4, "lau": 5, "sun": 6}
_RANGE = re.compile(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?\b")
_WEEKEND = re.compile(
    r"(?P<n>önnur|annan|aðra|þriðj\w*|fjórð\w*|fimmt\w*|sjött\w*)\s+hv\w*\s+(?:\w+\s+)?helg\w*|(?P<none>engar\s+helgar|ekki\s+um\s+helgar|aldrei\s+um\s+helgar)"
)
_EVERY = {"ö": 2, "a": 2, "þ": 3, "fj": 4, "fi": 5, "s": 6}
_NUMBER = {"ein": 1, "einn": 1, "eina": 1, "tvær": 2, "tvo": 2, "tveir": 2, "þrjár": 3, "þrjá": 3, "þrír": 3}
_PER_WEEK = re.compile(r"(?:ca\.?\s+)?\b(\d|ein[an]?|tvær|tvo|tveir|þrjár|þrjá|þrír)\s*(x\b)?\s*([\w\s,]*?)\s*(?:í|á)\s+viku\b")
_WEAK = re.compile(r"\b(helst|yfirleitt|mest|oftast|ca|kannski|stundum|henta)\b")
_STRONG = re.compile(r"\b(einungis|bara|aðeins|eingöngu|alltaf|engar|aldrei|ekki|kemst ekki)\b")
_SPLIT = re.compile(r"[.;!()]|,(?!\s*(?:mv|kv|nv|eða|og|mán|þri|mið|fim|fös|lau|sun)\w*\b)", re.IGNORECASE)
_SINGLE = re.compile(r"\b(\d{1,2})[:](\d{2})\b")
# Not expressible yet, or not a wish: sometimes, summer, exceptions, alternating weeks, monthly,
# every other weekday ("annan hvern þriðjudag"), and what used to be ("var alltaf").
_SKIP = re.compile(
    r"\bstundum\b|\btil í allar\b|\bí sumar\b|\bnema\b|hina vikuna|vikuna sem|eina viku|hverja viku|í mánuði"
    r"|\b(?:annan|aðra|annað)\s+hv\w*\s+(?:mán|þri|mið|fim|fös)|\bvar\b"
)
_TAIL = re.compile(r"\s+(?:svo|en)\s+.*$", re.IGNORECASE)


class WishSuggestion(BaseModel):
    staff_id: str
    text: str
    rule: CustomRule


def _kinds(text: str) -> list[str]:
    return [k for k, rx in _KINDS.items() if rx.search(text)]


def _days(text: str) -> list[int]:
    if re.search(r"virk\w*\s+d[aö]g", text):
        return [0, 1, 2, 3, 4]
    return sorted({_DAY_INDEX[m] for m in _DAY.findall(text)})


def _hhmm(h: str, m: str | None) -> int:
    return (int(h) % 24) * 60 + int(m or 0)


def _shifts_for_range(text: str, shifts: list[ShiftType], single: bool = False) -> list[ShiftType]:
    """Shift types matching clock ranges in the text ("8-15", "17:45-21:45", "18-00"): exact first, else by
    start. With `single`, a lone start time ("17:30") also counts."""
    found: list[ShiftType] = []
    if single and not _RANGE.search(text):
        for h, mm in _SINGLE.findall(text):
            found += [s for s in shifts if s.start_minute == _hhmm(h, mm)]
    for h1, m1, h2, m2 in _RANGE.findall(text):
        start, end = _hhmm(h1, m1), _hhmm(h2, m2)
        exact = [s for s in shifts if s.start_minute == start and parse_clock(s.end) % (24 * 60) == end]
        found += exact or [s for s in shifts if s.start_minute == start]
    return list({s.id: s for s in found}.values())


def _within_kind(chosen: list[ShiftType], shifts: list[ShiftType]) -> list[str]:
    """Clock times narrow a person's shifts of that kind only; other kinds stay open."""
    ids, kinds = {s.id for s in chosen}, {s.kind for s in chosen}
    return [s.id for s in shifts if s.id in ids or s.kind not in kinds]


def _strength(text: str) -> int:
    return WEAK if _WEAK.search(text) else STRONG if _STRONG.search(text) else NORMAL


def parse_wish(note: str, staff_id: str, shifts: list[ShiftType], areas: list[tuple[str, str]] = ()) -> list[tuple[str, CustomRule]]:
    """(fragment, rule) pairs for the patterns found in one person's wish note."""
    out: list[tuple[str, CustomRule]] = []
    n = 0

    def add(fragment: str, rule_cls, **kw) -> None:
        nonlocal n
        n += 1
        kw.setdefault("weight", NORMAL)
        out.append((fragment.strip(), rule_cls(id=f"wish-{staff_id}-{n}", staff_id=staff_id, description=fragment.strip(), **kw)))

    # "7.30" and "kl. 16" are times, not sentence ends.
    note = re.sub(r"(\d)\.(\d)", r"\1:\2", note)
    note = re.sub(r"\b(kl)\.", r"\1", note, flags=re.IGNORECASE)
    clauses = [_TAIL.sub("", c) for c in _SPLIT.split(note) if c and c.strip()]
    queue = list(clauses)
    while queue:
        raw = queue.pop(0).strip()
        t = raw.casefold()
        if not t:
            continue

        # Weekends: "önnur hver helgi KV 8-16", "þriðja hver helgi NV", "engar helgar".
        m = _WEEKEND.search(t)
        if m:
            if m.group("none"):
                add(raw, WeekendPatternRule, every=0, weight=STRONG)
                continue
            word = m.group("n")
            every = next(v for k, v in _EVERY.items() if word.startswith(k))
            rest = t[m.end() :]
            weekend_part, _, other = rest.partition(" og ")
            if other and (_days(other) or _kinds(other)):
                queue.insert(0, raw[len(raw) - len(other) :])
            else:
                weekend_part = rest
            day = _DAY.search(weekend_part)
            if day:  # "helgi 8-13 kvöldvakt þri eða mið": the weekday part is about weekdays
                weekend_part = weekend_part[: day.start()]
            add(raw, WeekendPatternRule, every=every, weight=STRONG)
            kinds = _kinds(weekend_part) or _kinds(t[: m.start()])
            timed = _shifts_for_range(weekend_part, shifts, single=True)
            chosen = [s for s in timed if not kinds or s.kind in kinds] or timed
            if chosen:
                add(raw, AllowedShiftsRule, weekdays=[5, 6], shift_ids=[s.id for s in chosen])
            elif kinds and len(kinds) < 3:
                add(raw, AllowedShiftsRule, weekdays=[5, 6], kinds=kinds)
            continue

        if _SKIP.search(t):
            continue
        kinds, days, chosen = _kinds(t), _days(t), _shifts_for_range(t, shifts)
        strength = _strength(t)

        # Shifts per week: "tvær MV í viku", "ein kvöldvakt á viku", "3x í viku".
        m = _PER_WEEK.search(t)
        if m and "hverja viku" not in t:
            count = int(m.group(1)) if m.group(1).isdigit() else _NUMBER.get(m.group(1))
            what = m.group(3)
            k, picked = _kinds(what) or kinds, _shifts_for_range(t, shifts)
            if count:
                exact = strength != WEAK
                add(
                    raw,
                    ShiftsPerWeekRule,
                    kinds=k or None,
                    shift_ids=[s.id for s in picked] or None,
                    min=count if exact else None,
                    max=count,
                    weight=NORMAL if exact else WEAK,
                )
                continue

        # Not on some days or shifts: "ekki vakt á fim og mán", "frí á fimmtudögum", "ekki kvöldvaktir", "kemst ekki kl 16".
        if re.search(r"\bekki\b|\bfrí\w*\b", t):
            late = re.search(r"(?:ekki\s+(?:frá\s+)?kl\.?|kemst ekki kl\.?)\s*(\d{1,2})(?:[:.](\d{2}))?", t)
            if late:
                start = _hhmm(late.group(1), late.group(2))
                add(raw, AllowedShiftsRule, shift_ids=[s.id for s in shifts if s.start_minute != start], weight=STRONG)
            elif kinds:
                add(raw, AllowedShiftsRule, kinds=[k for k in _KINDS if k not in kinds], weekdays=days or list(range(7)), weight=strength)
            elif days:
                add(raw, UnavailableWeekdaysRule, weekdays=days, weight=WEAK if strength == WEAK else STRONG if "ekki" in t else NORMAL)
            continue

        # Only some kinds: "bara KV", "einungis MV", "aðeins MV á virkum dögum", "mest NV".
        if kinds and re.search(r"\b(bara|einungis|aðeins|eingöngu|mest|oftast|óskar)\b", t) and not re.search(r"blanda", t):
            add(raw, AllowedShiftsRule, kinds=kinds, weekdays=days or list(range(7)), weight=strength)
            continue

        # Mixed shifts: "blandaðar vaktir MV og KV".
        if "blanda" in t:
            add(raw, DiverseShiftsRule, by_kind=True, kinds=kinds or None, weight=NORMAL)
            if kinds and len(kinds) < 3:
                add(raw, AllowedShiftsRule, kinds=kinds, weight=NORMAL)
            continue

        if "heilar vaktir" in t:
            add(raw, AllowedShiftsRule, shift_ids=[s.id for s in shifts if s.length_minutes >= 450], weight=STRONG)
            continue

        # Hallway: "alltaf á gula ganginum".
        hall = re.search(r"\bá\s+(\w+)\s+gang", t)
        if hall:
            area = next((aid for aid, name in areas if name.casefold()[:3] == hall.group(1)[:3]), None)
            if area:
                add(raw, FixedAreaRule, area_id=area, weight=STRONG)
            continue

        # Fixed weekdays: "alla mánudaga 18-00", "MV á föstudögum", "mán og mið KV", "vinnur yfirleitt mið og fim".
        if days and not re.search(r"\beða\b", t) and (kinds or chosen or re.search(r"\b(alla|vinnur|alltaf)\b", t)):
            add(
                raw,
                RecurringShiftRule,
                weekdays=days,
                kinds=kinds or None,
                shift_ids=[s.id for s in chosen] or None,
                weight=WEAK if strength == WEAK else NORMAL,
            )
            continue

        # Times only: "8-15", "alltaf 7.30-15.30", "frá 17".
        if chosen and not days:
            add(raw, AllowedShiftsRule, shift_ids=_within_kind(chosen, shifts), weight=STRONG if strength == STRONG else NORMAL)
            continue
        m = re.search(r"\bfrá\s+(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?\b", t)
        if m and not days:
            start = _hhmm(m.group(1), m.group(2))
            late = [s for s in shifts if s.kind == "evening" and s.start_minute >= start]
            if late:
                add(raw, AllowedShiftsRule, shift_ids=_within_kind(late, shifts), weight=STRONG)
    return out


def suggest_rules(project: Project) -> list[WishSuggestion]:
    """Rule suggestions for every person with a wish note, skipping wishes already turned into rules."""
    taken = {(getattr(r, "staff_id", None), r.description) for r in project.custom_rules}
    areas = [(a.id, a.name) for a in project.areas]
    out: list[WishSuggestion] = []
    for person in project.staff:
        if not person.note.strip():
            continue
        for fragment, rule in parse_wish(person.note, person.id, project.shift_types, areas):
            if (person.id, rule.description) in taken:
                continue
            out.append(WishSuggestion(staff_id=person.id, text=fragment, rule=rule))
    return out
