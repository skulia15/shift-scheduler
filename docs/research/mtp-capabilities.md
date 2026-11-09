# MyTimePlan (MTP) capabilities: does it already auto-generate rosters?

Researched 2026-11-09 from public sources only (vendor site, help centre, app/partner listings). The admin manual sits behind a login and was not read, so feature depth is unknown.

## Vendor

- **MyTimePlan ehf.**, an Icelandic company. Its address is Hlíðasmári 2, 201 Kópavogur, phone 511 1024 ([mytimeplan.is](https://www.mytimeplan.is/)). An older App Store listing gives Grandagarður 14, Reykjavík.
- Sites: [mytimeplan.com](https://mytimeplan.com/), [.is](https://www.mytimeplan.is/) and .pl.
- Modules: Staffing requirements (Mönnunarþörf), Planning (Vaktakerfi), Attendance (Tímaskráning), Reports and KPI.
- Mobile apps: "MTP" (legacy) and "MTP2".
- The site names no customers. A public tender shows MTP bid on the time-management system for SHS, the Reykjavík capital-area fire brigade, in 2022; Advania bid lower ([reykjavik.is RFQ 15461 PDF](https://reykjavik.is/sites/default/files/2022-03/15461%20T%C3%ADmastj%C3%B3rnunarkerfi%20fyrir%20SHS.pdf), figures from the search snippet only). The hospital and care-home customer base is **UNVERIFIED**. Landspítali uses **Vinnustund**, not MTP.

## Capability table

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| 1 | Automatic roster generation / optimiser | **PARTIAL / UNCLEAR** | The English marketing pages claim "create optimal shift plans automatically" ([home](https://mytimeplan.com/)) and say the "optimisation engine analyses demand and instantly fills open shifts", with an "Intelligent algorithm fills remaining gaps" ([product](https://www.mytimeplan.com/product/)). The Icelandic process page describes a **wish-driven four-step process**: (1) staff enter wishes until 6 weeks before the period, (2) staff move themselves to understaffed shifts, (3) the manager fixes remaining gaps ("Stjórnandi bestar"), (4) the plan is final. Only the **step transitions** are said to be automatic ([vaktakerfi](https://www.mytimeplan.is/vaktakerfi/)). Fixed rotas are entered by hand well in advance. No source describes a solver that builds a whole roster from scratch under hard rules. Best reading: a gap-filling assist on top of self-rostering, not a CP-SAT-style generator. Not confirmed in documentation. |
| 2 | Staffing demand (min headcount) | **YES**, per hour, per role/department, with skill | Demand is estimated "fyrir hverja klukkustund" (for each hour), usually for a 4–6 week period. It has max and min values per role ("liðsmaður") and department, "tekur tillit til hæfni" (takes skill into account), and can be forecast from historical data ([mönnunarþörf](https://www.mytimeplan.is/monnunarthorf/)). LS One sales data can feed the forecast ([LS AppExchange](https://appexchange.lsretail.com/Content/AppExchange/MTPMyTimePlanPlugin.htm)). |
| 3 | Icelandic collective-agreement rules (betri vinnutími, vægi weighting, 11h rest, overtime) | **UNCLEAR / UNVERIFIED** | Wishes are limited only by "reglur kjarasamninga" (collective-agreement rules) ([vaktakerfi](https://www.mytimeplan.is/vaktakerfi/)). Generic claims of "labour rules", real-time "overtime calculations" and "calculation of salary items" ([?p=34](https://www.mytimeplan.com/?p=34)). No public mention of betri vinnutími, vægi or vaktahvati, or of a specific agreement (Sameyki, SFV, Efling). |
| 4 | Validation warnings on rest / working-time breaches | **UNVERIFIED** | No public source. Item 3's "limited by collective-agreement rules" implies some checking, but warnings in the manager planning view are not documented. |
| 5 | Wishes, day-off requests, swaps, self-service app | **YES** | Wishes are step 1 of planning, and staff self-adjust in step 2 ([vaktakerfi](https://www.mytimeplan.is/vaktakerfi/)). The help centre has a "Shift market" for offering shifts to colleagues and "Registration requests" for schedule changes ([help centre](https://www.mytimeplan.com/help-center/en/)). Staff can see holiday and rest balances in self-service ([.is](https://www.mytimeplan.is/)). |
| 6 | Task / duty assignment within a shift, fair rotation | **PARTIAL** | The help centre has "Tasks: your daily tasks and recording work on them", a "Task report" with "task plans for a period" and "Employee task view" pages for a company task system ([help centre](https://www.mytimeplan.com/help-center/en/mobile/tasks/index.html)). Whether tasks are planned inside a shift (bathing, dining room) or rotated fairly is **UNVERIFIED**. |
| 7 | Fixed area / ward / hallway placement per person | **UNCLEAR** | Shifts carry a "unit", and managers filter by unit ([schedule help](https://www.mytimeplan.com/help-center/en/mobile/schedule/index.html)). Department-level demand exists (#2). A per-person fixed placement rule is **UNVERIFIED**. |
| 8 | Import / export / API | **WEAK / UNVERIFIED** | It "tengist launakerfum" (connects to payroll systems) ([.is](https://www.mytimeplan.is/)). The LS One plugin pushes transaction data into MTP, but the mechanism is undocumented ([LS AppExchange](https://appexchange.lsretail.com/Content/AppExchange/MTPMyTimePlanPlugin.htm)). Reports can be "filter[ed], export[ed] or share[d]". A 50skills marketplace listing existed, but the page now returns 404. **No public API documentation, roster import format or webhook was found.** |

## Notes / interpretation

- MTP's planning model is **demand curve + staff wishes + self-balancing + manager touch-up**, which is self-rostering with a gap filler. It does not take a rule set and demand and solve for a full roster.
- What a separate generator would add over MTP:
  - building the plan from scratch under hard rules (rest, weekly limits, weekend fairness);
  - mixing shift types across varied shifts;
  - fixed area placement;
  - rotating duties within a shift.
- Integration is the main unknown. Any data exchange would need to be negotiated with MyTimePlan ehf (mytimeplan@mytimeplan.com). Questions to ask:
  1. Is there an API or a file import (CSV/Excel) for planned shifts per employee/day/unit?
  2. Can a roster be pushed as "wishes" (step 1) or as the final plan?
  3. Can staffing-demand and employee master data be exported?
  4. Which rule checks run on import?
- The realistic fallback is **CSV/Excel export from the generator plus manual or bulk entry into MTP** until an API is confirmed.

## Competitors (brief)

- **Vinnustund** (Advania; Orri-based state HR/time system) is used by Landspítali and Akureyri. Staff submit shift wishes ("vaktaóskir") ([Akureyri guide](https://gamli.akureyri.is/static/files/Vinnustund/vinnustund-leidbeiningar-vardandi-tima-fjarvistir-og-vaktaoskir.pdf), [Landspítali](https://island.is/en/o/landspitali/vinnustund)). Automatic generation is **UNVERIFIED**; none was found.
- **Tímon** (Icelandic) offers Vaktaplan and time registration ([App Store](https://apps.apple.com/sg/app/t%C3%ADmon/id1542982821)). Auto-scheduling is **UNVERIFIED**.
- **"Timian"**: no Icelandic product by that name was found; the user may mean Tímon.
- **Planday / Quinyx**: international workforce-management tools with auto-scheduling and AI scheduling features. Their Icelandic presence and support for Icelandic agreements were not checked (**UNVERIFIED**).
- An academic model exists for optimising Landspítali doctors' schedules ([Skemman thesis](https://openpolar.no/Record/ftskemman:oai:skemman.is:1946%2F34002/Details)), which shows the problem has been studied locally.

## Sources

- https://mytimeplan.com/
- https://www.mytimeplan.com/product/
- https://www.mytimeplan.com/solutions/
- https://www.mytimeplan.com/?p=175
- https://www.mytimeplan.com/?p=34
- https://www.mytimeplan.com/about-us/
- https://www.mytimeplan.com/help-center/en/
- https://www.mytimeplan.is/
- https://www.mytimeplan.is/vaktakerfi/
- https://www.mytimeplan.is/monnunarthorf/
- https://www.mytimeplan.is/timaskraning/
- https://appexchange.lsretail.com/Content/AppExchange/MTPMyTimePlanPlugin.htm
- https://reykjavik.is/sites/default/files/2022-03/15461%20T%C3%ADmastj%C3%B3rnunarkerfi%20fyrir%20SHS.pdf
- https://gamli.akureyri.is/static/files/Vinnustund/vinnustund-leidbeiningar-vardandi-tima-fjarvistir-og-vaktaoskir.pdf
- https://apps.apple.com/sg/app/t%C3%ADmon/id1542982821
