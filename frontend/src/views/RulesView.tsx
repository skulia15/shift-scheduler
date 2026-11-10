import { useState } from 'react'
import { AGREEMENTS } from '../agreements'
import { NumberField, PageHead, RemoveButton, Section, Select, TextField } from '../components/fields'
import { RuleCard } from '../components/RuleCard'
import { blankRule, describeRule, isPersonRule, UNIT_RULE_TYPES } from '../rules'
import { useI18n } from '../i18n'
import { patchAt, removeAt } from '../lists'
import { newId } from '../store'
import type { Agreement, CustomRule, LaborRules, Project, Weights } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
  openPerson: (staffId: string) => void
}

type NumKey = { [K in keyof LaborRules]: LaborRules[K] extends number | null ? K : never }[keyof LaborRules]

interface Limit {
  key: NumKey
  label: string
  help: string
  unit: string
  step?: number
  /** Value to restore when "No limit" is unticked. */
  fallback?: number
}

const LIMIT_GROUPS: { name: string; fields: Limit[]; toggles?: ('days_off_consecutive' | 'days_off_hard' | 'lone_night_warning')[] }[] = [
  {
    name: 'Hours|group',
    fields: [
      { key: 'full_time_weekly_hours', label: 'Full-time week', help: 'Contract hours for 100% employment', unit: 'h / week', step: 0.5 },
      { key: 'max_avg_weekly_hours', label: 'Average week, including overtime', help: 'Across the whole period', unit: 'h / week', step: 0.5, fallback: 48 },
      { key: 'max_overtime_hours', label: 'Overtime cap', help: 'Hours above contract, per person, for the period', unit: 'h', fallback: 20 },
      { key: 'min_actual_weekly_hours', label: 'Lowest actual week after weighting', help: 'Weighting may not bring a full-timer below this, pro rata', unit: 'h / week', step: 0.5, fallback: 32 },
    ],
  },
  {
    name: 'Rest',
    fields: [
      { key: 'min_rest_hours', label: 'Daily rest target', help: 'Shorter rest is allowed but costs points', unit: 'h', step: 0.5 },
      { key: 'min_rest_hours_absolute', label: 'Daily rest minimum', help: 'Never shorter, even when changing shift type', unit: 'h', step: 0.5 },
      { key: 'max_short_rests_per_week', label: 'Short rests per week', help: 'Rests under the target allowed per Mon–Sun week', unit: 'per week', fallback: 1 },
      { key: 'weekly_rest_hours', label: 'Weekly rest', help: 'Continuous rest within every 7 days (statute)', unit: 'h', fallback: 35 },
    ],
  },
  {
    name: 'Shift length|group',
    fields: [
      { key: 'max_shift_hours', label: 'Longest shift', help: 'Never scheduled longer (13 h in 24 h)', unit: 'h', step: 0.5 },
      { key: 'normal_max_shift_hours', label: 'Normal longest shift', help: 'Longer shift types need a local agreement', unit: 'h', step: 0.5, fallback: 10 },
      { key: 'min_shift_hours', label: 'Shortest shift', help: 'Shift types shorter than this are flagged', unit: 'h', step: 0.5, fallback: 4 },
    ],
  },
  {
    name: 'Days off, nights and weekends',
    toggles: ['days_off_consecutive', 'days_off_hard', 'lone_night_warning'],
    fields: [
      { key: 'days_off_per_week', label: 'Days off per Mon–Sun week', help: 'Soft: "as a rule", together', unit: 'days|unit', fallback: 2 },
      { key: 'max_consecutive_days', label: 'Work days in a row', help: 'Optional local limit; weekly rest already caps it at 6', unit: 'days|unit', fallback: 6 },
      { key: 'max_consecutive_nights', label: 'Night shifts in a row', help: 'No union limit; local practice', unit: 'nights', fallback: 5 },
      { key: 'max_weekend_ratio', label: 'Weekends worked', help: 'Fairness target, not a union rule', unit: '% at most', fallback: 0.5 },
    ],
  },
]

