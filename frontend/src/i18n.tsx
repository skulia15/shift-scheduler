import { createContext, useContext } from 'react'
import type { ISODate } from './types'
import { IS } from './i18n-is'

export type Lang = 'en' | 'is'

const WEEKDAYS = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], is: ['mán.', 'þri.', 'mið.', 'fim.', 'fös.', 'lau.', 'sun.'] }
const WEEKDAYS_SHORT = { en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], is: ['Má', 'Þr', 'Mi', 'Fi', 'Fö', 'La', 'Su'] }
const WEEKDAYS_LONG = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  is: ['mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur', 'sunnudagur'],
}
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  is: ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'],
}

function wd(date: ISODate): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

export interface I18n {
  lang: Lang
  /** Translate an English UI string; {name} placeholders are filled from `vars`. */
  t: (en: string, vars?: Record<string, string | number>) => string
  /** Plural-aware t(): `one` and `other` are English keys; Icelandic uses its own rule (1, 21, 31… are singular). */
  tn: (n: number, one: string, other: string, vars?: Record<string, string | number>) => string
  /** Number with the language's decimal mark. */
  num: (n: number, digits?: number) => string
  weekday: (date: ISODate) => string
  weekdayShort: (date: ISODate) => string
  weekdayLong: (date: ISODate) => string
  /** "Tue 8 Dec" / "þri. 8. des." */
  day: (date: ISODate) => string
  /** "8 Dec" / "8. des." */
  dayMonth: (date: ISODate) => string
  month: (date: ISODate) => string
}

export function makeI18n(lang: Lang): I18n {
  const t = (en: string, vars?: Record<string, string | number>) => {
    let text = lang === 'is' ? (IS[en] ?? en) : en
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
    return text
  }
  const dayNum = (date: ISODate) => Number(date.slice(8))
  const month = (date: ISODate) => MONTHS[lang][Number(date.slice(5, 7)) - 1]
  const dayMonth = (date: ISODate) => (lang === 'is' ? `${dayNum(date)}. ${month(date)}` : `${dayNum(date)} ${month(date)}`)
  const singular = (n: number) => (lang === 'is' ? n % 10 === 1 && n % 100 !== 11 : n === 1)
  return {
    lang,
    t,
    tn: (n, one, other, vars) => t(singular(n) ? one : other, { n, ...vars }),
    num: (n, digits = 1) => {
      const s = Number.isInteger(n) ? String(n) : n.toFixed(digits)
      return lang === 'is' ? s.replace('.', ',') : s
    },
    weekday: (date) => WEEKDAYS[lang][wd(date)],
    weekdayShort: (date) => WEEKDAYS_SHORT[lang][wd(date)],
    weekdayLong: (date) => WEEKDAYS_LONG[lang][wd(date)],
    day: (date) => `${WEEKDAYS[lang][wd(date)]} ${dayMonth(date)}`,
    dayMonth,
    month,
  }
}

export const I18nContext = createContext<I18n>(makeI18n('en'))

export function useI18n(): I18n {
  return useContext(I18nContext)
}
