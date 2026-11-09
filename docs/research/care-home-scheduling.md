# Care-home rostering: common problems and practices that work

Researched 2026-11-09 for Vaktaplan (CP-SAT rostering for Icelandic hjúkrunarheimili). The source keys in [brackets] refer to the source list at the end. **UNVERIFIED** marks a claim not confirmed from a source I read. Working-time law and collective-agreement rules (rest, weighting, vaktaálag, notice) are covered in [icelandic-rules.md](icelandic-rules.md) and are only referenced here.

## Executive summary

1. **The problem in Icelandic care homes is skill mix more than headcount.** The Directorate of Health's (Embætti landlæknis) 2015 staffing benchmarks ask for nurses at about 27% of care staff (minimum 20%) and skilled staff at about 78% (minimum 57%) [EL2015 via VISIR26, SLFI]. Recent audits found homes far below this: Hraunbúðir had nurses at 12% and skilled staff at 27%, and Skjól had 15% and 33% [VISIR26]. The October 2025 ministry action plan says outright that staffing has not met the benchmarks, especially for skilled staff, and that service contracts neither require nor fund them [HRN25]. A rostering app cannot create nurses. It can make sure the few available are spread so that every shift has the required competence, and it can show the gap against the benchmark.
2. **Most disruption happens after the roster is published.** In a US nursing home with stable staff, about 1 in 3 shifts differed from the posted schedule [UNEQUAL]. A study of eight skilled nursing facilities found that "patching" of holes is mostly improvised: phoning staff at random, asking for volunteers, and managers covering shifts themselves [KOSSEK]. The highest-value feature after the base solver is **sick-call re-optimisation with minimal changes** [MOZPATO, ROBUST].
3. **Scheduling choices drive turnover.** Among 6,221 part-time nursing assistants in 157 facilities, turnover was U-shaped in hours worked and **rose with variability in who they worked alongside** [MAYO]. Quick returns (under 11 h between shifts) predicted more sick leave the following month, about 21% higher odds [VEDAA]. Shifts of 12 h or more were associated with burnout and job dissatisfaction [DALLORA]. In Norwegian nursing homes, introducing long shifts was linked to more sick leave, though the estimates were uncertain [FRISCH].
4. **Continuity of care is achievable through rostering.** Optimising which staff get consistent unit assignments, with part-timers prioritised rather than full-timers, cut the number of different nursing assistants a resident sees by 20–30%. Smaller units roughly halved inconsistency [SLAUGH]. Consistent assignment is associated with lower turnover, better family satisfaction and most CMS quality measures, but the evidence is observational and mixed [CASTLE, CONSIST].
5. **Self-rostering needs an optimiser behind it.** Reviews find mostly positive effects on satisfaction. However, pure self-rostering was less equitable than fixed rostering and was associated with more overtime [OCONNELL]. In Flemish nursing homes, self-scheduling was perceived as *less fair* [WYN-NH]. The workable model is a wish window, followed by an optimiser that enforces coverage and balances how many wishes each person gets granted.
6. **Fairness must be measured over time and against the worst-off person.** The literature recommends min-max objectives that protect the least-favoured nurse, rather than averages [SMET-FAIR, MARTIN]. INRC-II models rostering as consecutive weeks with history carried forward [INRC2]. Weekend, night, holiday and short-notice-change counts therefore belong in a ledger that spans planning periods.
7. **Acuity should drive demand.** In Iceland, interRAI/RUG weights set part of the daily payment and are used by managers to plan staffing. However, payments lag acuity by more than a year, and homes "find it hard to adjust staffing to changes in care weight" [RAI23]. The 2025 plan calls for new flexible, quality-linked staffing benchmarks by spring 2027 and annual staffing-need analyses tied to care weight [HRN25].

## Pain point, practice and app feature

Coverage legend for the last column: **Covered** means the app already does this per the brief. **Partial** means part of it exists. **Missing** means not present.

