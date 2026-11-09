# Rule spec: Icelandic care-home rostering

Combines the research in `docs/research/` into the rules Vaktaplan should enforce, and compares each
one with what the app does today. Clause references and URLs are in the research files:

- `research/sfv-kjarasamningar.md` — SFV homes (Efling, Sameyki, SLFÍ, FÍH), most private/non-profit homes
- `research/public-kjarasamningar-2024.md` — state (ríkið), municipalities (SNS) and Reykjavík, 2024–2028
- `research/care-home-scheduling.md` — common problems, practices and Icelandic staffing context
- `research/mtp-capabilities.md` — what MyTimePlan already does
- `research/icelandic-rules.md` — first pass; superseded where the files above correct it

Since 1.11.2024 the betri-vinnutími rules sit in the main agreement text (state/SNS gr. 2.6.x,
FÍH-RVK gr. 2.5.x, SFV equivalents), not in the old 2020 Fylgiskjal.

## 1. Working-time rules (agreements + lög 46/1980)

Status: ✅ enforced correctly · ⚠️ enforced but default or strength is wrong · ❌ missing · ℹ️ informational only

| # | Rule | Value (all agreements unless noted) | Hard? | App today | Action |
|---|---|---|---|---|---|
| W1 | Full-time hours, shift workers | 36 virkar vinnustundir / week | contract | ✅ `full_time_weekly_hours` 36 | — |
| W2 | Weighting (vægi) | 1.05 on 33.33%/55% álag hours (weekday 17–24, weekend/holiday 08–24); 1.2 on 65%/75% (00–08 daily); 120% hours 1.05 day / 1.2 night; 165% hours 1.2 | contract | ✅ bands 1.05/1.2 + 165% band; holidays start at a set time (eves 12:00) | — |
| W3 | 32 h floor | Weighting can't take actual hours below 32 h/week × FTE (pay-period average) | hard | ✅ credit ≤ worked × 36/32 | Confirm reading with holiday reduction (see Q1) |
| W4 | Weighting only on rostered shifts | Extra shifts (aukavaktir) get no vægi | contract | ℹ️ app only plans rostered shifts | — |
| W5 | Holiday duty reduction | −7.2 h × FTE per sérstakur frídagur on Mon–Fri; −3.6 h for aðfangadagur and gamlársdagur; applies worked or not | contract | ✅ "Fill Icelandic holidays" generates all 17 for any period (Easter-based dates, eves from 12:00) | — |
| W6 | Daily rest | 11 h | hard (statute) | ✅ soft target 11 h | — |
| W7 | Reduced rest | ≥ 8 h, only at a planned change of shift type, normally at most once a week; never overtime→shift | hard floor 8 h | ✅ 8 h floor hard, 8–11 h penalised, max 1 per week (soft, weight 60) | Same-type shifts can't produce < 11 h with shifts ≤ 13 h, so the shift-change condition holds by construction |
| W8 | Max per 24 h | 13 h scheduled (16 h emergencies only) | hard | ✅ `max_shift_hours` 13 | Check per 24 h window, not per shift |
| W9 | Shift length | Normally 4–10 h (SFV, state, RVK); 4–12 h (SGS↔SNS); other lengths need local agreement | deviable | ✅ warnings below 4 h / above normal max (10 h, SNS 12 h) | — |
| W10 | Weekly rest | 35 h continuous per 7 days, or 2 days per 14 (statute) | hard | ✅ every 7-day window holds a day off with ≥ 35 h rest around it (hard) | 2-days-per-14 deferral not modelled |
| W11 | Two days off | "að jafnaði" 2 consecutive days off per week (SFV, state, SNS: soft). RVK: strict, split only as 2 × 36 h, moving needs union consent | soft (RVK: hard) | ✅ 2 consecutive days per Mon–Sun week, soft (weight 20); hard in the Reykjavík profile | 2 × 36 h split not modelled |
| W12 | 48 h average | Incl. overtime, 6-month reference period (Jan–Jun, Jul–Dec) | hard | ✅ over the plan period (stricter) | Optional: carry hours from earlier periods |
| W13 | Night worker | ≥ 3 h of 23:00–06:00 or ≥ 40% of annual work at night; avg 8 h / 24 h | hard | ❌ | Flag night workers; check the 8 h average |
| W14 | Night opt-out by age | 55+ (SFV, state, RVK), 50+ (SNS: SGS, SAL); FÍH-SFV 2024: nights only, not on-call | employee's choice | ⚠️ via "May work" shift ticks | Add birth year + "opted out of nights"; warn |
| W15 | Consecutive nights | No limit in any text | — | ✅ default off | — |
| W16 | Weekend frequency | No numeric rule; holiday work "spread as evenly as possible" | soft | ✅ 50% soft default | Add holiday-fairness across periods (F3) |
| W17 | Stórhátíðardagar | 8 days (SFV, state, FÍH-RVK; 1. maí only for SFV staff hired before 2000); 9 incl. 1. maí (SNS) | pay | ✅ marked per agreement (8, or 9 with 1. maí for SNS); 1. maí for pre-2000 SFV hires not modelled | Use in a pay export |
| W18 | Roster notice | Draft 6 weeks ahead, final 1 month ahead | hard | ❌ | Publishing lifecycle (F6) |
| W19 | Changes after publishing | Employee's consent; breytingargjald 2% of monthly salary (< 24 h notice), 1.3% (24–168 h) | hard (consent) | ❌ | Change log + fee estimate per change |
| W20 | Short-notice extra shift | 1.3% fee per 8 h shift taken on < 24 h notice in evening/night/weekend bands | pay | ❌ | Same change log |
| W21 | Vaktahvati (shift incentive) | Rolling 3 pay periods: ≥ 126 h outside dagvinna, ≥ 45 h in each of 2–4 shift types, ≥ 14 attendances on average → 2.5–12.5% of salary; aukavaktir don't count | pay | ❌ | Show who qualifies; optional soft goal "keep qualifiers qualified" |
| W22 | Shift worker | ≥ 20% of scheduled time outside dagvinna (weekday 08–17) | contract | ❌ | Show per person; warn if a contracted shift worker drops below |
| W23 | Meals | Eating on shift counts as working time since 1.11.2024; old 25-min payment gone | contract | ✅ breaks default 0 | — |
| W24 | Part-time extra hours | Overtime unless regular for ≥ 1 month (then paid as salary share); Efling: shifts < 8 h must be in the contract; ≥ 80% staff get priority for 8 h shifts | contract | ❌ | Warn on short shifts for ≥ 80% Efling staff |
| W25 | Overtime | Y2 above 38.92 h/week; nurses can take 1.62 h off per overtime hour | pay | ℹ️ overtime = credited hours above target | Show hours above 38.92 h/week |
| W26 | Lone night shift | SNS: safety assessment required | info | ✅ warning when enabled (SNS profile) | — |
| W27 | Working-time record | Employer keeps rest, weekly day off and deviations (L. 58/2023, 57. gr. a) | legal | ❌ | Export of rest and deviation log per person |