const TOGGLE_LABEL = {
  days_off_consecutive: 'Days off should be together',
  days_off_hard: 'Days off are a hard rule (Reykjavík)',
  lone_night_warning: 'Warn on lone night shifts (safety assessment)',
}

const WEIGHT_FIELDS: { key: keyof Weights; label: string }[] = [
  { key: 'coverage_shortfall', label: 'Someone missing from a shift' },
  { key: 'change_day', label: 'Repair: changed shift, ≤ 1 day notice' },
  { key: 'change_week', label: 'Repair: changed shift, 2–7 days notice' },
  { key: 'change', label: 'Repair: changed shift, > 1 week notice' },
  { key: 'request_denied', label: 'Working a requested day off' },
  { key: 'short_rest_excess', label: 'Each short rest beyond the weekly allowance' },
  { key: 'days_off', label: 'A week without days off together' },
  { key: 'holiday_fairness', label: 'Holiday load across periods' },
  { key: 'short_rest', label: 'Rest below target' },
  { key: 'weekend_excess', label: 'Weekend above the share' },
  { key: 'overtime_hours', label: 'Each hour above contract' },
  { key: 'weekend_fairness', label: 'Weekend load across periods' },
  { key: 'overtime_spread', label: 'Each hour of the biggest overtime' },
  { key: 'under_hours', label: 'Each hour below contract' },
  { key: 'overstaff', label: 'Each extra person above minimum' },
  { key: 'preferred_shortfall', label: 'Each person below a preferred headcount' },
  { key: 'fallback_use', label: 'Each person on an only-when-short shift' },
  { key: 'change_detail', label: 'Repair: hallway or task changed' },
]

const AGREEMENT_FACTS: Record<Agreement, string[]> = {
  sfv: ['Days off "as a rule" together: soft, costs 20 points', 'Shifts over 10 h need a local agreement', 'No lone-night safety warning'],
  state: ['Days off "as a rule" together: soft', 'Shifts over 10 h need a local agreement', 'No lone-night safety warning'],
  municipal: ['Days off "as a rule" together: soft', 'Shifts up to 12 h are normal', 'Lone night shifts need a safety assessment'],
  reykjavik: ['Two days off together every week: hard', 'Shifts over 10 h need a local agreement', 'No lone-night safety warning'],
  custom: ['Your own settings below'],
}

