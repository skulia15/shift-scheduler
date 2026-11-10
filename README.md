# Vaktaplan

Shift rostering for Icelandic care homes. Vaktaplan builds a four-week roster for a unit that
respects the collective agreements (betri vinnutími, rest rules, days off, holiday weighting), the
unit's staffing and skill needs, reserved holidays and day-off requests, and the unit's own rules.
It then helps the planner keep it right: every edit is checked instantly, and **Repair** fixes
problems with the fewest shift changes.

The UI is in Icelandic and English.

## What it does

- **Generate** a roster with a constraint solver (Google OR-Tools CP-SAT): hard rules are never
  broken, soft goals (fair weekends and holidays, contract hours, requests, task rotation) are
  weighed with penalty points.
- **Repair / regenerate**: keep locked cells and the past, change as little as possible, and list
  each change with its notice and change fee (breytingargjald).
- **Agreement rules**: SFV, state, municipal and Reykjavík presets; 36 h week with hour weighting
  (vægi 1.05 / 1.2, 165% band), 32 h floor, 11 h / 8 h rest, 35 h weekly rest, two days off,
  shift-length limits, holiday duty reduction and the Icelandic holiday calendar.
- **Unit needs**: headcount per shift and per hallway, skills (e.g. Lyfjaréttindi, Íslenska),
  tasks that can require a skill, and rules such as "keep a person in one hallway" or "a varied
  shift mix".
- **Over time**: the previous roster's last week feeds the rest rules, and a fairness ledger
  carries weekends, nights and holiday shifts across periods.
- **Excel**: import a manager's roster spreadsheet (layout detected automatically) and export a
  grid, a one-row-per-shift sheet and the rule check.

## Run it

Requires [uv](https://docs.astral.sh/uv/) (Python 3.12) and Node 20+ with pnpm.

```bash
(cd backend && uv sync)
(cd frontend && pnpm install)
./dev.sh            # API on :8000, UI on http://localhost:5173
```

Tests:

```bash
cd backend && uv run pytest -q
cd frontend && node_modules/.bin/tsc -b && node_modules/.bin/eslint src
```

## Layout

| Path | What |
|---|---|
| `backend/app/solver.py` | CP-SAT model: generate, repair, regenerate |
| `backend/app/validator.py` | Independent rule check used for live feedback and as the solver's test oracle |
| `backend/app/context.py` | Derived facts: shift times, hour weighting, targets, demand per cell |
| `backend/app/holidays.py` | Icelandic public holidays per agreement |
| `backend/app/spreadsheet.py` | Excel/CSV import and export |
| `frontend/src/views/` | Roster, Setup, Demand, Leave and Rules screens |
| `frontend/src/i18n-is.ts` | Icelandic UI strings |
| `docs/RULE-SPEC.md` | The agreement rules and what the app enforces |
| `docs/research/` | Research on the agreements and care-home scheduling |
| `demo/` | Scripted walkthrough video recorder |

The demo unit (`/api/sample`) is fictional.
