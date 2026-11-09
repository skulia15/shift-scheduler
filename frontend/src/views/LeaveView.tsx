import { useState } from 'react'
import { api } from '../api'
import { NumberField, PageHead, RemoveButton, Section, TextField } from '../components/fields'
import { UndoIcon } from '../components/icons'
import { periodDates, weekday } from '../dates'
import { useI18n } from '../i18n'
import { patchAt, removeAt } from '../lists'
import type { ISODate, Leave, Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

type Kind = 'request' | 'granted' | 'holiday' | 'sick'
const LETTER: Record<Kind, string> = { request: 'R', granted: 'G', holiday: 'F', sick: 'S' }
const BY_LETTER: Record<string, Kind> = { r: 'request', g: 'granted', f: 'holiday', s: 'sick' }
const CYCLE: (Kind | null)[] = [null, 'request', 'granted', 'holiday', 'sick']

interface DayLeave {
  kind: Kind
  note: string
}

function kindOf(lv: Leave): Kind {
  return lv.kind === 'request' ? (lv.granted ? 'granted' : 'request') : lv.kind
}

function expand(leave: Leave[]): Map<string, DayLeave> {
  const map = new Map<string, DayLeave>()
  for (const lv of leave) {
    const days = Math.round((Date.parse(lv.end) - Date.parse(lv.start)) / 86_400_000) + 1
    for (const d of periodDates(lv.start, days)) map.set(`${lv.staff_id}|${d}`, { kind: kindOf(lv), note: lv.note })
  }
  return map
}

/** Merge per-day entries back into date ranges. */
function compress(map: Map<string, DayLeave>): Leave[] {
  const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  const out: Leave[] = []
  for (const [key, { kind, note }] of sorted) {
    const [staff_id, date] = key.split('|')
    const last = out.at(-1)
    if (last && last.staff_id === staff_id && kindOf(last) === kind && last.note === note && periodDates(last.end, 2)[1] === date) {
      last.end = date
    } else {
      out.push({ staff_id, start: date, end: date, kind: kind === 'granted' ? 'request' : kind, granted: kind === 'granted', note })
    }
  }
  return out
}

export function LeaveView({ project: p, setProject }: Props) {
  const i = useI18n()
  const { t } = i
  const dates = periodDates(p.period.start, p.period.days)
  const map = expand(p.leave)
  const holidays = new Set(p.public_holidays.map((h) => h.date))
  const staffName = new Map(p.staff.map((s) => [s.id, s.name]))
  const [sel, setSel] = useState<{ staffId: string; date: ISODate } | null>(null)
  const [brush, setBrush] = useState<Kind | null>('request')
  const [undoStack, setUndoStack] = useState<Leave[][]>([])
  const inPeriod = p.leave.filter((lv) => lv.end >= dates[0] && lv.start <= dates[dates.length - 1]).sort((a, b) => a.start.localeCompare(b.start))
  const NAME: Record<Kind, string> = { request: t('Request'), granted: t('Granted'), holiday: t('Holiday leave'), sick: t('Sick') }

  const commit = (next: Map<string, DayLeave>) => {
    setUndoStack((s) => [...s.slice(-49), p.leave])
    setProject({ ...p, leave: compress(next) })
  }
  const setDays = (staffId: string, days: ISODate[], kind: Kind | null) => {
    const next = new Map(map)
    for (const d of days) {
      const key = `${staffId}|${d}`
      if (kind) next.set(key, { kind, note: map.get(key)?.note ?? '' })
      else next.delete(key)
    }
    commit(next)
  }
  const undo = () => {
    const prev = undoStack.at(-1)
    if (!prev) return
    setUndoStack((s) => s.slice(0, -1))
    setProject({ ...p, leave: prev })
  }
  const focus = (staffId: string, date: ISODate) => {
    setSel({ staffId, date })
    document.getElementById(`lc-${staffId}-${date}`)?.focus()
  }

  const onKey = (e: React.KeyboardEvent, staffId: string, date: ISODate) => {
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[e.key]) {
      e.preventDefault()
      const [dr, dc] = arrows[e.key]
      const ri = Math.max(0, Math.min(p.staff.length - 1, p.staff.findIndex((s) => s.id === staffId) + dr))
      const di = Math.max(0, Math.min(dates.length - 1, dates.indexOf(date) + dc))
      return focus(p.staff[ri].id, dates[di])
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return undo()
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const kind = BY_LETTER[e.key.toLowerCase()]
    if (kind) {
      e.preventDefault()
      setDays(staffId, [date], kind)
    } else if (['0', 'Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault()
      setDays(staffId, [date], null)
    }
  }

  const onClick = (e: React.MouseEvent, staffId: string, date: ISODate) => {
    if (e.shiftKey && sel && sel.staffId === staffId) {
      const [a, b] = [sel.date, date].sort()
      setDays(staffId, dates.filter((d) => d >= a && d <= b), brush)
      return
    }
    if (sel && sel.staffId === staffId && sel.date === date) {
      const current = map.get(`${staffId}|${date}`)?.kind ?? null
      setDays(staffId, [date], CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length])
      return
    }
    focus(staffId, date)
  }

  const fillHolidays = async () => set({ public_holidays: await api.holidays(p.period.start, p.period.days, p.rules.agreement) })
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const agreementLabel = { sfv: 'SFV', state: t('state'), municipal: t('municipal'), reykjavik: 'Reykjavík', custom: 'SFV' }[p.rules.agreement]
  const last = dates[dates.length - 1]

  return (
    <>
      <PageHead title={t('Leave')} sub={t('Holidays and day-off requests for {range}', { range: `${i.dayMonth(dates[0])} – ${i.dayMonth(last)} ${last.slice(0, 4)}` })} />

      <section className="card">
        <div className="row" style={{ gap: '8px 16px' }}>
          <span className="chip request">R</span>
          <span>{t('Request: avoided if possible')}</span>
          <span className="chip granted">G</span>
          <span>{t('Granted: never scheduled')}</span>
          <span className="chip holiday">F</span>
          <span>{t('Holiday leave: never scheduled, lowers contract hours')}</span>
          <span className="chip sick">S</span>
          <span>{t('Sick: never scheduled, lowers contract hours')}</span>
        </div>
        <div className="row">
          <span className="muted">{t('Shift-click fills with')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('Shift-click fills with')}>
            {(['request', 'granted', 'holiday', 'sick', null] as (Kind | null)[]).map((k) => (
              <button key={k ?? 'clear'} role="radio" aria-checked={brush === k} onClick={() => setBrush(k)}>
                {k ? `${LETTER[k]} ${NAME[k]}` : t('Clear')}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <span className="muted small">{t('Select a day and type R, G, F, S or 0. Arrows move.')}</span>
          <button className="btn" disabled={!undoStack.length} onClick={undo}>
            <UndoIcon />
            {t('Undo')}
          </button>
        </div>
        <div className="grid-box">
          <table className="roster">
            <thead>
              <tr>
                <th className="name">{t('Staff')}</th>
                {dates.map((d) => (
                  <th key={d} className={holidays.has(d) ? 'holiday' : weekday(d) >= 5 ? 'weekend' : ''}>
                    <span className="wd">{i.weekdayShort(d)}</span>
                    <span className="num">{Number(d.slice(8))}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.staff.map((s) => (
                <tr key={s.id}>
                  <th className="name">{s.name}</th>
                  {dates.map((d) => {
                    const lv = map.get(`${s.id}|${d}`)
                    const selected = sel?.staffId === s.id && sel.date === d
                    return (
                      <td key={d} className={`slot ${holidays.has(d) ? 'holiday' : weekday(d) >= 5 ? 'weekend' : ''}`}>
                        <button
                          type="button"
                          id={`lc-${s.id}-${d}`}
                          tabIndex={selected || (!sel && s.id === p.staff[0]?.id && d === dates[0]) ? 0 : -1}
                          className={`cell ${lv ? `leave-${lv.kind}` : ''} ${selected ? 'selected' : ''}`}
                          aria-label={`${s.name}, ${i.day(d)}: ${lv ? NAME[lv.kind] : t('no leave')}`}
                          title={lv?.note || undefined}
                          onClick={(e) => onClick(e, s.id, d)}
                          onKeyDown={(e) => onKey(e, s.id, d)}
                        >
                          {lv && LETTER[lv.kind]}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols">
        <div className="col-wide">
          <Section title={t('In this period')} count={inPeriod.length}>
            {inPeriod.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {t('No leave or requests yet.')}
              </p>
            )}
            <ul className="list">
              {inPeriod.map((lv, idx) => {
                const k = kindOf(lv)
                return (
                  <li key={idx}>
                    <span className={`chip ${k === 'holiday' ? 'holiday' : k}`}>
                      {LETTER[k]} {NAME[k]}
                    </span>
                    <b style={{ minWidth: 100 }}>{staffName.get(lv.staff_id) ?? lv.staff_id}</b>
                    <span className="muted">{lv.start === lv.end ? i.day(lv.start) : `${i.day(lv.start)} – ${i.day(lv.end)}`}</span>
                    <input
                      style={{ flex: '1 1 160px' }}
                      placeholder={t('Note')}
                      aria-label={t('Note')}
                      value={lv.note}
                      onChange={(e) => setProject({ ...p, leave: p.leave.map((x) => (x === lv ? { ...x, note: e.target.value } : x)) })}
                    />
                  </li>
                )
              })}
            </ul>
          </Section>
        </div>
        <div className="col-narrow">
          <Section
            title={t('Public holidays')}
            hint={t('From the Icelandic holiday calendar for the chosen agreement. Holiday shifts are weighted for hours and spread fairly across periods.')}
            action={
              <button className="btn primary" onClick={fillHolidays}>
                {t('Fill from {a} calendar', { a: agreementLabel })}
              </button>
            }
          >
            {p.public_holidays.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {t('None in this period.')}
              </p>
            )}
            {p.public_holidays.map((h, idx) => (
              <div key={idx} className="tile">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className="badge lg" style={{ background: 'var(--holiday-head)', color: 'var(--ink)', flexDirection: 'column', fontSize: 10, lineHeight: 1 }}>
                    {i.month(h.date).toUpperCase()}
                    <b style={{ fontSize: 16 }}>{Number(h.date.slice(8))}</b>
                  </span>
                  <TextField value={h.name} onChange={(name) => set({ public_holidays: patchAt(p.public_holidays, idx, { name }) })} />
                  {h.major && <span className="chip hard">{t('Stórhátíð')}</span>}
                  <RemoveButton label={t('Remove holiday')} onClick={() => set({ public_holidays: removeAt(p.public_holidays, idx) })} />
                </div>
                <div className="row small">
                  <input type="date" aria-label={t('Date')} value={h.date} onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, idx, { date: e.target.value }) })} />
                  <span className="muted">−</span>
                  <NumberField step={0.1} width={70} value={h.duty_reduction_hours} onChange={(v) => set({ public_holidays: patchAt(p.public_holidays, idx, { duty_reduction_hours: v ?? 0 }) })} />
                  <span className="muted">{t('h duty')}</span>
                  <span className="muted">{t('from')}</span>
                  <input type="time" aria-label={t('Holiday starts')} value={h.starts} style={{ width: 104 }} onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, idx, { starts: e.target.value || '00:00' }) })} />
                  <span className="muted">165%</span>
                  <input
                    type="time"
                    aria-label={t('165% from')}
                    value={h.high_from ?? ''}
                    style={{ width: 104 }}
                    onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, idx, { high_from: e.target.value || null }) })}
                  />
                </div>
              </div>
            ))}
            <button
              className="dashed-btn"
              onClick={() => set({ public_holidays: [...p.public_holidays, { date: p.period.start, name: t('Holiday'), duty_reduction_hours: 7.2, major: false, starts: '00:00', high_from: null }] })}
            >
              {t('Add holiday')}
            </button>
          </Section>
        </div>
      </div>
    </>
  )
}
