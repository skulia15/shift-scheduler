import { Checks, NumberField, Section, Select, TextField } from '../components/fields'
import { patchAt, removeAt } from '../lists'
import { newId } from '../store'
import type { CustomRule, LaborRules, Project, Weights } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

const LABOR_FIELDS: { key: keyof LaborRules; label: string; nullable?: boolean; step?: number }[] = [
  { key: 'full_time_weekly_hours', label: 'Full-time hours / week', step: 0.5 },
  { key: 'min_actual_weekly_hours', label: 'Weighting may not bring actual hours below (h/week, full-time)', nullable: true, step: 0.5 },
  { key: 'min_rest_hours', label: 'Daily rest target (h) — shorter is penalised', step: 0.5 },
  { key: 'min_rest_hours_absolute', label: 'Daily rest absolute minimum (h)', step: 0.5 },
  { key: 'max_shift_hours', label: 'Max shift length (h)', step: 0.5 },
  { key: 'max_consecutive_days', label: 'Max consecutive work days', nullable: true },
  { key: 'min_days_off_per_week', label: 'Min days off per Mon–Sun week', nullable: true },
  { key: 'max_avg_weekly_hours', label: 'Max average hours / week (incl. overtime)', nullable: true },
  { key: 'max_overtime_hours', label: 'Overtime cap for the period (h)', nullable: true },
  { key: 'max_consecutive_nights', label: 'Max consecutive night shifts', nullable: true },
  { key: 'max_weekend_ratio', label: 'Max share of weekends worked (soft, 0–1)', nullable: true, step: 0.05 },
]

const WEIGHT_FIELDS: { key: keyof Weights; label: string }[] = [
  { key: 'coverage_shortfall', label: 'Missing person on a shift (only when demand cannot be met)' },
  { key: 'request_denied', label: 'Working on a requested day off' },
  { key: 'short_rest', label: 'Rest below target (per occurrence)' },
  { key: 'overtime_hours', label: 'Each hour above contract' },
  { key: 'overtime_spread', label: 'Each hour of the largest individual overtime (fairness)' },
  { key: 'under_hours', label: 'Each hour below contract' },
  { key: 'weekend_excess', label: 'Each weekend above the share' },
  { key: 'overstaff', label: 'Each person above minimum staffing' },
]

