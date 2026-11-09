import { Checks, NumberField, PageHead, RemoveButton, Section, Select, TextField } from '../components/fields'
import { patchAt, removeAt } from '../lists'
import { AGREEMENTS } from '../agreements'
import { newId } from '../store'
import type { CustomRule, LaborRules, Project, Weights } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

const LABOR_FIELDS: { key: keyof LaborRules; label: string; unit: string; nullable?: boolean; step?: number }[] = [
  { key: 'full_time_weekly_hours', label: 'Full-time hours / week', unit: 'h', step: 0.5 },
  { key: 'min_actual_weekly_hours', label: 'Weighting may not bring actual hours below', unit: 'h / week', nullable: true, step: 0.5 },
  { key: 'min_rest_hours', label: 'Daily rest', unit: 'h', step: 0.5 },
  { key: 'min_rest_hours_absolute', label: 'Shortest rest at a shift change', unit: 'h', step: 0.5 },
  { key: 'max_short_rests_per_week', label: 'Short rests per week', unit: 'per week', nullable: true },
  { key: 'weekly_rest_hours', label: 'Continuous weekly rest', unit: 'h / 7 days', nullable: true },
  { key: 'days_off_per_week', label: 'Days off per Mon–Sun week', unit: 'days', nullable: true },
  { key: 'max_shift_hours', label: 'Max work per shift (24 h)', unit: 'h', step: 0.5 },
  { key: 'normal_max_shift_hours', label: 'Normal max shift length', unit: 'h', nullable: true, step: 0.5 },
  { key: 'min_shift_hours', label: 'Min shift length', unit: 'h', nullable: true, step: 0.5 },
  { key: 'max_avg_weekly_hours', label: 'Max average hours / week', unit: 'h', nullable: true },
  { key: 'max_overtime_hours', label: 'Overtime cap for the period', unit: 'h', nullable: true },
  { key: 'max_consecutive_days', label: 'Max consecutive work days', unit: 'days', nullable: true },
  { key: 'max_consecutive_nights', label: 'Max consecutive night shifts', unit: 'nights', nullable: true },
  { key: 'max_weekend_ratio', label: 'Max share of weekends worked', unit: '0–1', nullable: true, step: 0.05 },
]

const LABOR_TOGGLES: { key: 'days_off_consecutive' | 'days_off_hard' | 'lone_night_warning'; label: string }[] = [
  { key: 'days_off_consecutive', label: 'Days off should be consecutive' },
  { key: 'days_off_hard', label: 'Days off are a hard rule (Reykjavík)' },
  { key: 'lone_night_warning', label: 'Warn on lone night shifts (SNS safety assessment)' },
]

const WEIGHT_FIELDS: { key: keyof Weights; label: string }[] = [
  { key: 'coverage_shortfall', label: 'Missing person on a shift' },
  { key: 'request_denied', label: 'Working a requested day off' },
  { key: 'short_rest', label: 'Rest below target' },
  { key: 'short_rest_excess', label: 'Short rest beyond the weekly allowance' },
  { key: 'days_off', label: 'Week without the expected days off' },
  { key: 'overtime_hours', label: 'Each hour above contract' },
  { key: 'overtime_spread', label: 'Largest individual overtime' },
  { key: 'under_hours', label: 'Each hour below contract' },
  { key: 'weekend_excess', label: 'Each weekend above the share' },
  { key: 'weekend_fairness', label: 'Weekend load across periods' },
  { key: 'change', label: 'Repair: changed shift, > 1 week notice' },
  { key: 'change_week', label: 'Repair: changed shift, 2–7 days notice' },
  { key: 'change_day', label: 'Repair: changed shift, ≤ 1 day notice' },
  { key: 'holiday_fairness', label: 'Holiday load across periods' },
  { key: 'overstaff', label: 'Each person above minimum' },
]

