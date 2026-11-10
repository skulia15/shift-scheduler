"""Rule-check messages in English and Icelandic. English templates are the keys."""

from __future__ import annotations

import re

_DECIMAL = re.compile(r"^(\d+)\.(\d+)$")

IS = {
    "Unknown person, date or shift in {what}": "Óþekktur starfsmaður, dagur eða vakt: {what}",
    "{name} has more than one shift": "{name} er á fleiri en einni vakt",
    "{name} may not work {shift}": "{name} má ekki taka {shift}",
    "{name} is on leave or a granted day off": "{name} er í leyfi eða á samþykktum frídegi",
    "{name} asked for this day off": "{name} óskaði eftir fríi þennan dag",
    "Unknown task {task}": "Óþekkt verkefni: {task}",
    "{name} is not in the group that does {task}": "{name} er ekki í starfshópnum sem sinnir {task}",
    "{name} lacks {skill}, needed for {task}": "{name} hefur ekki {skill}, sem þarf fyrir {task}",
    "Unknown area {area}": "Óþekkt svæði: {area}",
    "{name} has no area on this shift": "{name} er ekki skráð á svæði á þessari vakt",
    "{name} has {n} tasks on one shift": "{name} er með {n} verkefni á einni vakt",
    "{shift} is {h} h, shorter than {limit} h": "{shift} er {h} klst., styttri en {limit} klst.",
    "{shift} is {h} h, longer than the normal {limit} h": "{shift} er {h} klst., lengri en venjulegt hámark, {limit} klst.",
    "{group}: {n} of {need} required": "{group}: {n} af {need} sem þarf",
    "{group}: {n}, more than the maximum {max}": "{group}: {n}, fleiri en hámarkið {max}",
    "{area}, {group}: {n} of {need} required": "{area}, {group}: {n} af {need} sem þarf",
    "{area}, {group}: {n}, more than the maximum {max}": "{area}, {group}: {n}, fleiri en hámarkið {max}",
    "{skill} in {area}: {n} of {need} required": "{skill}, {area}: {n} af {need} sem þarf",
    "{skill}: {n} of {need} required": "{skill}: {n} af {need} sem þarf",
    "Only one person on {shift}: a safety assessment is required": "Aðeins einn starfsmaður á vaktinni ({shift}): gera þarf áhættumat",
    "{task}: {n} of {need} assigned": "{task}: {n} af {need} úthlutað",
    "{task}: {n} assigned, {need} needed": "{task}: {n} úthlutað, {need} þarf",
    "{name}: only {h} h rest (minimum {limit} h)": "{name}: aðeins {h} klst. hvíld (lágmark {limit} klst.)",
    "{name}: {h} h rest (target {limit} h)": "{name}: {h} klst. hvíld (viðmið {limit} klst.)",
    "{name}: {n} short rests in one week (max {max})": "{name}: skert hvíld {n} sinnum í sömu viku (hámark {max})",
    "{name}: {n} days in a row (max {max})": "{name}: {n} dagar í röð (hámark {max})",
    "{name}: {n} nights in a row (max {max})": "{name}: {n} nætur í röð (hámark {max})",
    "{name}: no {h} h continuous rest in 7 days": "{name}: engin {h} klst. samfelld hvíld á 7 dögum",
    "{name}: {n} days off in the week of {week}": "{name}: {n} frídagar í vikunni sem hefst {week}",
    "{name}: days off not consecutive in the week of {week}": "{name}: frídagar ekki samfelldir í vikunni sem hefst {week}",
    "{name}: averages {h} h a week": "{name}: að meðaltali {h} klst. á viku",
    "{name}: {h} h overtime (cap {limit} h)": "{name}: {h} klst. yfirvinna (hámark {limit} klst.)",
    "{name}: {h} h above contract": "{name}: {h} klst. umfram vinnuskyldu",
    "{name}: {h} h below contract": "{name}: {h} klst. undir vinnuskyldu",
    "{name}: works {n} weekends (target at most {max})": "{name}: vinnur {n} helgar (viðmið mest {max})",
    "{label}: {name} does {task} {n}× in {days} days": "{label}: {name} sinnir {task} {n}× á {days} dögum",
    "{label}: {name} does {task} {n}×, fair share about {share}": "{label}: {name} sinnir {task} {n}×, sanngjarn hlutur um {share}",
    "{label}: {name} works {shift} {n}× (max {max})": "{label}: {name} tekur {shift} {n}× (hámark {max})",
    "{label}: {name} is in {area}, not {wanted}": "{label}: {name} er á svæðinu {area}, ekki {wanted}",
    "no area": "engu",
    "{label}: {name} has an uneven shift mix ({mix})": "{label}: {name} er með ójafna vaktablöndu ({mix})",
    "{label}: {name} {a} → {b}": "{label}: {name} {a} → {b}",
    "morning": "MV",
    "evening": "KV",
    "night": "NV",
    "{label}: {name} works a weekend": "{label}: {name} vinnur um helgi",
    "{label}: {name} works more than 1 in {n} weekends": "{label}: {name} vinnur oftar en 1 af hverjum {n} helgum",
    "{label}: {name} works only one day of the weekend": "{label}: {name} vinnur aðeins annan helgardaginn",
    "{label}: {name} is on {shift}": "{label}: {name} er á vaktinni {shift}",
    "{label}: {name} is not on their usual shift": "{label}: {name} er ekki á sinni föstu vakt",
    "{label}: {name} works on a day they are not available": "{label}: {name} vinnur á degi sem hentar ekki",
    "{label}: {name} has {n} in the week of {week} (max {max})": "{label}: {name} er með {n} í vikunni sem hefst {week} (hámark {max})",
    "{label}: {name} has {n} in the week of {week} (min {min})": "{label}: {name} er með {n} í vikunni sem hefst {week} (lágmark {min})",
    "{label}: {name} works {n} shifts without {other}": "{label}: {name} er á {n} vöktum án {other}",
}


def message(lang: str, template: str, **kw) -> str:
    if lang != "is":
        return template.format(**kw)
    # Icelandic writes decimals with a comma: 7,5 klst.
    kw = {k: _DECIMAL.sub(r"\1,\2", v) if isinstance(v, str) else v for k, v in kw.items()}
    return IS.get(template, template).format(**kw)