const RULE_TYPES: { value: CustomRule['type']; label: string }[] = [
  { value: 'avoid_task_repeat', label: "Don't repeat a task too often" },
  { value: 'rotate_task_evenly', label: 'Rotate a task evenly' },
  { value: 'max_shift_type', label: 'Limit a shift type per person' },
  { value: 'forbid_sequence', label: 'Forbid shift A followed by shift B' },
  { value: 'fixed_area', label: 'Person always in one area' },
  { value: 'diverse_shifts', label: 'Person wants a varied shift mix' },
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
  const people = p.staff.map((s) => ({ value: s.id, label: s.name }))
  const areas = p.areas.map((a) => ({ value: a.id, label: a.name }))

  return (
    <div className="stack">
      <Section
        title="Working-time rules"
        hint="Defaults follow Icelandic shift-work agreements (betri vinnutími, lög 46/1980). Blank = rule off. See docs/research/icelandic-rules.md."
      >
        <div className="form-grid">
          {LABOR_FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <NumberField
                nullable={f.nullable}
                step={f.step}
                value={p.rules[f.key] as number | null}
                onChange={(v) => setRules({ [f.key]: v } as Partial<LaborRules>)}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Hour weighting (vægi)" hint="Worked minutes inside a band count × weight towards contract hours. Public holidays count as weekend days.">
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
            {p.rules.weight_bands.map((b, i) => (
              <tr key={i}>
                <td>
                  <TextField value={b.name} onChange={(name) => setRules({ weight_bands: patchAt(p.rules.weight_bands, i, { name }) })} />
                </td>
                <td>
                  <Select
                    value={b.days}
                    options={[
                      { value: 'weekday', label: 'Weekdays' },
                      { value: 'weekend_or_holiday', label: 'Weekends & holidays' },
                      { value: 'all', label: 'Every day' },
                    ]}
                    onChange={(days) => setRules({ weight_bands: patchAt(p.rules.weight_bands, i, { days }) })}
                  />
                </td>
                <td>
                  <TextField width={60} value={b.start} onChange={(start) => setRules({ weight_bands: patchAt(p.rules.weight_bands, i, { start }) })} />
                </td>
                <td>
                  <TextField width={60} value={b.end} onChange={(end) => setRules({ weight_bands: patchAt(p.rules.weight_bands, i, { end }) })} />
                </td>
                <td>
                  <NumberField step={0.01} value={b.weight} onChange={(v) => setRules({ weight_bands: patchAt(p.rules.weight_bands, i, { weight: v ?? 1 }) })} />
                </td>
                <td>
                  <button className="link" onClick={() => setRules({ weight_bands: removeAt(p.rules.weight_bands, i) })}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setRules({ weight_bands: [...p.rules.weight_bands, { name: 'Band', days: 'all', start: '00:00', end: '08:00', weight: 1 }] })}>
          + Band
        </button>
      </Section>

      <Section
        title="Planner rules"
        hint="Your own rules. Hard rules are never broken; soft rules are followed where possible, weighted against the other soft goals."
      >
        {p.custom_rules.map((r, i) => (
          <div key={r.id} className={`rule ${r.enabled ? '' : 'disabled'}`}>
            <div className="row">
              <input type="checkbox" checked={r.enabled} onChange={(e) => setRule(i, { enabled: e.target.checked })} title="Enabled" />
              <b>{RULE_TYPES.find((t) => t.value === r.type)?.label}</b>
              <input
                className="grow"
                placeholder="Description (shown in the rule check)"
                value={r.description}
                onChange={(e) => setRule(i, { description: e.target.value })}
              />
              <button className="link" onClick={() => set({ custom_rules: removeAt(p.custom_rules, i) })}>
                remove
              </button>
            </div>
            <div className="row">
              {r.type === 'forbid_sequence' ? (
                <>
                  Group{' '}
                  <Select
                    value={r.group_id ?? ''}
                    options={[{ value: '', label: 'Everyone' }, ...groups]}
                    onChange={(v) => setRule(i, { group_id: v || null })}
                  />
                  <Select value={r.from_shift_id} options={shifts} onChange={(from_shift_id) => setRule(i, { from_shift_id })} />
                  must not be followed next day by
                  <Select value={r.to_shift_id} options={shifts} onChange={(to_shift_id) => setRule(i, { to_shift_id })} />
                </>
              ) : r.type === 'fixed_area' ? (
                <>
                  <Select value={r.staff_id} options={people} onChange={(staff_id) => setRule(i, { staff_id })} /> always works in
                  <Select value={r.area_id} options={areas} onChange={(area_id) => setRule(i, { area_id })} />
                  when on shift
                </>
              ) : r.type === 'diverse_shifts' ? (
                <>
                  <Select value={r.staff_id} options={people} onChange={(staff_id) => setRule(i, { staff_id })} /> gets a balanced mix of
                  <Checks
                    values={r.shift_ids ?? []}
                    options={shifts}
                    onChange={(ids) => setRule(i, { shift_ids: ids.length ? ids : null })}
                  />
                  <span className="muted">(none ticked = every shift they may work)</span>
                </>
              ) : (
                <>
                  Group <Select value={r.group_id} options={groups} onChange={(group_id) => setRule(i, { group_id })} />
                </>
              )}
              {r.type === 'avoid_task_repeat' && (
                <>
                  does <Select value={r.task_id} options={tasks} onChange={(task_id) => setRule(i, { task_id })} /> at most
                  <NumberField width={50} value={r.max_count} onChange={(v) => setRule(i, { max_count: v ?? 1 })} /> times in any
                  <NumberField width={50} value={r.window_days} onChange={(v) => setRule(i, { window_days: v ?? 1 })} /> days
                </>
              )}
              {r.type === 'rotate_task_evenly' && (
                <>
                  shares <Select value={r.task_id} options={tasks} onChange={(task_id) => setRule(i, { task_id })} /> evenly
                  <label>
                    <input
                      type="checkbox"
                      checked={r.proportional_to_employment}
                      onChange={(e) => setRule(i, { proportional_to_employment: e.target.checked })}
                    />
                    in proportion to employment %
                  </label>
                </>
              )}
              {r.type === 'max_shift_type' && (
                <>
                  works <Select value={r.shift_id} options={shifts} onChange={(shift_id) => setRule(i, { shift_id })} /> at most
                  <NumberField width={50} value={r.max_count} onChange={(v) => setRule(i, { max_count: v ?? 0 })} /> times per period
                </>
              )}
            </div>
            <div className="row">
              <label>
                <input type="checkbox" checked={r.hard} onChange={(e) => setRule(i, { hard: e.target.checked })} /> Hard rule
              </label>
              {!r.hard && (
                <label>
                  Weight <NumberField width={60} value={r.weight} onChange={(v) => setRule(i, { weight: v ?? 1 })} />
                </label>
              )}
            </div>
          </div>
        ))}
        <div className="row">
          Add:
          {RULE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => set({ custom_rules: [...p.custom_rules, blankRule(t.value, p, newId('rule', p.custom_rules))] })}
            >
              + {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Optimisation weights" hint="How much each soft goal matters. Hour terms are per hour; the rest per occurrence.">
        <div className="form-grid">
          {WEIGHT_FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <NumberField value={p.weights[f.key]} onChange={(v) => set({ weights: { ...p.weights, [f.key]: v ?? 0 } })} />
            </label>
          ))}
        </div>
      </Section>
    </div>
  )
}