const RULE_TYPES: { value: CustomRule['type']; label: string }[] = [
  { value: 'avoid_task_repeat', label: 'Avoid task repeat' },
  { value: 'rotate_task_evenly', label: 'Rotate evenly' },
  { value: 'max_shift_type', label: 'Limit shift type' },
  { value: 'forbid_sequence', label: 'Forbid sequence' },
  { value: 'fixed_area', label: 'Fixed area' },
  { value: 'diverse_shifts', label: 'Varied shift mix' },
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
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const setRules = (patch: Partial<LaborRules>) => set({ rules: { ...p.rules, ...patch } })
  const setRule = (i: number, patch: Partial<CustomRule>) => set({ custom_rules: patchAt(p.custom_rules, i, patch as CustomRule) })

  const groups = p.groups.map((g) => ({ value: g.id, label: g.name }))
  const tasks = p.tasks.map((t) => ({ value: t.id, label: t.name }))
  const shifts = p.shift_types.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))
  const shiftCodes = p.shift_types.map((s) => ({ value: s.id, label: s.code }))
  const people = p.staff.map((s) => ({ value: s.id, label: s.name }))
  const areas = p.areas.map((a) => ({ value: a.id, label: a.name }))
  const maxWeight = Math.max(...WEIGHT_FIELDS.map((f) => p.weights[f.key]), 1)

  return (
    <>
      <PageHead eyebrow="Rules" title="What the roster must respect" />

      <div className="cols">
        <div className="col-wide">
          <Section
            title="Labour rules"
            hint="Defaults from the Icelandic collective agreements (docs/RULE-SPEC.md). Leave a field empty to switch the limit off."
            action={
              <label className="field inline">
                <span className="muted">Kjarasamningur</span>
                <Select
                  value={p.rules.agreement}
                  options={AGREEMENTS.map((a) => ({ value: a.value, label: a.label }))}
                  onChange={(agreement) => setRules({ agreement, ...AGREEMENTS.find((a) => a.value === agreement)?.rules })}
                />
              </label>
            }
          >
            <div className="labor-grid">
              {LABOR_FIELDS.map((f) => (
                <label key={f.key} className="tile">
                  {f.label}
                  <span className="row">
                    <NumberField
                      nullable={f.nullable}
                      step={f.step}
                      width={96}
                      value={p.rules[f.key] as number | null}
                      onChange={(v) => setRules({ [f.key]: v } as Partial<LaborRules>)}
                    />
                    <span className="unit">{f.unit}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="row" style={{ gap: 20 }}>
              {LABOR_TOGGLES.map((f) => (
                <label key={f.key} className="row">
                  <input type="checkbox" checked={p.rules[f.key]} onChange={(e) => setRules({ [f.key]: e.target.checked })} />
                  {f.label}
                </label>
              ))}
            </div>
          </Section>

          <Section
            title="Hour weighting (vægi)"
            hint="Worked minutes inside a band count × weight towards contract hours. Public holidays count as weekend days."
            action={
              <button
                className="btn add"
                onClick={() => setRules({ weight_bands: [...p.rules.weight_bands, { name: 'Band', days: 'all', start: '00:00', end: '08:00', weight: 1 }] })}
              >
                + Band
              </button>
            }
          >
            <div className="table-scroll">
              <table className="form-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Days</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Weight</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.rules.weight_bands.map((b, i) => {
                    const patch = (v: Partial<typeof b>) => setRules({ weight_bands: patchAt(p.rules.weight_bands, i, v) })
                    return (
                      <tr key={i}>
                        <td>
                          <TextField value={b.name} onChange={(name) => patch({ name })} />
                        </td>
                        <td>
                          <Select
                            value={b.days}
                            options={[
                              { value: 'weekday', label: 'Weekdays' },
                              { value: 'weekend_or_holiday', label: 'Weekends & holidays' },
                              { value: 'high_holiday', label: '165% hours (Christmas / New Year eves)' },
                              { value: 'all', label: 'Every day' },
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
                          <NumberField step={0.01} value={b.weight} onChange={(v) => patch({ weight: v ?? 1 })} />
                        </td>
                        <td className="right">
                          <RemoveButton label="Remove band" onClick={() => setRules({ weight_bands: removeAt(p.rules.weight_bands, i) })} />
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
          <Section title="Penalty weights" hint="How much the solver avoids each soft cost.">
            {WEIGHT_FIELDS.map((f) => {
              const value = p.weights[f.key]
              const pct = Math.max(3, Math.round((Math.log(value + 1) / Math.log(maxWeight + 1)) * 100))
              return (
                <label key={f.key} className="weight-row">
                  <span className="top">
                    <span>{f.label}</span>
                    <NumberField value={value} onChange={(v) => set({ weights: { ...p.weights, [f.key]: v ?? 0 } })} />
                  </span>
                  <span className={`bar thick ${value >= 60 ? '' : 'lime'}`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </label>
              )
            })}
          </Section>
        </div>
      </div>

      <Section
        title="Custom rules"
        hint="Unit-specific practice on top of the labour rules. Hard rules are never broken; soft rules are weighed against other goals."
        action={
          <div className="add-menu">
            {RULE_TYPES.map((t) => (
              <button
                key={t.value}
                className="btn add"
                onClick={() => set({ custom_rules: [...p.custom_rules, blankRule(t.value, p, newId('rule', p.custom_rules))] })}
              >
                + {t.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {p.custom_rules.map((r, i) => (
            <article key={r.id} className={`rule-card ${r.enabled ? '' : 'disabled'}`}>
              <div className="row">
                <span className="chip soft">{RULE_TYPES.find((t) => t.value === r.type)?.label}</span>
                <span className="spacer" />
                <button type="button" className={r.hard ? 'chip hard' : 'chip granted'} style={{ border: 0, cursor: 'pointer' }} onClick={() => setRule(i, { hard: !r.hard })}>
                  {r.hard ? 'Hard' : `Soft · ${r.weight}`}
                </button>
                <RemoveButton label="Remove rule" onClick={() => set({ custom_rules: removeAt(p.custom_rules, i) })} />
              </div>
              <input className="desc" placeholder="Describe the rule…" value={r.description} onChange={(e) => setRule(i, { description: e.target.value })} />
              <div className="params">
                {r.type === 'forbid_sequence' && (
                  <>
                    <Select value={r.group_id ?? ''} options={[{ value: '', label: 'Everyone' }, ...groups]} onChange={(v) => setRule(i, { group_id: v || null })} />
                    <Select value={r.from_shift_id} options={shifts} onChange={(from_shift_id) => setRule(i, { from_shift_id })} />
                    never followed next day by
                    <Select value={r.to_shift_id} options={shifts} onChange={(to_shift_id) => setRule(i, { to_shift_id })} />
                  </>
                )}
                {r.type === 'fixed_area' && (
                  <>
                    <Select value={r.staff_id} options={people} onChange={(staff_id) => setRule(i, { staff_id })} /> always in
                    <Select value={r.area_id} options={areas} onChange={(area_id) => setRule(i, { area_id })} />
                  </>
                )}
                {r.type === 'diverse_shifts' && (
                  <>
                    <Select value={r.staff_id} options={people} onChange={(staff_id) => setRule(i, { staff_id })} /> balanced across
                    <Checks values={r.shift_ids ?? []} options={shiftCodes} onChange={(ids) => setRule(i, { shift_ids: ids.length ? ids : null })} />
                    <span className="muted">(none = all they may work)</span>
                  </>
                )}
                {(r.type === 'avoid_task_repeat' || r.type === 'rotate_task_evenly' || r.type === 'max_shift_type') && (
                  <Select value={r.group_id} options={groups} onChange={(group_id) => setRule(i, { group_id })} />
                )}
                {r.type === 'avoid_task_repeat' && (
                  <>
                    <Select value={r.task_id} options={tasks} onChange={(task_id) => setRule(i, { task_id })} /> max
                    <NumberField width={60} value={r.max_count} onChange={(v) => setRule(i, { max_count: v ?? 1 })} /> in
                    <NumberField width={60} value={r.window_days} onChange={(v) => setRule(i, { window_days: v ?? 1 })} /> days
                  </>
                )}
                {r.type === 'rotate_task_evenly' && (
                  <>
                    <Select value={r.task_id} options={tasks} onChange={(task_id) => setRule(i, { task_id })} />
                    <label className="row">
                      <input type="checkbox" checked={r.proportional_to_employment} onChange={(e) => setRule(i, { proportional_to_employment: e.target.checked })} />
                      by employment %
                    </label>
                  </>
                )}
                {r.type === 'max_shift_type' && (
                  <>
                    <Select value={r.shift_id} options={shifts} onChange={(shift_id) => setRule(i, { shift_id })} /> max
                    <NumberField width={60} value={r.max_count} onChange={(v) => setRule(i, { max_count: v ?? 0 })} /> per period
                  </>
                )}
              </div>
              <div className="foot">
                <label className="row">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => setRule(i, { enabled: e.target.checked })} />
                  Enabled
                </label>
                {!r.hard && (
                  <label className="row">
                    <span className="muted">Weight</span>
                    <NumberField width={70} value={r.weight} onChange={(v) => setRule(i, { weight: v ?? 1 })} />
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
