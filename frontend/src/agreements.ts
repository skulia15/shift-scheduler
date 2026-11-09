import type { Agreement, LaborRules } from './types'

/** Settings that differ between collective agreements (docs/RULE-SPEC.md, "Agreement profiles"). */
export const AGREEMENTS: { value: Agreement; label: string; rules: Partial<LaborRules> }[] = [
  { value: 'sfv', label: 'SFV (Efling, Sameyki, SLFÍ, FÍH)', rules: { days_off_hard: false, normal_max_shift_hours: 10, lone_night_warning: false } },
  { value: 'state', label: 'Ríkið (state)', rules: { days_off_hard: false, normal_max_shift_hours: 10, lone_night_warning: false } },
  { value: 'municipal', label: 'Sveitarfélög (SNS)', rules: { days_off_hard: false, normal_max_shift_hours: 12, lone_night_warning: true } },
  { value: 'reykjavik', label: 'Reykjavíkurborg', rules: { days_off_hard: true, normal_max_shift_hours: 10, lone_night_warning: false } },
  { value: 'custom', label: 'Custom', rules: {} },
]