### Agreement profiles

One unit may hold several unions (nurses FÍH, floor staff Efling/SLFÍ), but working-time rules
match within an employer type. Differences apply per profile:

| Setting | SFV | State (ríkið) | Municipal (SNS) | Reykjavík |
|---|---|---|---|---|
| Two days off (W11) | soft | soft | soft | hard, 2 × 36 h split |
| Normal max shift (W9) | 10 h | 10 h | 12 h (SGS) | 10 h |
| Night opt-out age (W14) | 55 | 55 | 50 | 55 |
| Stórhátíðardagar (W17) | 8 (+1. maí for pre-2000 hires) | 8 | 9 | 8 |
| Lone-night safety check (W26) | — | — | yes | — |

Proposal: a "Kjarasamningur" select on the Rules tab that sets these, with every value still editable.

## 2. Practice features (care-home research)

| # | Feature | Why (evidence) | App today |
|---|---|---|---|
| F1 | Competence tags across groups (nurse, medication-competent, Icelandic speaker, can lead a shift) with per-shift/area minimums | Skill mix is Iceland's main gap: audits found 12–15% nurses vs. 20% floor / 27% target (Landlæknir 2015) | ✅ competences per person, per-shift/area minimums, tasks that require a competence |
| F2 | Sick-call re-plan: minimal-change re-solve + ranked replacement list with change fee | ~1 in 3 shifts differs from the posted roster; filling holes is improvised | ❌ |
| F3 | Fairness ledger across periods (weekends, nights, Christmas/New Year, short-notice changes, denied wishes) | Holiday work must be spread evenly; fairness is judged over the year, not 4 weeks | ❌ per period only |
| F4 | Stable coworkers / continuity: home area weighted toward part-timers, penalty for changing teams, continuity KPI | Coworker churn raises turnover; part-timer home-unit priority cut aides per resident 20–30% | ⚠️ fixed-area rule |
| F5 | Demand from care weight (care hours per resident) + benchmark panel (nurse %, skilled %, care hours) | interRAI care weights drive funding; ministry plans new care-weight benchmarks by 2027 | ❌ |
| F6 | Publishing lifecycle: draft (6 weeks) → final (1 month) → change log | Agreement requirement (W18–W20) | ❌ |
| F7 | Bank/on-call staff type and reserve shifts sized to the absence rate; agency as costed last resort | Absence is predictable in aggregate | ❌ |
| F8 | Wish window with points; swaps checked against rules before approval | Pure self-rostering is less fair and drives overtime; wishes then optimiser works | ⚠️ day-off requests (MTP owns wishes/swaps) |
| F9 | Buddy rule: new staff/students paired with experienced; students don't count toward minimums | Safety and onboarding | ❌ |
| F10 | Prior-period carry-over: last days of the previous roster for rest, consecutive days and nights | Boundary violations are invisible today | ❌ |

