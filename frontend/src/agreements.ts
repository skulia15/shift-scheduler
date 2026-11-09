import type { Agreement, LaborRules } from './types'

/** Settings that differ between collective agreements (docs/RULE-SPEC.md, "Agreement profiles"). */
export const AGREEMENTS: { value: Agreement; label: string; rules: Partial<LaborRules> }[] = [
  { value: 'sfv', label: 'SFV', rules: { days_off_hard: false, normal_max_shift_hours: 10, lone_night_warning: false } },
  { value: 'state', label: 'State', rules: { days_off_hard: false, normal_max_shift_hours: 10, lone_night_warning: false } },
  { value: 'municipal', label: 'Municipalities', rules: { days_off_hard: false, normal_max_shift_hours: 12, lone_night_warning: true } },
  { value: 'reykjavik', label: 'Reykjavík', rules: { days_off_hard: true, normal_max_shift_hours: 10, lone_night_warning: false } },
  { value: 'custom', label: 'Custom', rules: {} },
]
