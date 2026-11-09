import type { ISODate } from './types'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function periodDates(start: ISODate, days: number): ISODate[] {
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10))
}

/** 0 = Monday … 6 = Sunday, matching Python's date.weekday(). */
export function weekday(date: ISODate): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function shortDate(date: ISODate): string {
  return `${Number(date.slice(8))}.${Number(date.slice(5, 7))}`
}
