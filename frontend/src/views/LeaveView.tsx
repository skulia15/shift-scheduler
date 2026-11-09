import { periodDates, shortDate, WEEKDAYS, weekday } from '../dates'
import type { ISODate, Leave, Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

type Kind = 'request' | 'granted' | 'holiday'
const CYCLE: (Kind | null)[] = [null, 'request', 'granted', 'holiday']
const LABEL: Record<Kind, string> = { request: 'R', granted: 'G', holiday: 'H' }

interface DayLeave {
  kind: Kind
  note: string
}

function expand(leave: Leave[]): Map<string, DayLeave> {
  const map = new Map<string, DayLeave>()
  for (const lv of leave) {
    const days = Math.round((Date.parse(lv.end) - Date.parse(lv.start)) / 86_400_000) + 1
    for (const d of periodDates(lv.start, days)) {
      map.set(`${lv.staff_id}|${d}`, { kind: lv.kind === 'holiday' ? 'holiday' : lv.granted ? 'granted' : 'request', note: lv.note })
    }
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
    const lastKind = last && (last.kind === 'holiday' ? 'holiday' : last.granted ? 'granted' : 'request')
    if (last && last.staff_id === staff_id && lastKind === kind && last.note === note && nextDay(last.end) === date) {
      last.end = date
    } else {
      out.push({ staff_id, start: date, end: date, kind: kind === 'holiday' ? 'holiday' : 'request', granted: kind === 'granted', note })
    }
  }
  return out
}

function nextDay(date: ISODate): ISODate {
  return periodDates(date, 2)[1]
}

export function LeaveView({ project: p, setProject }: Props) {
  const dates = periodDates(p.period.start, p.period.days)
  const map = expand(p.leave)
  const holidays = new Set(p.public_holidays.map((h) => h.date))

  const cycle = (staffId: string, date: ISODate) => {
    const key = `${staffId}|${date}`
    const current = map.get(key)
    const next = CYCLE[(CYCLE.indexOf(current?.kind ?? null) + 1) % CYCLE.length]
    if (next) map.set(key, { kind: next, note: current?.note ?? '' })
    else map.delete(key)
    setProject({ ...p, leave: compress(map) })
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Leave and day-off requests</h2>
        <p className="hint">
          Click a cell to cycle: <span className="chip leave-request">R request</span> (soft, avoided if possible) →{' '}
          <span className="chip leave-granted">G granted</span> (binding) → <span className="chip leave-holiday">H reserved holiday</span> (binding, paid
          leave: lowers contract hours) → none.
        </p>
        <div className="grid-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="sticky name">Staff</th>
                {dates.map((d) => (
                  <th key={d} className={holidays.has(d) ? 'holiday' : weekday(d) >= 5 ? 'weekend' : ''}>
                    <div>{WEEKDAYS[weekday(d)].slice(0, 2)}</div>
                    <div>{shortDate(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.staff.map((s) => (
                <tr key={s.id}>
                  <th className="sticky name">{s.name}</th>
                  {dates.map((d) => {
                    const lv = map.get(`${s.id}|${d}`)
                    return (
                      <td
                        key={d}
                        className={`cell ${lv ? `leave-${lv.kind}` : ''} ${weekday(d) >= 5 ? 'weekend' : ''}`}
                        title={lv?.note}
                        onClick={() => cycle(s.id, d)}
                      >
                        {lv && LABEL[lv.kind]}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
