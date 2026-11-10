import type { I18n } from './i18n'
import { KINDS } from './shiftColors'
import type { CustomRule, Project, ShiftKind } from './types'

export const UNIT_RULE_TYPES: { value: CustomRule['type']; label: string }[] = [
  { value: 'avoid_task_repeat', label: 'Don’t repeat a task too often' },
  { value: 'rotate_task_evenly', label: 'Rotate a task evenly' },
  { value: 'max_shift_type', label: 'Limit a shift type per person' },
  { value: 'forbid_sequence', label: 'Forbid shift A followed by B' },
]

/** Rules about one person: their wishes, hallway and shift mix. Edited on the person. */
export const PERSON_RULE_TYPES: { value: CustomRule['type']; label: string }[] = [
  { value: 'weekend_pattern', label: 'Weekends' },
  { value: 'allowed_shifts', label: 'Only these shifts' },
  { value: 'recurring_shift', label: 'Works on set weekdays' },
  { value: 'unavailable_weekdays', label: 'Not on these weekdays' },
  { value: 'shifts_per_week', label: 'Shifts per week' },
  { value: 'diverse_shifts', label: 'Give a person a varied shift mix' },
  { value: 'fixed_area', label: 'Keep a person in one area' },
  { value: 'work_together', label: 'Works with a colleague' },
]

export const RULE_LABEL = Object.fromEntries([...UNIT_RULE_TYPES, ...PERSON_RULE_TYPES].map((r) => [r.value, r.label])) as Record<CustomRule['type'], string>

export function isPersonRule(r: CustomRule): r is Extract<CustomRule, { staff_id: string }> {
  return 'staff_id' in r
}

export const KIND_LABEL: Record<ShiftKind, string> = { morning: 'MV', evening: 'KV', night: 'NV' }
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

export function blankRule(type: CustomRule['type'], p: Project, id: string, staffId?: string): CustomRule {
  const base = { id, enabled: true, hard: false, weight: 20, description: '' }
  const group_id = p.groups[0]?.id ?? ''
  const task_id = p.tasks[0]?.id ?? ''
  const shift_id = p.shift_types[0]?.id ?? ''
  const staff_id = staffId ?? p.staff[0]?.id ?? ''
  const filter = { kinds: null, shift_ids: null }
  switch (type) {
    case 'avoid_task_repeat':
      return { ...base, weight: 10, type, group_id, task_id, max_count: 1, window_days: 3 }
    case 'rotate_task_evenly':
      return { ...base, weight: 10, type, group_id, task_id, proportional_to_employment: true }
    case 'max_shift_type':
      return { ...base, weight: 10, type, group_id, shift_id, max_count: 8 }
    case 'forbid_sequence':
      return { ...base, weight: 10, type, group_id: null, from_shift_id: shift_id, to_shift_id: shift_id }
    case 'fixed_area':
      return { ...base, type, hard: true, staff_id, area_id: p.areas[0]?.id ?? '' }
    case 'diverse_shifts':
      return { ...base, type, staff_id, shift_ids: null, by_kind: true, kinds: null }
    case 'weekend_pattern':
      return { ...base, weight: 40, type, staff_id, every: 2, both_days: false }
    case 'allowed_shifts':
      return { ...base, type, staff_id, ...filter, kinds: ['morning'], weekdays: ALL_DAYS }
    case 'recurring_shift':
      return { ...base, type, staff_id, ...filter, weekdays: [0] }
    case 'unavailable_weekdays':
      return { ...base, weight: 40, type, staff_id, weekdays: [3] }
    case 'shifts_per_week':
      return { ...base, type, staff_id, ...filter, kinds: ['evening'], weekdays: ALL_DAYS, min: 1, max: 1 }
    case 'work_together':
      return { ...base, weight: 8, type, staff_id, ...filter, other_staff_id: p.staff.find((s) => s.id !== staff_id)?.id ?? staff_id }
  }
}

const days = (i: I18n, ds: number[]) =>
  ds.length === 7 ? i.t('every day') : ds.length === 5 && ds.every((d) => d < 5) ? i.t('weekdays') : ds.length === 2 && ds[0] === 5 && ds[1] === 6 ? i.t('weekends') : ds.map((d) => weekdayName(i, d)).join(', ')

export function weekdayName(i: I18n, d: number) {
  // 2024-01-01 is a Monday.
  return i.weekday(`2024-01-0${d + 1}`)
}

function filterText(i: I18n, p: Project, kinds: ShiftKind[] | null | undefined, shiftIds: string[] | null | undefined) {
  const parts: string[] = []
  if (kinds?.length) parts.push(kinds.map((k) => KIND_LABEL[k]).join('/'))
  if (shiftIds?.length) {
    const shifts = p.shift_types.filter((s) => shiftIds.includes(s.id))
    // A long list is "everything except a few": say which are left out.
    const left = p.shift_types.filter((s) => !shiftIds.includes(s.id))
    parts.push(shifts.length > 4 && left.length < shifts.length ? i.t('not {codes}', { codes: left.map((s) => s.code).join(', ') }) : shifts.map((s) => s.code).join(', '))
  }
  return parts.join(' · ') || i.t('any shift')
}

/** One line in the planner's words: "1 in 2 weekends", "Only KV · Sat, Sun". */
export function describeRule(i: I18n, p: Project, r: CustomRule): string {
  const { t } = i
  const name = (id: string) => p.staff.find((s) => s.id === id)?.name ?? id
  switch (r.type) {
    case 'weekend_pattern':
      return r.every === 0 ? t('No weekends') : t('1 in {n} weekends', { n: r.every }) + (r.both_days ? ` · ${t('both days')}` : '')
    case 'allowed_shifts': {
      const left = p.shift_types.filter((s) => !r.shift_ids?.includes(s.id))
      const only = r.shift_ids && !r.kinds?.length && r.shift_ids.length > 4 && left.length < r.shift_ids.length
        ? t('Not {codes}', { codes: left.map((s) => s.code).join(', ') })
        : t('Only {what}', { what: filterText(i, p, r.kinds, r.shift_ids) })
      return `${only}${r.weekdays.length < 7 ? ` · ${days(i, r.weekdays)}` : ''}`
    }
    case 'recurring_shift':
      return `${t('Every {days}', { days: days(i, r.weekdays) })} · ${filterText(i, p, r.kinds, r.shift_ids)}`
    case 'unavailable_weekdays':
      return t('Not on {days}', { days: days(i, r.weekdays) })
    case 'shifts_per_week': {
      const n = r.min === r.max ? `${r.max}` : r.min ? `${r.min}–${r.max ?? '∞'}` : t('at most {n}', { n: r.max ?? '∞' })
      return t('{n} × {what} per week', { n, what: filterText(i, p, r.kinds, r.shift_ids) })
    }
    case 'diverse_shifts':
      return r.by_kind ? t('Mixed {kinds}', { kinds: (r.kinds ?? KINDS).map((k) => KIND_LABEL[k]).join('/') }) : t(RULE_LABEL[r.type])
    case 'fixed_area':
      return t('Always in {area}', { area: p.areas.find((a) => a.id === r.area_id)?.name ?? r.area_id })
    case 'work_together':
      return t('With {name}', { name: name(r.other_staff_id) })
    default:
      return t(RULE_LABEL[r.type])
  }
}
