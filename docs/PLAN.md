# Shift Scheduler — plan

Generates shift rosters for one care-home unit (e.g. a ward in an elderly care home) over a
planning period (typically 4–6 weeks), honouring staffing demand, Icelandic union working-time
rules, reserved holidays, day-off requests, and planner-defined rules.

## Decisions

| Area | Choice |
|---|---|
| Repo | Standalone (`~/shift-scheduler`) |
| Solver | Google OR-Tools CP-SAT, Python 3.12 + FastAPI (`backend/`) |
| UI | Vite + React + TypeScript (`frontend/`) |
| Rule defaults | Icelandic shift-work agreements (see `docs/research/icelandic-rules.md`); all editable |
| v1 scope | Single planner, one unit at a time, project saved in the browser + JSON import/export, CSV export / print |

## Domain model

- **Unit** – name, planning period (start date, number of days).
- **Shift type** – code, name, start/end clock time (may cross midnight), paid break minutes.
  Hours are derived; night hours (configurable window) can carry a weight (vægi) > 1.
- **Staff group** – e.g. `nurse`, `floor`. Demand and rules target groups.
- **Staff member** – name, groups, employment % (starfshlutfall), shift types they may work.
- **Task** – a duty done during a shift (medication round, bathing, dining room…), done by a group.
- **Demand** – per weekday × shift type: minimum headcount per group; per weekday × shift type × task:
  how many people do that task. Date overrides allowed (holidays, events).
- **Leave** – `holiday` (reserved/approved: never scheduled) or `request` (day-off wish: soft,
  high penalty; planner may mark it `granted` → hard).
- **Labour rules** – one object with Icelandic defaults:
  full-time weekly hours, min daily rest, max shift length, max consecutive work days,
  min days off per week, max average weekly hours, overtime threshold & cap,
  max consecutive nights, weekend frequency.
- **Custom rules** – typed, planner-created, each `hard` or `soft` with a weight:
  - `avoid_task_repeat` – group G should not do task T more than N times in any D-day window.
  - `rotate_task_evenly` – task T is shared evenly among members of group G.
  - `max_shift_type` – members of G work shift type S at most N times per period.
  - `forbid_sequence` – shift type A must not be followed by shift type B the next day.
  - `min_staff_with_group` – at least N of group G on shift S (covers "always one nurse").

The whole problem is one JSON document (`Project`); the backend is stateless.

## Solver (CP-SAT)

Variables: `work[s,d,t]` (staff s works shift t on day d), `task[s,d,t,k]` (does task k).

Hard constraints: ≤1 shift/day; eligibility; coverage minimums; task headcount; `task ⇒ work`;
leave (`holiday`, granted requests); min rest between consecutive shifts (pairwise forbid);
max consecutive days; min days off per calendar week; max average weekly hours; overtime cap;
max consecutive nights; any custom rule marked hard.

Soft objective (weighted, minimised): deviation from contracted hours (over = overtime weighted
higher than under), ungranted day-off requests that are worked, task repetition / rotation
imbalance, working weekends beyond the target frequency, overstaffing.

If the model is infeasible, the solver re-runs with coverage relaxed to soft so the planner gets a
roster plus a list of the gaps, instead of nothing.

## Validator

An independent pure-Python checker evaluates any roster (generated or hand-edited) against the
same rules and returns violations per staff/day. It is the test oracle for the solver and powers
live feedback when the planner edits cells.

## API

- `POST /api/solve` — `Project` → `{ roster, violations, stats, status }`
- `POST /api/validate` — `Project + roster` → `{ violations, stats }`
- `GET /api/sample` — demo project (elderly care unit, 14 staff, 4 weeks)

## UI

1. **Setup** – unit & period, shift types, groups, staff, tasks.
2. **Demand** – weekday × shift grid per group, task needs.
3. **Leave** – staff × date grid; click to toggle holiday / request / granted.
4. **Rules** – labour rules form; custom-rule builder.
5. **Roster** – staff × date grid with shift code + task; click a cell to change; violations
   highlighted; per-staff hours vs. contract, overtime, weekends; coverage row per shift; generate,
   re-validate, CSV export, print.

## Milestones

1. Backend models, validator, solver + tests on the sample unit.
2. API + sample project.
3. Frontend: roster view on sample data (generate / edit / validate).
4. Frontend: setup, demand, leave, rules editors; save/load/export.
5. Polish: infeasibility explanations, print view.

## MTP (myTimePlan)

MTP is the system of record for time tracking, day-off requests and shift swaps. This app only
generates and checks the roster: requests come in from MTP and the finished roster goes back to it.
Built: Excel/CSV roster import (grid layout, auto-detected header, names or employee numbers, codes,
times, areas, tasks) and Excel export (grid that re-imports, one-row-per-shift "Vaktir" sheet, rule
check). Typical flow: Import Excel → Repair → Export Excel → MTP. Still needed for a direct MTP
connection: a sample MTP export and MTP's roster import format or API (ask MyTimePlan).
Sample manager sheet: `docs/samples/manager-roster.xlsx`.

Out of scope for v1: logins, multiple units, staff self-service requests, pay calculation.