| # | Pain point (evidence) | Practices that work | Concrete app feature / rule | Status |
|---|---|---|---|---|
| 1 | **Skill-mix gaps.** Nurse share is well below the 20% minimum in audited homes [VISIR26]. Collective agreements define an "öryggisvakt" where a nurse covers units that lack one [FIH-SFV, via search]. Medication-competent staff are needed on every shift (UNVERIFIED as a formal rule) | Competence-based coverage rules, not only headcount by job title. Cross-unit nurse coverage | Competence tags per person (nurse, sjúkraliði, medication-certified, Icelandic B2, first-aid, lift-trained). Coverage rules of the form "≥ N with tag X on shift S, optionally per area", plus "one nurse may cover areas A+B" | **Partial**: there is headcount per staff group, but no cross-group competence tags or "at least one with X" rules |
| 2 | **Sick calls and last-minute absences.** About 1/3 of shifts deviate from the posted schedule [UNEQUAL]. Patching is improvised, and managers cover shifts themselves [KOSSEK] | Rerostering that minimises changes to the published roster and secondarily balances workload [MOZPATO]. Turn reserve shifts into real shifts first [ROBUST] | "Mark absent" leads to re-solve with a hard freeze on the past and a penalty per changed assignment. The app shows a ranked replacement list (rest-legal, overtime-fair, cheapest, same area) and the cost of breytingargjald for <24 h and 24–168 h notice ([icelandic-rules.md](icelandic-rules.md) 6c) | **Missing** |
| 3 | **Staff turnover tied to schedules.** U-shaped turnover vs. hours. Coworker variability raises turnover, and high turnover is linked to worse resident outcomes [MAYO]. UK care-worker turnover is about 25%, and 41% for domestic recruits [SFC24] | Keep coworker groups stable. Give part-timers the hours they want | Soft objective for **coworker stability** (penalise changes in who works with whom on the same area). A target-hours band per person (min/desired/max) so part-timers who want more hours are offered extra shifts before overtime or agency | **Partial**: contract hours and fixed-area preference exist; coworker-stability objective missing |
| 4 | **Continuity of care.** Residents see many different carers. Common practice gives full-timers home units first and part-timers fill gaps [SLAUGH] | Consistent assignment. Prioritise part-timers for unit consistency and keep some full-timers flexible. Smaller units [SLAUGH, CASTLE] | Per-person "home area" with a weighted penalty for off-area shifts, **weighted higher for part-timers**. A continuity KPI per area: distinct carers per resident group per month | **Partial**: fixed-area preference exists; KPI and part-timer weighting missing |
| 5 | **Unfair weekends, nights and holidays.** Agreements require helgidagavinna to be spread "as evenly as possible" ([icelandic-rules.md](icelandic-rules.md) #9). Self-rostering is perceived as less fair [WYN-NH, OCONNELL] | Min-max fairness, i.e. protect the worst-off person [SMET-FAIR]. Carry history across periods [INRC2] | **Fairness ledger** across periods: weekends, nights, stórhátíðardagar (Christmas/New Year), short-notice changes, denied wishes, overtime. The solver uses ledger deficits as weights, with a min-max term. The ledger is visible to staff | **Partial**: weekend share and overtime fairness exist within a period; cross-period ledger and holiday rotation missing |
| 6 | **Quick returns and fatigue.** About 80% of Norwegian nurses have <11 h rests in their roster. Quick returns raise sick leave the next month [VEDAA]. Icelandic law allows 8 h at a planned shift change ([icelandic-rules.md](icelandic-rules.md) 2c) | Eliminate quick returns where possible while keeping nights [VEDAA, STAMI-RCT]. Prefer forward-rotating sequences (UNVERIFIED for care homes specifically) | A soft penalty for every legal-but-short rest (8–11 h), especially evening→morning, and a cap per person per period. A KPI showing quick returns per person | **Partial**: hard rest rules exist; soft penalty for legal short rests probably missing |
| 7 | **Shift length.** 12 h+ shifts were associated with burnout and intention to leave in a study of 31,627 nurses in 12 countries [DALLORA]. Norwegian nursing homes saw more sick leave after introducing long shifts (uncertain) [FRISCH] | 8 h default. Long shifts only where they buy something specific (e.g. weekend coverage, "heltid") and not stacked | Shift templates with a per-person maximum long-shift count and no long shifts back to back | **Partial**: consecutive-day limits exist; long-shift caps unknown |
| 8 | **Agency or temp reliance and cost.** US agency use rose from <20% to nearly 50% of nursing homes between 2018 and 2022, at a premium of about $24/h. Administrators cite cost and staff unfamiliar with the facility [AGENCY]. In Iceland the share of agency staff via starfsmannaleigur is rising in hospitals [FIH21] | An internal bank/float pool. Cross-trained staff. Predict absences and add reserve shifts [RYU] | Staff type = bank/on-call with availability and no contract-hours target. Reserve shifts in the plan sized to the historical absence rate. Agency is the last-resort slot with high cost in the objective | **Missing** |
| 9 | **Overtime overuse.** Swaps and patches trigger overtime [KOSSEK]. Self-rostering is associated with more overtime [OCONNELL] | Count overtime as a cost. Distribute it fairly. Prefer part-timers' extra hours (paid at straight time) before overtime | Overtime cost in the objective, with Y1/Y2 bands. Per-person overtime cap | **Covered** (overtime fairness); cost bands **Partial** |
| 10 | **New staff, students and language.** The 2025 plan stresses ensuring staff have enough Icelandic to take part in training [HRN25]. Job ads require Icelandic at B2 [RVKJOB]. Students are not full staff and need supervision [LSH21]. About 1 in 5 new hires is at risk of leaving in the first 90 days (trade source) [LAMN] | Buddy or peer-mentor programmes. Single-site reports claim 90-day retention reached 86% [LAMN] | **Pairing rules**: "person X must work with someone tagged mentor/experienced", "≥1 Icelandic-speaker per area per shift", "students do not count toward minimum headcount", and "≥ N shifts with assigned buddy in first M weeks" | **Missing** |
| 11 | **Summer and holiday leave (orlof).** Summer staffing is a recurring challenge, services are reduced every summer to give statutory leave [LSH21]. Parliament has asked about temporary home closures for summer leave [ALTH-SUMMER] | Plan leave as a long-horizon problem. Spread summer leave in waves. Pair summer staff with experienced staff | Leave-wave planner: a quota of people on leave per group per week. Summer staff onboarding pairing (see #10) | **Partial**: reserved holidays and day-off requests exist |
| 12 | **Self-rostering and swap chaos.** Staff are expected to find their own replacements [KOSSEK] | A hybrid: wish window, then optimisation [WYN-SR, OCONNELL]. Validate swaps against the rules | Wish window with a limited number of "strong wishes" per person (points). Optimiser output reports granted/denied wishes per person, and denied wishes feed the fairness ledger. A swap marketplace that checks rest, competence and hours before approving | **Partial**: day-off requests exist; points, swap validation missing |
| 13 | **Unpredictability and late publishing.** NHS guidance: approve and publish rosters ≥6 weeks ahead [NHSE-ER]. Icelandic agreements: draft 6 weeks ahead, final 1 month ahead ([icelandic-rules.md](icelandic-rules.md) 6c). Schedule volatility is linked to turnover for full-time home-health nurses [VOLATILITY] | Fixed publishing calendar. Lock periods. Track changes | Roster states (draft, published, locked). A deadline indicator. A change log per person with notice-band classification | **Missing** (UNVERIFIED: not in the brief) |
| 14 | **Acuity mismatch.** RUG payments lag care weight by more than 1 year. It is hard to add skilled staff or care hours when need rises [RAI23]. Residents are sicker than before [HRN25] | Acuity-based demand. The 2015 benchmarks used care hours per resident per day; one audit cites a 4.65 minimum and 5.34 desirable (UNVERIFIED as the benchmark's general values; seen only in the Hraunbúðir audit summary) [SLFI] | Demand calculator: residents × care hours/day (optionally by RUG group), producing required hours per shift and group. A **benchmark panel** showing nurse %, skilled %, and care hours per resident/day vs. the 2015 benchmarks | **Missing** |
| 15 | **Planner time and compliance mistakes.** No primary figure for Icelandic planners found (UNVERIFIED). NHS case: e-rostering moved approval from 4 to 7 weeks ahead [NHSE-ER] | Automated rule checking. Explain infeasibility | Explain-why panel for unmet coverage (which rule blocked it). Vaktahvati eligibility check per person (≥2 shift types, ≥45 h each, ≥126 h outside day work, ≥14 attendances [VAKTAHVATI]) | **Partial**: rules are validated; vaktahvati check unknown |
| 16 | **Part-time and multiple jobs.** Norway: only one in five positions is full-time, and helsefagarbeidere average 78% of a full position [ALTINGET]. In the US, CNAs take extra shifts to supplement pay [UNEQUAL] | "Heltidskultur": offer bigger positions using weekend or long-shift patterns [NSF] | Availability constraints per person (other-job blackout days). A "wants more hours" flag that feeds extra-shift offers | **Partial**: day-off requests can approximate this |

## Icelandic specifics

**Staffing benchmarks.** The Directorate of Health issued "Viðmið um mönnun á hjúkrunarheimilum skilgreind", 2nd edition, in September 2015. It defines the share of certain professions and care hours on nursing homes [HRN25].
- Nurses: about 27% of care staff is desirable, with 20% as the floor. Skilled staff (nurses, sjúkraliðar, félagsliðar): 77.87% desirable, 57.13% floor, counted in care FTEs (stöðugildi), not payroll [VISIR26, SLFI].
- The benchmarks are non-binding ("faglegt gildi en ekki lagalegt") [ALTH153-727 via search]. Apart from them, no recognised minimum staffing or nurse ratio exists for Icelandic health institutions [RIKISEND17].
- Care hours per resident per day are used in audits. The Hraunbúðir audit summary cites 5.02 actual vs. a 4.65 minimum and 5.34 desirable [SLFI] (general applicability UNVERIFIED).
- FÍH (October 2026) calls for binding standards in law or regulation and regular publication of staffing data [VISIR26].

**Contracts with Sjúkratryggingar Íslands (SÍ).**
- Staffing requirements are those in the *kröfulýsing* for nursing and residential places, which is an annex to the SÍ service agreements. No other staffing requirements may be imposed. Appropriate staffing is meant to follow from care weight plus contractual and legal requirements [HRN25].
- The service contract only asks for "a sufficient number of skilled and unskilled staff", which is undefined [SLFI].
- A 16.39% sjúkraliði wage-cost share in the SÍ contract appendix (based on 2016 data) has reportedly acted as a de facto hiring cap at one home [SLFI]. This is a union claim.
- The SFV/SÍ agreements were extended in March 2025 [SFV via search]. I did not find the current (2026) agreement text (UNVERIFIED).
- **24/7 nurse-on-site rule:** I found no source stating a formal requirement in the kröfulýsing (UNVERIFIED). Treat "≥1 nurse per shift, possibly shared across units" as a configurable rule, not a statutory one.

**RAI / interRAI and acuity.**
- interRAI was adapted for Iceland in 1997 and its time-study weights were last revised in 2002. A 2015 time study was done but never implemented [RAI23].
- Each resident gets a RUG weight. The home's average RUG weight drives cost item 3 (nursing service) of the daily rate.
- Assessment periods: A (June–October), B (November–February), C (March–May, optional). The weight for year N is taken from June N-2 to May N-1, a lag of more than a year. Homes are therefore reluctant to admit heavy-care residents, and they "find it hard to adjust staffing to changes in care weight" [RAI23].
- Managers, mostly in larger homes, use the RUG weight to plan and distribute staff [RAI23].
- High-need "cost outliers" can apply to a separate fund for extra staffing. Outliers ranged from 1.25% to 36.36% of residents across 23 homes [RAI23].
- **Implication:** the app should accept acuity (RUG or care hours) per area and convert it to demand. It should also let the manager show the extra staff hours caused by outlier residents, which supports outlier-fund applications.

**Action plan on nursing-home staffing (Heilbrigðisráðuneytið, October 2025) [HRN25].** It came from the 2024 Efling–SFV agreement statement. It has five tracks: more professional education, staffing, workforce development, welfare technology, and working conditions. Items relevant to rostering:
- Annual staffing-need analyses in light of care weight (autumn 2026).
- New flexible quality-linked staffing benchmarks covering care weight, building design, size, welfare tech and a broader set of staff groups (spring 2027).
- Analysis of division of tasks: "who may do which tasks" (spring 2027).
- A new job title for carers with level-2 training (autumn 2028).
- Ensuring enough Icelandic for training courses.
- The plan's costs are not estimated, and implementation depends on funding.

**Working time (betri vinnutími).** Full-time shift work is 36 h, with weighted credit of 1.05 for evening/weekend hours and 1.2 for night hours, and a 32 h floor. Details are in [icelandic-rules.md](icelandic-rules.md).
- **Vaktahvati** (a shift incentive, a percentage of salary) requires, over 3 settlement periods: ≥126 h outside day work, ≥2 shift types, ≥45 h in each, and ≥14 attendances per period on average [VAKTAHVATI]. This is a staff-side reason to *want* a varied shift mix, so the app's varied-shift-mix rule should be checkable against these thresholds.
- Funding impact: the state added ISK 800m in 2021 for the shorter week [RAI23]. SFV says funding does not meet the government's care-hour and skill-mix benchmarks [SFV-ALTH].

**Typical shift pattern.** Morning 08–16, evening 16–24, night 00–08 (8 h). The vaktaálag band boundaries at 08/17/24 are consistent with this, but I did not find a source stating standard shift times for hjúkrunarheimili (UNVERIFIED). Many homes also run short shifts (e.g. 4–6 h evening shifts), which the agreements allow (4–10 h normal range, [icelandic-rules.md](icelandic-rules.md) #4); their prevalence is UNVERIFIED.

**Known problems reported in Iceland.**
- Chronic difficulty staffing professionals [HRN25].
- Residents are sicker than before [HRN25].
- Payment lag on acuity [RAI23].
- Capacity is growing fast: 3,062 places at the end of 2025, with a target of 4,417 by 2030, which will compete for the same staff [STJR26 via search].
- Summer leave forces service reductions [LSH21].
- The share of foreign staff and agency staff is rising (hospital data) [FIH21].
- There is no central register of skilled vs. unskilled staff per home [ALTH153-439 via search].

## Top features, ranked by expected impact

Each item notes its evidence base and its status in Vaktaplan.

1. **Competence coverage rules** (nurse, medication, Icelandic-speaker per shift and area, cross-unit nurse cover). Evidence: [VISIR26, HRN25]. Status: **Partial**.
2. **Sick-call rerostering with minimal change**, plus a ranked replacement list and notice-fee cost. Evidence: [UNEQUAL, KOSSEK, MOZPATO]. Status: **Missing**.
3. **Cross-period fairness ledger** (weekends, nights, stórhátíð, short-notice changes, denied wishes) with a min-max objective. Evidence: [SMET-FAIR, INRC2]. Status: **Partial**.
4. **Coworker and continuity stability**: home area weighted toward part-timers, coworker-variability penalty, continuity KPI. Evidence: [MAYO, SLAUGH, CASTLE]. Status: **Partial**.
5. **Acuity-driven demand and benchmark panel** (care hours per resident/day, nurse %, skilled % vs. the 2015 benchmarks). Evidence: [RAI23, HRN25, SLFI]. Status: **Missing**.
6. **Quick-return minimisation** (soft penalty for legal 8–11 h rests). Evidence: [VEDAA]. Status: **Partial**.
7. **Bank and reserve staffing**: on-call pool staff type, reserve shifts sized to the absence rate, agency as a costed last resort. Evidence: [AGENCY, RYU, ROBUST]. Status: **Missing**.
8. **Wish window with points, and validated swaps.** Evidence: [OCONNELL, WYN-NH]. Status: **Partial**.
9. **Buddy and onboarding pairing** (new staff and students with experienced staff; students outside minimum headcount). Evidence: [HRN25, LSH21, LAMN]. Status: **Missing**.
10. **Publishing lifecycle and change log** (draft at 6 weeks, final at 1 month, notice-band classification). Evidence: [NHSE-ER, icelandic-rules]. Status: **Missing**.

Next tier: hours-stability band for part-timers; vaktahvati eligibility check; leave-wave planner for summer; caps on long shifts; explain-why panel for infeasibility.

Already covered and supported by the evidence: rest and consecutive-day rules, weekly days off, weighted contract hours, overtime fairness, weekend share, fixed-area preference, varied shift mix, task rotation.

## Sources

Peer-reviewed / OR
- [BURKE04] Burke, De Causmaecker, Vanden Berghe, Van Landeghem (2004). The state of the art of nurse rostering. *J. Scheduling* 7(6). https://alexandrechecoli.github.io/1-meta/Materiais/Artigos/2004%20-%20The%20State%20of%20the%20Art%20of%20Nurse%20Rostering%20-%20Burke,%20Causmaecker.pdf (not read in full)
- [INRC2] Ceschia, Dang, De Causmaecker, Haspeslagh, Schaerf. Second International Nurse Rostering Competition. *Ann. Oper. Res.* 274 (2019). https://arxiv.org/pdf/1501.04177
- [SMET-FAIR] Smet, Martin, Ouelhadj, Özcan, Vanden Berghe. Investigation of fairness measures for nurse rostering. https://lirias.kuleuven.be/retrieve/176620
- [MARTIN] Martin, Ouelhadj, Smet, Vanden Berghe, Özcan (2013). Cooperative search for fair nurse rosters. *Expert Syst. Appl.* 40(16). https://people.cs.nott.ac.uk/pszeo/docs/publications/fairnessNurseRosteringCoop.pdf
- [MOZPATO] Moz & Pato (2007). Bi-objective nurse rerostering problem. *J. Heuristics* (abstract via search only)
- [ROBUST] Robust personnel rostering: how accurate should absenteeism predictions be? https://arxiv.org/pdf/2406.18119
- [RYU] Ryu & Jiang. Nurse staffing under absenteeism: a DRO approach. *MSOM* (2025). https://pubsonline.informs.org/doi/full/10.1287/msom.2023.0398
- [MAYO] Mayo, Webb, Ball, Bretthauer (2024). Scheduling smarter: scheduling decision impact on nurse-aide turnover. *MSOM* 26(1). https://econpapers.repec.org/RePEc:inm:ormsom:v:26:y:2024:i:1:p:182-196
- [SLAUGH] Slaugh & Scheller-Wolf (2022). Flexibility and consistency in long-term care rostering. *MSOM*. Summary: https://www.cmu.edu/tepper/news/stories/2022/december/long-term-care-facilities.html
- [CASTLE] Castle & Harris (2015), consistent assignment and quality (3,550 facilities). https://pmc.ncbi.nlm.nih.gov/articles/PMC4542702
- [CONSIST] Consistent assignment: an update on the quality impact. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6846526/
- [KOSSEK] Kossek, Rosokha, Leana (2019). Work schedule patching in health care. *Work and Occupations* 47(2). https://pmc.ncbi.nlm.nih.gov/articles/PMC8623715
- [UNEQUAL] Clawson & Gerstel, *Unequal Time* (summary). https://healthforce.ucsf.edu/node/5966
- [VOLATILITY] Schedule volatility and home-health nurse turnover. https://healthworkforce.ucsf.edu/bibcite/reference/1936
- [VEDAA] Vedaa et al. (2017). Quick returns and sick leave among nurses. *OEM* 74(7). https://oem.bmj.com/content/74/7/496.long
- [STAMI-RCT] Cluster-RCT of schedules without quick returns (protocol and results). https://stami.no/publikasjon/shift-schedule-with-fewer-short-daily-rest-periods-and-sickness-absence-among-health-care-workers/
- [DALLORA] Dall'Ora et al. (2015). 12-h shifts, burnout and job dissatisfaction. *BMJ Open*. https://eprints.soton.ac.uk/381129/1/e008331.full.pdf
- [OCONNELL] O'Connell et al. (2024). Impact of electronic and self-rostering systems: mixed-method systematic review. *J. Clin. Nurs.* https://research.ucc.ie/en/publications/the-impact-of-electronic-and-self-rostering-systems-on-healthcare/
- [WYN-SR] Wynendaele et al. (2020). Systematic review of the impact of self-scheduling. *JAN*. https://researchportal.be/en/publication/systematic-review-what-impact-self-scheduling-patient-nurse-and-organization
- [WYN-NH] Wynendaele et al. Self-scheduling vs. fixed scheduling in 12 Flemish nursing homes. https://pesquisa.bvsalud.org/bvsms/resource/pt/mdl-39115092
- [AGENCY] Agency staff utilisation in nursing homes and assisted living. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12761056/ ; https://skillednursingnews.com/2024/02/states-where-nursing-homes-used-the-most-agency-nursing-staff-in-2022/

Government / industry
- [HRN25] Heilbrigðisráðuneytið (Oct 2025). Aðgerðaáætlun um mönnun á hjúkrunarheimilum. https://www.stjornarradid.is/gogn/rit-og-skyrslur/rit/2025-12-31-Adgerdaaaetlun-um-monnun-a-hjukrunarheimilum/ (PDF: https://www.stjornarradid.is/library/?itemid=155d6922-5ab4-11f1-b8a2-005056bcde1f), read in full
- [RAI23] Heilbrigðisráðuneytið (Dec 2023). Endurskoðun á mats- og greiðslukerfi hjúkrunarheimila. https://stjornarradid.is/library/04-Raduneytin/Heilbrigdisraduneytid/ymsar-skrar/Endursko%c3%b0un%20%c3%a1%20mats-%20og%20grei%c3%b0slukerfi%20hj%c3%bakrunarheimila_Lokask%c3%bdrsla%20des%202023.pdf (read partially)
- [VISIR26] Helga Rósa Másdóttir (FÍH), "Hver ætlar að hjúkra þér?", Vísir, 19 Oct 2026. https://www.visir.is/g/20262950742d/hver-aetlar-ad-hjukra-ther-
- [SLFI] Sjúkraliðafélag Íslands, "Þegar reikniformúla verður að ráðningarþaki sjúkraliða". https://www.slfi.is/frettir/thegar-reikniformula-verdur-ad-radningarthaki-sjukralida
- [RIKISEND17] Ríkisendurskoðun (2017). Hjúkrunarfræðingar: mönnun, menntun og starfsumhverfi. https://www.rikisend.is/reskjol/files/Skyrslur/2017-Hjukrunarfraedingar_Monnun_menntun_og_starfsumhverfi.pdf (via search)
- [ALTH153-727] Alþingi 153. lþ. þskj. 727 (staffing norms answer). https://www.althingi.is/altext/153/s/0727.html (403 on fetch; via search snippet)
- [ALTH153-439] Alþingi 153. lþ. þskj. 439. https://www.althingi.is/altext/153/s/0439.html (via search snippet)
- [SFV-ALTH] SFV submissions to Alþingi on nursing-home funding. https://althingi.is/altext/erindi/153/153-47.pdf (via search snippet)
- [VAKTAHVATI] Mannauðstorg ríkisins, Vaktahvati. https://island.is/adstod/mannaudstorg/laun-og-kjaramal/vaktahvati
- [FIH21] Tímarit hjúkrunarfræðinga 2021, "Engum er hjúkrað…". https://old.hjukrun.is/library/Timarit---Skrar/Timarit/Timarit-2021/2-tbl-2021/EngumErHjukrad%20-%20Copy%20(1).pdf (via search snippet)
- [LSH21] Fagráð Landspítala, ályktun um mönnun að sumri (2021). https://www.landspitali.is/library/Sameiginlegar-skrar/Gagnasafn/Nefndir-og-rad/Fagrad-Landspitala/alyktanir-og-alit/fagrad_landspitala_ayktun_monnun_sumar_010621_2.pdf (via search snippet)
- [STJR26] Stjórnarráð (16 Mar 2026). Ríflega 1.500 hjúkrunarrými tekin í gagnið fyrir lok árs 2030. https://www.stjornarradid.is/efst-a-baugi/frettir/stok-frett/2026/03/16/Riflega-1.500-hjukrunarrymi-tekin-i-gagnid-fyrir-lok-ars-2030-/
- [RVKJOB] Reykjavíkurborg care job ad (Icelandic B2). https://reykjavik.is/job/43785
- [ALTH-SUMMER] Alþingi question on summer closures. https://www.althingi.is/altext/138/s/1248.html (via search snippet)
- [FRISCH] Frisch Centre report on rota schemes and sick leave (Norway). https://kudos.dfo.no/documents/373206/files/47506.pdf (via search snippet)
- [ALTINGET] Altinget, "Det er en deltidskrise i norsk helsevesen". https://www.altinget.no/artikkel/mette-nord-det-er-en-deltidskrise-i-norsk-helsevesen
- [NSF] NSF input to Helsepersonellkommisjonen on working time and full-time positions. https://nyvev.nsf.no/sites/default/files/2023-02/nsf_innspill_helsepersonellkommisjonen_arbeidstid_heltid.pdf
- [SFC24] Skills for Care, State of the adult social care sector and workforce in England 2024. https://rwkgoodman.com/wp-content/uploads/2024/10/The-state-of-the-adult-social-care-sector-and-workforce-in-England-2024-2.pdf (figures via search summary)
- [NHSE-ER] NHS England, E-rostering the clinical workforce. https://www.england.nhs.uk/wp-content/uploads/2020/09/e-rostering-guidance.pdf ; case study: https://www.england.nhs.uk/wp-content/uploads/2020/08/Improving_workforce_visibility_through_e-rostering.pdf
- [CMS25] CMS repeal of nursing home minimum staffing rule (3.48 HPRD, 24/7 RN), Dec 2025. https://leadingage.org/cms-repeals-nursing-home-minimum-staffing-standards/ (context only)

Practitioner
- [LAMN] LeadingAge Minnesota, peer mentors reduce turnover. https://www.leadingagemn.org/news/welcoming-new-staff-with-peer-mentors-can-reduce-turnover

**Source caveats.**
- Several Icelandic sources (Alþingi, Efling, SFV agreements) returned 403 or were only seen as search snippets; they are marked "via search snippet".
- The original 2015 Landlæknir benchmark document was not found, so its figures are quoted second-hand from FÍH and SLFÍ.
- US/UK/Norway evidence is transferable in direction, not in magnitude.
