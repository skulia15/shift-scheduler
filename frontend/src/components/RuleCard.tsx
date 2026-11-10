import { useI18n } from '../i18n'
import { ALL_DAYS, isPersonRule, KIND_LABEL, RULE_LABEL, weekdayName } from '../rules'
import { KINDS, shiftKind } from '../shiftColors'
import type { CustomRule, Project, ShiftKind } from '../types'
import { Checks, NumberField, RemoveButton, Select } from './fields'

interface CardProps {
  rule: CustomRule
  project: Project
  onChange: (patch: Partial<CustomRule>) => void
  onRemove: () => void
  /** On a person's own panel the person is implied. */
  showStaff?: boolean
}

export function RuleCard({ rule: r, project: p, onChange, onRemove, showStaff = true }: CardProps) {
  const i = useI18n()
  const { t } = i
  const set = (patch: Record<string, unknown>) => onChange(patch as Partial<CustomRule>)
  const groups = p.groups.map((g) => ({ value: g.id, label: g.name }))
  const tasks = p.tasks.map((x) => ({ value: x.id, label: x.name }))
  const shifts = p.shift_types.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))
  const shiftCodes = p.shift_types.map((s) => ({ value: s.id, label: s.code }))
  const people = p.staff.map((s) => ({ value: s.id, label: s.name }))
  const areas = p.areas.map((a) => ({ value: a.id, label: a.name }))
  const weekdayOptions = ALL_DAYS.map((d) => ({ value: d, label: weekdayName(i, d) }))
  const kindOptions = KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))

  const shiftFilter = (kinds: ShiftKind[] | null | undefined, shiftIds: string[] | null | undefined) => {
    // Shift-type pills are grouped by kind so 16 clock times stay readable.
    const byKind = KINDS.map((k) => p.shift_types.filter((s) => shiftKind(s) === k).map((s) => ({ value: s.id, label: s.code }))).filter((o) => o.length)
    return (
      <span className="filter">
        <Checks values={kinds ?? []} options={kindOptions} onChange={(v) => set({ kinds: v.length ? v : null })} />
        <details className="shift-pick">
          <summary className="muted small">{shiftIds?.length ? i.tn(shiftIds.length, '{n} clock time', '{n} clock times') : t('Any clock time')}</summary>
          {byKind.map((opts, idx) => (
            <Checks key={idx} values={shiftIds ?? []} options={opts} onChange={(v) => set({ shift_ids: [...(shiftIds ?? []).filter((id) => !opts.some((o) => o.value === id)), ...v].length ? [...(shiftIds ?? []).filter((id) => !opts.some((o) => o.value === id)), ...v] : null })} />
          ))}
        </details>
      </span>
    )
  }

  return (
    <article className={`rule-card ${r.enabled ? '' : 'disabled'}`}>
      <div className="row">
        <span className="chip">{t(RULE_LABEL[r.type] ?? r.type)}</span>
        <span className="spacer" />
        <label className="row small">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {t('On')}
        </label>
        <RemoveButton label={t('Remove rule')} onClick={onRemove} />
      </div>
      <input className="desc" placeholder={t('Describe the rule…')} aria-label={t('Description')} value={r.description} onChange={(e) => set({ description: e.target.value })} />
      <div className="params">
        {showStaff && isPersonRule(r) && <Select value={r.staff_id} options={people} onChange={(staff_id) => set({ staff_id })} />}
        {r.type === 'forbid_sequence' && (
          <>
            <Select value={r.group_id ?? ''} options={[{ value: '', label: t('Everyone') }, ...groups]} onChange={(v) => set({ group_id: v || null })} />
            <Select value={r.from_shift_id} options={shifts} onChange={(from_shift_id) => set({ from_shift_id })} />
            {t('never followed next day by')}
            <Select value={r.to_shift_id} options={shifts} onChange={(to_shift_id) => set({ to_shift_id })} />
          </>
        )}
        {r.type === 'linked_shift' && (
          <>
            <Select value={r.group_id ?? ''} options={[{ value: '', label: t('Everyone') }, ...groups]} onChange={(v) => set({ group_id: v || null })} />
            <Select value={r.from_shift_id} options={shifts} onChange={(from_shift_id) => set({ from_shift_id })} /> {t('on')}
            <Checks values={r.weekdays} options={weekdayOptions} onChange={(weekdays) => set({ weekdays })} /> {t('brings')}
            <Select value={r.to_shift_id} options={shifts} onChange={(to_shift_id) => set({ to_shift_id })} />
            <NumberField width={56} value={r.days_after} onChange={(v) => set({ days_after: Math.min(6, Math.max(1, v ?? 1)) })} /> {t('days later')}
          </>
        )}
        {r.type === 'fixed_area' && (
          <>
            {t('always in')}
            <Select value={r.area_id} options={areas} onChange={(area_id) => set({ area_id })} />
          </>
        )}
        {r.type === 'diverse_shifts' && (
          <>
            {t('balanced across')}
            {r.by_kind ? (
              <Checks values={r.kinds ?? []} options={kindOptions} onChange={(v) => set({ kinds: v.length ? v : null })} />
            ) : (
              <Checks values={r.shift_ids ?? []} options={shiftCodes} onChange={(ids) => set({ shift_ids: ids.length ? ids : null })} />
            )}
            <label className="row small">
              <input type="checkbox" checked={!!r.by_kind} onChange={(e) => set({ by_kind: e.target.checked })} />
              {t('by MV / KV / NV')}
            </label>
            <span className="muted">{t('(none = all they may work)')}</span>
          </>
        )}
        {r.type === 'weekend_pattern' && (
          <>
            {t('works 1 in')}
            <NumberField width={60} value={r.every} onChange={(v) => set({ every: Math.max(0, v ?? 0) })} /> {t('weekends|unit')}
            <span className="muted">{t('(0 = never)')}</span>
            <label className="row small">
              <input type="checkbox" checked={r.both_days} onChange={(e) => set({ both_days: e.target.checked })} />
              {t('both days')}
            </label>
          </>
        )}
        {r.type === 'allowed_shifts' && (
          <>
            {t('on')} <Checks values={r.weekdays} options={weekdayOptions} onChange={(weekdays) => set({ weekdays })} /> {t('only')}
            {shiftFilter(r.kinds, r.shift_ids)}
          </>
        )}
        {r.type === 'recurring_shift' && (
          <>
            {t('every')} <Checks values={r.weekdays} options={weekdayOptions} onChange={(weekdays) => set({ weekdays })} /> {t('on')}
            {shiftFilter(r.kinds, r.shift_ids)}
          </>
        )}
        {r.type === 'unavailable_weekdays' && (
          <>
            {t('not on')} <Checks values={r.weekdays} options={weekdayOptions} onChange={(weekdays) => set({ weekdays })} />
          </>
        )}
        {r.type === 'shifts_per_week' && (
          <>
            <NumberField width={56} nullable placeholder="—" value={r.min} onChange={(min) => set({ min })} />–
            <NumberField width={56} nullable placeholder="—" value={r.max} onChange={(max) => set({ max })} /> {t('per week of')}
            {shiftFilter(r.kinds, r.shift_ids)}
          </>
        )}
        {r.type === 'work_together' && (
          <>
            {t('with')}
            <Select value={r.other_staff_id} options={people.filter((o) => o.value !== r.staff_id)} onChange={(other_staff_id) => set({ other_staff_id })} /> {t('on')}
            <Checks values={r.kinds ?? []} options={kindOptions} onChange={(v) => set({ kinds: v.length ? v : null })} />
          </>
        )}
        {(r.type === 'avoid_task_repeat' || r.type === 'rotate_task_evenly' || r.type === 'max_shift_type') && (
          <Select value={r.group_id} options={groups} onChange={(group_id) => set({ group_id })} />
        )}
        {r.type === 'avoid_task_repeat' && (
          <>
            <Select value={r.task_id} options={tasks} onChange={(task_id) => set({ task_id })} /> {t('at most')}
            <NumberField width={60} value={r.max_count} onChange={(v) => set({ max_count: v ?? 1 })} /> {t('times in')}
            <NumberField width={60} value={r.window_days} onChange={(v) => set({ window_days: v ?? 1 })} /> {t('days')}
          </>
        )}
        {r.type === 'rotate_task_evenly' && (
          <>
            <Select value={r.task_id} options={tasks} onChange={(task_id) => set({ task_id })} />
            <label className="row">
              <input type="checkbox" checked={r.proportional_to_employment} onChange={(e) => set({ proportional_to_employment: e.target.checked })} />
              {t('by employment %')}
            </label>
          </>
        )}
        {r.type === 'max_shift_type' && (
          <>
            <Select value={r.shift_id} options={shifts} onChange={(shift_id) => set({ shift_id })} /> {t('at most')}
            <NumberField width={60} value={r.max_count} onChange={(v) => set({ max_count: v ?? 0 })} /> {t('per period')}
          </>
        )}
      </div>
      <div className="foot">
        <div className="segmented" role="radiogroup" aria-label={t('Hard or soft')}>
          <button role="radio" aria-checked={r.hard} onClick={() => set({ hard: true })}>
            {t('Hard')}
          </button>
          <button role="radio" aria-checked={!r.hard} onClick={() => set({ hard: false })}>
            {t('Soft')}
          </button>
        </div>
        {!r.hard && (
          <label className="row">
            <NumberField width={70} value={r.weight} onChange={(v) => set({ weight: v ?? 1 })} />
            <span className="muted">{t('points')}</span>
          </label>
        )}
      </div>
    </article>
  )
}