## 3. Suggested build order

1. ~~**Correct the defaults**~~ (done): W11 soft + consecutive, W10 35 h weekly rest, W7 weekly cap on
   8 h rests, W9 normal shift length, W2 165% band, agreement profiles.
2. ~~**Holiday calendar** (W5/W17)~~ (done): generate Icelandic holidays for any period; duty reduction applied automatically.
3. ~~**Competence tags** (F1)~~ (done) — highest care-quality impact.
4. **Prior-period carry-over** (F10) and **fairness ledger** (F3) — both need history, so build them together.
5. **Publishing + change log + sick-call re-plan** (F6, W19, F2).
6. **Vaktahvati and shift-worker indicators** (W21, W22) — pay-relevant, visible to staff.
7. Care-weight demand and benchmark panel (F5).

MTP already covers wishes, swaps, time tracking and pay. Vaktaplan should not duplicate those; it
needs an MTP import/export once MyTimePlan confirms a format.

## Open questions

- **Q1 — 32 h floor with holiday reduction.** Read literally, the floor (32 h × weeks) would cancel most of the
  Christmas reduction. The app uses: actual hours ≥ credited target × 32/36 (Christmas example: 108.8 h).
  The other reading is 32 h × weeks minus the reduction × 32/36 (106.4 h). Which does the payroll office use?
- **Q2 — SFV gaps.** Efling–SFV 2024 pages after 7 and SLFÍ–SFV 2024 couldn't be read; the Oct–Nov 2025
  Efling mediator proposal may change things. A union rep or the homes' HR can confirm.
- **Q3 — Per-person agreement.** Do mixed-union units need per-person profiles, or is one profile per unit enough?
