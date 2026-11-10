import { weekday } from './dates'
import type { I18n } from './i18n'
import type { PublicHoliday } from './types'

const SAT_SUN_IS = ['laugardag', 'sunnudag']

/** The design's notes on a public holiday: short for the roster header, long for the Leave page. */
export function holidayNote(h: PublicHoliday, i: I18n, long: boolean): string {
  const { t } = i
  const wd = weekday(h.date)
  const onWeekend = wd >= 5
  const dayName = i.lang === 'is' ? SAT_SUN_IS[wd - 5] : wd === 5 ? 'Saturday' : 'Sunday'
  const time = (x: string) => (i.lang === 'is' ? (x.endsWith(':00') ? x.slice(0, 2) : x) : x)
  if (!long) {
    if (h.high_from) return t('holiday from {start}, 165% from {high}', { start: time(h.starts), high: time(h.high_from) })
    if (onWeekend) return t('falls on a {day}', { day: dayName })
    return h.major ? t('major holiday') : t('public holiday')
  }
  const cut = t('Target −{h} h.', { h: i.num(h.duty_reduction_hours) })
  if (h.high_from) return `${t('Eve: holiday from {start}, 165% from {high}.', { start: time(h.starts), high: time(h.high_from) })} ${cut}`
  if (onWeekend) return t('Falls on a {day}, so no target reduction.', { day: dayName })
  if (h.major) return `${t('Major holiday, counts double for holiday fairness.')} ${cut}`
  return `${t('Public holiday.')} ${cut}`
}
