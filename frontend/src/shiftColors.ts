import type { ShiftKind, ShiftType } from './types'

export type { ShiftKind }

const APP_COLORS: Record<ShiftKind, { bg: string; fg: string }> = {
  morning: { bg: '#f6e6a6', fg: '#4a3b00' },
  evening: { bg: '#f2c9c2', fg: '#5c1f17' },
  night: { bg: '#1f3a5f', fg: '#e8f0fa' },
}
/** The planner's Excel sheet: MV blue, KV green, NV orange. */
const SHEET_COLORS: Record<ShiftKind, { bg: string; fg: string }> = {
  morning: { bg: '#94dcf8', fg: '#0d2a36' },
  evening: { bg: '#daf2d0', fg: '#1e3a14' },
  night: { bg: '#f1a983', fg: '#4a1c06' },
}
let COLORS = APP_COLORS

/** Which palette every shift colour comes from; set once per render from the view settings. */
export function setPalette(palette: 'app' | 'sheet') {
  COLORS = palette === 'sheet' ? SHEET_COLORS : APP_COLORS
}

const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

/** Morning, evening or night: the shift's category if set, else from its start time (as the server does). */
export function shiftKind(s: Pick<ShiftType, 'category' | 'is_night' | 'start'>): ShiftKind {
  if (s.category) return s.category
  if (s.is_night) return 'night'
  const start = minutes(s.start)
  return start < 12 * 60 ? 'morning' : start < 20 * 60 + 30 ? 'evening' : 'night'
}

/** Every shift of a kind shares its colour, however many clock-time variants the unit uses. */
export function shiftColor(s: (Pick<ShiftType, 'category' | 'is_night' | 'start'> & { text_color?: string | null }) | undefined) {
  if (!s) return { bg: '#e6ebe9', fg: '#2d3538' }
  const c = COLORS[shiftKind(s)]
  // The sheet's own text colour (red part shifts) only in the sheet palette.
  return COLORS === SHEET_COLORS && s.text_color ? { ...c, fg: `#${s.text_color}` } : c
}

export const KINDS: ShiftKind[] = ['morning', 'evening', 'night']