export function RulesView({ project: p, setProject, openPerson }: Props) {
  const i = useI18n()
  const { t } = i
  const [newType, setNewType] = useState<CustomRule['type']>('avoid_task_repeat')
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  /** Any change to a default switches the agreement label to Custom. */
  const setRules = (patch: Partial<LaborRules>) => set({ rules: { ...p.rules, agreement: 'custom', ...patch } })
  const setRule = (idx: number, patch: Partial<CustomRule>) => set({ custom_rules: patchAt(p.custom_rules, idx, patch as CustomRule) })

  const wishPeople = p.staff
    .map((person) => ({ person, rules: p.custom_rules.filter((r) => isPersonRule(r) && r.staff_id === person.id) }))
    .filter((x) => x.rules.length)
  const maxWeight = Math.max(...WEIGHT_FIELDS.map((f) => p.weights[f.key]), 1)
  const strength = (v: number) =>
    `${v >= 100 ? t('Avoid at almost any cost') : v >= 30 ? t('Strongly avoid') : v >= 8 ? t('Avoid') : t('Mild preference')} · ${t('{n} pts', { n: v })}`
  const weights = [...WEIGHT_FIELDS].sort((a, b) => p.weights[b.key] - p.weights[a.key])

  return (
    <>
      <PageHead title={t('Rules')} sub={t('Changes take effect the next time you repair or regenerate the roster.')} />

      <Section title={t('Collective agreement')} hint={t('Sets the defaults below. Change any field and the agreement switches to Custom.')}>
        <div className="agreements" role="radiogroup" aria-label={t('Collective agreement')}>
          {AGREEMENTS.map((a) => (
            <button
              key={a.value}
              role="radio"
              aria-checked={p.rules.agreement === a.value}
              className={p.rules.agreement === a.value ? 'active' : ''}
              onClick={() => set({ rules: { ...p.rules, ...a.rules, agreement: a.value } })}
            >
              {t(a.label)}
            </button>
          ))}
        </div>
        <div>
          <b>{t('What this agreement sets')}</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {AGREEMENT_FACTS[p.rules.agreement].map((f) => (
              <li key={f}>{t(f)}</li>
            ))}
          </ul>
        </div>
        <div className="explain">
          <div>
            <span className="chip hard">{t('Hard')}</span>{' '}
            {t('Never broken by the solver. If hard rules can’t all be met, the roster shows the gaps, or asks you to unlock edits.')}
          </div>
          <div>
            <span className="chip soft">{t('Soft')}</span> {t('Avoided when possible. Each break costs its penalty points; the solver picks the roster with the fewest total points.')}
          </div>
        </div>
      </Section>

      <div className="cols">
        <div className="col-wide">
          <Section title={t('Working-time limits')}>
            {LIMIT_GROUPS.map((grp) => (
              <fieldset key={grp.name} className="limits">
                <legend>{t(grp.name)}</legend>
                {grp.fields.map((f) => {
                  // Weekends are stored as a share (0–1) and shown as a percentage.
                  const percent = f.key === 'max_weekend_ratio'
                  const raw = p.rules[f.key] as number | null
                  const value = percent && raw !== null ? Math.round(raw * 100) : raw
                  const help = f.key === 'days_off_per_week' && p.rules.days_off_hard ? 'Hard: never fewer, and together' : f.help
                  return (
                    <div key={f.key} className="limit">
                      <span className="label">{t(f.label)}</span>
                      <span className="help">{t(help)}</span>
                      <span className="row">
                        <NumberField
                          step={percent ? 5 : f.step}
                          width={92}
                          nullable={f.fallback !== undefined}
                          placeholder="—"
                          value={value}
                          onChange={(v) => setRules({ [f.key]: percent && v !== null ? v / 100 : v } as Partial<LaborRules>)}
                        />
                        {f.unit && <span className="unit">{t(f.unit)}</span>}
                        {f.fallback !== undefined && (
                          <label className="row small" style={{ marginLeft: 'auto' }}>
                            <input type="checkbox" checked={value === null} onChange={(e) => setRules({ [f.key]: e.target.checked ? null : f.fallback } as Partial<LaborRules>)} />
                            {t('No limit')}
                          </label>
                        )}
                      </span>
                    </div>
                  )
                })}
                {grp.toggles?.map((k) => (
                  <label key={k} className="row">
                    <input type="checkbox" checked={p.rules[k]} onChange={(e) => setRules({ [k]: e.target.checked })} />
                    {t(TOGGLE_LABEL[k])}
                  </label>
                ))}
              </fieldset>
            ))}
          </Section>

          <Section
            title={t('Hour weighting')}
            hint={t('Hours in these bands count for more towards the contract, so night and holiday staff work fewer real hours. Where bands overlap, the highest counts.')}
            action={
              <button className="btn" onClick={() => setRules({ weight_bands: [...p.rules.weight_bands, { name: t('Band'), days: 'all', start: '00:00', end: '08:00', weight: 1 }] })}>
                {t('Add band')}
              </button>
            }
          >
            <div className="table-scroll">
              <table className="form-table">
                <thead>
                  <tr>
                    <th>{t('Band')}</th>
                    <th>{t('Days')}</th>
                    <th>{t('From')}</th>
                    <th>{t('To')}</th>
                    <th>{t('Counts as')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.rules.weight_bands.map((b, idx) => {
                    const patch = (v: Partial<typeof b>) => setRules({ weight_bands: patchAt(p.rules.weight_bands, idx, v) })
                    return (
                      <tr key={idx}>
                        <td>
                          <TextField width={260} value={b.name} onChange={(name) => patch({ name })} />
                        </td>
                        <td>
                          <Select
                            value={b.days}
                            options={[
                              { value: 'weekday', label: t('Weekdays') },
                              { value: 'weekend_or_holiday', label: t('Weekends and holidays') },
                              { value: 'high_holiday', label: t('Aðfangadagur, gamlársdagur from 16:00') },
                              { value: 'all', label: t('Every day|band') },
                            ]}
                            onChange={(days) => patch({ days })}
                          />
                        </td>
                        <td>
                          <TextField width={80} value={b.start} onChange={(start) => patch({ start })} />
                        </td>
                        <td>
                          <TextField width={80} value={b.end} onChange={(end) => patch({ end })} />
                        </td>
                        <td>
                          <span className="row" style={{ flexWrap: 'nowrap' }}>
                            <NumberField width={80} value={Math.round(b.weight * 100)} onChange={(v) => patch({ weight: (v ?? 100) / 100 })} />
                            <span className="muted">%</span>
                          </span>
                        </td>
                        <td className="right">
                          <RemoveButton label={t('Remove band')} onClick={() => setRules({ weight_bands: removeAt(p.rules.weight_bands, idx) })} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <div className="col-narrow">
          <Section title={t('Penalty points')} hint={t('Points per occurrence, highest first. 500 against 60 means a missing person costs over 8 times a denied request.')}>
            {weights.map((f) => {
              const value = p.weights[f.key]
              const pct = Math.max(3, Math.round((Math.log(value + 1) / Math.log(maxWeight + 1)) * 100))
              return (
                <label key={f.key} className="weight-row">
                  <span>
                    {t(f.label)}
                    <span className="strength" style={{ display: 'block' }}>
                      {strength(value)}
                    </span>
                  </span>
                  <NumberField value={value} onChange={(v) => set({ weights: { ...p.weights, [f.key]: v ?? 0 } })} />
                  <span className="bar thick">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </label>
              )
            })}
          </Section>
        </div>
      </div>

      <Section
        title={t('Unit rules')}
        hint={t('Local practice on top of the working-time limits.')}
        action={
          <span className="row">
            <label className="field inline">
              <span className="sr-only">{t('Rule type to add')}</span>
              <Select value={newType} options={UNIT_RULE_TYPES.map((r) => ({ value: r.value, label: t(r.label) }))} onChange={setNewType} />
            </label>
            <button className="btn primary" onClick={() => set({ custom_rules: [...p.custom_rules, blankRule(newType, p, newId('rule', p.custom_rules))] })}>
              {t('Add rule')}
            </button>
          </span>
        }
      >
        <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
          {p.custom_rules.map((r, idx) =>
            isPersonRule(r) ? null : (
              <RuleCard key={r.id} rule={r} project={p} onChange={(patch) => setRule(idx, patch)} onRemove={() => set({ custom_rules: removeAt(p.custom_rules, idx) })} />
            ),
          )}
        </div>
      </Section>

      <Section
        title={t('Wishes and rules per person')}
        hint={t('Weekends, shift kinds, set weekdays, hallways and so on. Open a person to change theirs.')}
        count={wishPeople.length}
      >
        {wishPeople.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{t('No one has personal rules yet. Open a person under Setup, or import wishes from the Excel sheet.')}</p>
        ) : (
          <ul className="list person-rules">
            {wishPeople.map(({ person, rules }) => (
              <li key={person.id}>
                <button type="button" className="link" onClick={() => openPerson(person.id)}>
                  {person.name}
                </button>
                <span className="row" style={{ gap: 4, flex: '1 1 300px' }}>
                  {rules.map((r) => (
                    <span key={r.id} className={`chip ${r.hard ? 'hard' : ''} ${r.enabled ? '' : 'off'}`}>
                      {describeRule(i, p, r)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
