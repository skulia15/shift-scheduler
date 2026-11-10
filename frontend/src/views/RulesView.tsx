import { useState } from 'react'
import { AGREEMENTS } from '../agreements'
import { Checks, NumberField, PageHead, RemoveButton, Section, Select, TextField } from '../components/fields'
import { useI18n } from '../i18n'
import { patchAt, removeAt } from '../lists'
import { newId } from '../store'
import type { Agreement, CustomRule, LaborRules, Project, Weights } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
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
  { key: 'change_detail', label: 'Repair: hallway or task changed' },
]

const AGREEMENT_FACTS: Record<Agreement, string[]> = {
  sfv: ['Days off "as a rule" together: soft, costs 20 points', 'Shifts over 10 h need a local agreement', 'No lone-night safety warning'],
  state: ['Days off "as a rule" together: soft', 'Shifts over 10 h need a local agreement', 'No lone-night safety warning'],
  municipal: ['Days off "as a rule" together: soft', 'Shifts up to 12 h are normal', 'Lone night shifts need a safety assessment'],
  reykjavik: ['Two days off together every week: hard', 'Shifts over 10 h need a local agreement', 'No lone-night safety warning'],
  custom: ['Your own settings below'],
}

const RULE_TYPES: { value: CustomRule['type']; label: string }[] = [
  { value: 'avoid_task_repeat', label: 'Don’t repeat a task too often' },
  { value: 'rotate_task_evenly', label: 'Rotate a task evenly' },
  { value: 'max_shift_type', label: 'Limit a shift type per person' },
  { value: 'forbid_sequence', label: 'Forbid shift A followed by B' },
  { value: 'fixed_area', label: 'Keep a person in one area' },
  { value: 'diverse_shifts', label: 'Give a person a varied shift mix' },
]

function blankRule(type: CustomRule['type'], p: Project, id: string): CustomRule {
  const base = { id, enabled: true, hard: false, weight: 10, description: '' }
  const group_id = p.groups[0]?.id ?? ''
  const task_id = p.tasks[0]?.id ?? ''
  const shift_id = p.shift_types[0]?.id ?? ''
  switch (type) {
    case 'avoid_task_repeat':
      return { ...base, type, group_id, task_id, max_count: 1, window_days: 3 }
    case 'rotate_task_evenly':
      return { ...base, type, group_id, task_id, proportional_to_employment: true }
    case 'max_shift_type':
      return { ...base, type, group_id, shift_id, max_count: 8 }
    case 'forbid_sequence':
      return { ...base, type, group_id: null, from_shift_id: shift_id, to_shift_id: shift_id }
    case 'fixed_area':
      return { ...base, type, hard: true, staff_id: p.staff[0]?.id ?? '', area_id: p.areas[0]?.id ?? '' }
    case 'diverse_shifts':
      return { ...base, type, staff_id: p.staff[0]?.id ?? '', shift_ids: null }
  }
}

