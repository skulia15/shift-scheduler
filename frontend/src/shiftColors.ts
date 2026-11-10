import type { ShiftKind, ShiftType } from './types'

export type { ShiftKind }

const COLORS: Record<ShiftKind, { bg: string; fg: string }> = {
  morning: { bg: '#f6e6a6', fg: '#4a3b00' },
  evening: { bg: '#f2c9c2', fg: '#5c1f17' },
  night: { bg: '#1f3a5f', fg: '#e8f0fa' },
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
export function shiftColor(s: Pick<ShiftType, 'category' | 'is_night' | 'start'> | undefined) {
  return s ? COLORS[shiftKind(s)] : { bg: '#e6ebe9', fg: '#2d3538' }
}

export const KINDS: ShiftKind[] = ['morning', 'evening', 'night']
