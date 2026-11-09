// Mirrors backend/app/models.py.

export type ISODate = string // YYYY-MM-DD

export interface ShiftType {
  id: string
  code: string
  name: string
  start: string
  end: string
  break_minutes: number
  is_night: boolean
}

export interface StaffGroup {
  id: string
  name: string
}

export interface Staff {
  id: string
  name: string
  group_ids: string[]
  employment_percent: number
  allowed_shift_ids: string[] | null
  target_hours_override: number | null
}

export interface Task {
  id: string
  name: string
  group_id: string
}

export interface CoverageDemand {
  shift_id: string
  group_id: string
  weekdays: number[]
  dates: ISODate[] | null
  min: number
  max: number | null
}

export interface TaskDemand {
  task_id: string
  shift_id: string
  weekdays: number[]
  dates: ISODate[] | null
  count: number
}

export interface Area {
  id: string
  code: string
  name: string
}

export interface AreaDemand {
  area_id: string
  shift_id: string
  group_id: string
  weekdays: number[]
  dates: ISODate[] | null
  min: number
  max: number | null
}

export interface Leave {
  staff_id: string
  start: ISODate
  end: ISODate
  kind: 'holiday' | 'request'
  granted: boolean
  note: string
}

export interface WeightBand {
  name: string
  days: 'weekday' | 'weekend_or_holiday' | 'high_holiday' | 'all'
  start: string
  end: string
  weight: number
}

export interface PublicHoliday {
  date: ISODate
  name: string
  duty_reduction_hours: number
  major: boolean
  starts: string
  high_from: string | null
}

export type Agreement = 'sfv' | 'state' | 'municipal' | 'reykjavik' | 'custom'

export interface LaborRules {
  agreement: Agreement
  full_time_weekly_hours: number
  weight_bands: WeightBand[]
  min_actual_weekly_hours: number | null
  min_rest_hours: number
  min_rest_hours_absolute: number
  max_short_rests_per_week: number | null
  max_shift_hours: number
  min_shift_hours: number | null
  normal_max_shift_hours: number | null
  weekly_rest_hours: number | null
  max_consecutive_days: number | null
  days_off_per_week: number | null
  days_off_consecutive: boolean
  days_off_hard: boolean
  lone_night_warning: boolean
  max_avg_weekly_hours: number | null
  max_overtime_hours: number | null
  max_consecutive_nights: number | null
  max_weekend_ratio: number | null
}

export interface Weights {
  under_hours: number
  overtime_hours: number
  overtime_spread: number
  request_denied: number
  short_rest: number
  short_rest_excess: number
  days_off: number
  weekend_excess: number
  overstaff: number
  coverage_shortfall: number
}

interface RuleBase {
  id: string
  enabled: boolean
  hard: boolean
  weight: number
  description: string
}

export type CustomRule =
  | (RuleBase & { type: 'avoid_task_repeat'; group_id: string; task_id: string; max_count: number; window_days: number })
  | (RuleBase & { type: 'rotate_task_evenly'; group_id: string; task_id: string; proportional_to_employment: boolean })
  | (RuleBase & { type: 'max_shift_type'; group_id: string; shift_id: string; max_count: number })
  | (RuleBase & { type: 'forbid_sequence'; group_id: string | null; from_shift_id: string; to_shift_id: string })
  | (RuleBase & { type: 'fixed_area'; staff_id: string; area_id: string })
  | (RuleBase & { type: 'diverse_shifts'; staff_id: string; shift_ids: string[] | null })

export interface Project {
  name: string
  period: { start: ISODate; days: number }
  shift_types: ShiftType[]
  groups: StaffGroup[]
  staff: Staff[]
  tasks: Task[]
  coverage: CoverageDemand[]
  task_demand: TaskDemand[]
  areas: Area[]
  area_demand: AreaDemand[]
  leave: Leave[]
  public_holidays: PublicHoliday[]
  rules: LaborRules
  weights: Weights
  custom_rules: CustomRule[]
  solve_seconds: number
}

export interface Assignment {
  staff_id: string
  date: ISODate
  shift_id: string
  task_ids: string[]
  area_id: string | null
}

export interface Violation {
  rule: string
  severity: 'error' | 'warning'
  message: string
  staff_id: string | null
  date: ISODate | null
  shift_id: string | null
}

export interface StaffStats {
  staff_id: string
  shifts: number
  worked_hours: number
  credited_hours: number
  target_hours: number
  overtime_hours: number
  under_hours: number
  night_shifts: number
  weekends_worked: number
  requests_denied: number
  task_counts: Record<string, number>
}

export interface CoverageCell {
  date: ISODate
  shift_id: string
  group_id: string
  area_id: string | null
  required: number
  assigned: number
}

export interface Evaluation {
  violations: Violation[]
  staff: StaffStats[]
  coverage: CoverageCell[]
}

export interface SolveResult extends Evaluation {
  status: 'optimal' | 'feasible' | 'relaxed' | 'failed'
  message: string
  roster: Assignment[]
  objective: number | null
  solve_seconds: number
}
