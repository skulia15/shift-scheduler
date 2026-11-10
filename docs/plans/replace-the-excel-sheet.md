# Replacing the planner's spreadsheet

Goal: the unit's schedule maker stops using their Excel workbook. Vaktaplan must hold everything
the workbook holds, generate the schedule from it, and make the remaining manual work quicker
than typing in Excel.

The real workbook is kept locally in `private/` (git-ignored). It contains staff details and must
never be committed; tests use synthetic sheets with the same layout.

## What the workbook does today

| Workbook part | What it holds | Vaktaplan today |
|---|---|---|
| One row per person, 31 day columns (15th → 14th) | Each cell a clock time, e.g. `08:00-16:00`, `17:45-21:45`, `23:59-07:59` | ✅ roster grid, 1–84 day periods |
| ~16 distinct clock times | Staggered starts and part shifts within each of morning (MV), evening (KV), night (NV) | ⚠️ any number of shift types, but colours/legend assume ~3; no MV/KV/NV grouping |
| Cell colour | Blue = MV, green = KV, orange = NV | ❌ colour per shift type, not per category |
| Hours columns (VSKB, hlutfall, target, hours per week) | Worked vs. contract hours per person; employment fraction | ✅ hours vs. target with weighting |
| Night-shift count, red days | Per-person counts | ✅ in fairness / stats |
| Count rows under the people (≈20 rows) | Daily headcount per clock time, with a note: "alla daga - 1", "mán-fim - 1; fös-sun - 2", "aðeins um helgar", "helst að hafa 6", "þarf ekki alltaf" | ⚠️ per-shift min/max by weekday exists; no *preferred* (soft) target, no "only when short" fallback shifts |
| Wishes column (free text per person) | See below | ❌ mostly not expressible |

### What the wishes ask for (anonymised patterns)

| Pattern in the wishes | How often | Needed in Vaktaplan |
|---|---|---|
| Every other / every third / no weekends | very common | **Weekend pattern** per person: work 1 of every N weekends, or never |
| Only some shift kinds ("bara KV", "Einungis MV", "Mest NV", "Blandaðar vaktir MV og KV") | very common | Allowed / preferred **categories** (exists as allowed shift types; needs categories + preference) |
| Specific clock times ("8-15", "alltaf 7.30-15.30", "kemst ekki kl 16", "Frá 17") | common | Allowed shift times per person (exists) + "earliest start" |
| Fixed weekdays ("alla mánudaga 18-00", "vinnur mán og fim") | common | **Recurring shift**: weekday → shift, hard or preferred |
| Unavailable weekdays ("Ekki vakt á fim og mán", "frí á fimmtudögum") | common | **Weekday unavailability** |
| Per-week counts ("Tvær MV í viku", "ein kvöldvakt á viku") | common | **Shifts per week** of a category, min/max |
| Weekend tied to weekdays ("vinnur mánudaga vikuna sem hún vinnur helgi") | some | Pattern linked to the weekend pattern (later) |
| Hallway responsibility ("alltaf á gula ganginum") | some | ✅ fixed area |
| Shift lead (vaktstjóri) | some | ✅ skill, plus "one shift lead per shift" |
| Two people like to share nights | rare | **Pair preference** (soft) |
| Week rotation MV → KV → NV | rare | Rotation pattern (later) |
| Reduced capacity due to sick leave | rare | Hours override (exists) |

## Plan

Each phase ends with something the planner can use.

### Phase 1 — Bring the unit in from the workbook
- Import the workbook as a **whole project**, not only a roster: one person per row with a mock
  name, employment % from *Hlutfall*, every clock time as a shift type grouped into MV/KV/NV (by
  cell colour, falling back to start time), the current roster, and each wish as a note on the
  person.
- Read the count rows as staffing needs per shift and weekday, translating notes like
  "mán-fim - 1; fös-sun - 2" into rules, flagged for the planner to confirm.
- Fix the wrong year on the January columns automatically.
- **Shift categories** in the model and UI: MV/KV/NV colours, legend grouped by category, codes
  like M, M7, M5 (07:30, 5-hour shift).

### Phase 2 — Wishes as rules, per person
- A **person panel** (from Setup or by clicking a name in the roster) with the wish note and
  structured preferences: weekend pattern, allowed and preferred categories, earliest start,
  recurring shifts, unavailable weekdays, shifts per week, pair preference.
- Solver support for each, hard or soft.
- **Wish suggestions**: read the free-text wish and propose the structured rules for the planner
  to accept (pattern rules first; optionally an LLM for the long tail).

Done: weekend pattern, allowed shifts (kind / clock time / weekdays), recurring weekday shift,
unavailable weekdays, shifts per week, mixed shifts by kind, work together; the person panel; and
suggestions from the wish text (all soft). On the real sheet about 100 rules are read from 46
wishes; a generated roster misses about half as many of them as the sheet's own roster does.
Not yet: alternating patterns ("Mondays on weekend weeks, Thursdays the other week"), weekly
MV → KV → NV rotation, "one Friday a month", and pairs named in the text (names are mock).

### Phase 3 — Staffing needs that match practice
- Preferred (soft) headcount above the hard minimum ("helst að hafa 6").
- "Fallback" shifts that are only used when short ("þarf ekki alltaf").
- Linked shifts ("Saturday 17:30-00:00 gets Sunday 17:00-23:00").

Done: preferred headcount (soft, 30 points per missing person), only-when-short rows that can
count as the main shift of their kind (25 points per use, so they fill gaps only), and a linked-
shift rule. The workbook import reads all three from the count-row notes. On the real sheet a
generated roster has 0 errors; mornings miss the preferred 6 on 8 days and the 08:00-15:30
fallback is used 15 times.

### Phase 4 — Quicker than Excel
- The roster opens on the planner's real period (15th → 14th) with last period carried over.
- One-click **Generate → Repair → Export** with a summary of which wishes were met.
- A wishes report per person: met / not met and why.
- Export in the workbook's own layout so it can still be printed or sent as before.

## Open questions

1. Is the period always the 15th to the 14th?
2. Are the count-row notes the agreed staffing rules, or the planner's rough guide?
3. Should wishes like "every other weekend" be hard rules or strong preferences?
4. Where do staff send wishes today (MTP, email, in person)? That decides whether wishes are
   entered in Vaktaplan or imported.