export function RulesView({ project: p, setProject }: Props) {
  const i = useI18n()
  const { t } = i
  const [newType, setNewType] = useState<CustomRule['type']>('avoid_task_repeat')
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  /** Any change to a default switches the agreement label to Custom. */
  const setRules = (patch: Partial<LaborRules>) => set({ rules: { ...p.rules, agreement: 'custom', ...patch } })
  const setRule = (idx: number, patch: Partial<CustomRule>) => set({ custom_rules: patchAt(p.custom_rules, idx, patch as CustomRule) })

  const groups = p.groups.map((g) => ({ value: g.id, label: g.name }))
  const tasks = p.tasks.map((x) => ({ value: x.id, label: x.name }))
  const shifts = p.shift_types.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))
  const shiftCodes = p.shift_types.map((s) => ({ value: s.id, label: s.code }))
  const people = p.staff.map((s) => ({ value: s.id, label: s.name }))
  const areas = p.areas.map((a) => ({ value: a.id, label: a.name }))
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
              <Select value={newType} options={RULE_TYPES.map((r) => ({ value: r.value, label: t(r.label) }))} onChange={setNewType} />
            </label>
            <button className="btn primary" onClick={() => set({ custom_rules: [...p.custom_rules, blankRule(newType, p, newId('rule', p.custom_rules))] })}>
              {t('Add rule')}
            </button>
          </span>
        }
      >
        <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
          {p.custom_rules.map((r, idx) => (
            <article key={r.id} className={`rule-card ${r.enabled ? '' : 'disabled'}`}>
              <div className="row">
                <span className="chip">{t(RULE_TYPES.find((x) => x.value === r.type)?.label ?? r.type)}</span>
                <span className="spacer" />
                <label className="row small">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => setRule(idx, { enabled: e.target.checked })} />
                  {t('On')}
                </label>
                <RemoveButton label={t('Remove rule')} onClick={() => set({ custom_rules: removeAt(p.custom_rules, idx) })} />
              </div>
              <input className="desc" placeholder={t('Describe the rule…')} aria-label={t('Description')} value={r.description} onChange={(e) => setRule(idx, { description: e.target.value })} />
              <div className="params">
                {r.type === 'forbid_sequence' && (
                  <>
                    <Select value={r.group_id ?? ''} options={[{ value: '', label: t('Everyone') }, ...groups]} onChange={(v) => setRule(idx, { group_id: v || null })} />
                    <Select value={r.from_shift_id} options={shifts} onChange={(from_shift_id) => setRule(idx, { from_shift_id })} />
                    {t('never followed next day by')}
                    <Select value={r.to_shift_id} options={shifts} onChange={(to_shift_id) => setRule(idx, { to_shift_id })} />
                  </>
                )}
                {r.type === 'fixed_area' && (
                  <>
                    <Select value={r.staff_id} options={people} onChange={(staff_id) => setRule(idx, { staff_id })} /> {t('always in')}
                    <Select value={r.area_id} options={areas} onChange={(area_id) => setRule(idx, { area_id })} />
                  </>
                )}
                {r.type === 'diverse_shifts' && (
                  <>
                    <Select value={r.staff_id} options={people} onChange={(staff_id) => setRule(idx, { staff_id })} /> {t('balanced across')}
                    <Checks values={r.shift_ids ?? []} options={shiftCodes} onChange={(ids) => setRule(idx, { shift_ids: ids.length ? ids : null })} />
                    <span className="muted">{t('(none = all they may work)')}</span>
                  </>
                )}
                {(r.type === 'avoid_task_repeat' || r.type === 'rotate_task_evenly' || r.type === 'max_shift_type') && (
                  <Select value={r.group_id} options={groups} onChange={(group_id) => setRule(idx, { group_id })} />
                )}
                {r.type === 'avoid_task_repeat' && (
                  <>
                    <Select value={r.task_id} options={tasks} onChange={(task_id) => setRule(idx, { task_id })} /> {t('at most')}
                    <NumberField width={60} value={r.max_count} onChange={(v) => setRule(idx, { max_count: v ?? 1 })} /> {t('times in')}
                    <NumberField width={60} value={r.window_days} onChange={(v) => setRule(idx, { window_days: v ?? 1 })} /> {t('days')}
                  </>
                )}
                {r.type === 'rotate_task_evenly' && (
                  <>
                    <Select value={r.task_id} options={tasks} onChange={(task_id) => setRule(idx, { task_id })} />
                    <label className="row">
                      <input type="checkbox" checked={r.proportional_to_employment} onChange={(e) => setRule(idx, { proportional_to_employment: e.target.checked })} />
                      {t('by employment %')}
                    </label>
                  </>
                )}
                {r.type === 'max_shift_type' && (
                  <>
                    <Select value={r.shift_id} options={shifts} onChange={(shift_id) => setRule(idx, { shift_id })} /> {t('at most')}
                    <NumberField width={60} value={r.max_count} onChange={(v) => setRule(idx, { max_count: v ?? 0 })} /> {t('per period')}
                  </>
                )}
              </div>
              <div className="foot">
                <div className="segmented" role="radiogroup" aria-label={t('Hard or soft')}>
                  <button role="radio" aria-checked={r.hard} onClick={() => setRule(idx, { hard: true })}>
                    {t('Hard')}
                  </button>
                  <button role="radio" aria-checked={!r.hard} onClick={() => setRule(idx, { hard: false })}>
                    {t('Soft')}
                  </button>
                </div>
                {!r.hard && (
                  <label className="row">
                    <NumberField width={70} value={r.weight} onChange={(v) => setRule(idx, { weight: v ?? 1 })} />
                    <span className="muted">{t('points')}</span>
                  </label>
                )}
              </div>
            </article>
          ))}
        </div>
      </Section>
    </>
  )
}
