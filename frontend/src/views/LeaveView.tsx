import { PageHead, Section } from '../components/fields'
import { ArrowIcon } from '../components/icons'
import { longDate, monthShort, periodDates, WEEKDAYS, weekday } from '../dates'
import type { ISODate, Leave, Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

type Kind = 'request' | 'granted' | 'holiday'
const CYCLE: (Kind | null)[] = [null, 'request', 'granted', 'holiday']
const LABEL: Record<Kind, string> = { request: 'R', granted: 'G', holiday: 'H' }
const NAME: Record<Kind, string> = { request: 'Request', granted: 'Granted', holiday: 'Holiday' }
const CHIP: Record<Kind, string> = { request: 'chip request', granted: 'chip granted', holiday: 'chip' }

interface DayLeave {
  kind: Kind
  note: string
}

function kindOf(lv: Leave): Kind {
  return lv.kind === 'holiday' ? 'holiday' : lv.granted ? 'granted' : 'request'
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
      out.push({ staff_id, start: date, end: date, kind: kind === 'holiday' ? 'holiday' : 'request', granted: kind === 'granted', note })
    }
  }
  return out
}

export function LeaveView({ project: p, setProject }: Props) {
  const dates = periodDates(p.period.start, p.period.days)
  const map = expand(p.leave)
  const holidays = new Set(p.public_holidays.map((h) => h.date))
  const staffName = new Map(p.staff.map((s) => [s.id, s.name]))
  const inPeriod = p.leave
    .filter((lv) => lv.end >= dates[0] && lv.start <= dates[dates.length - 1])
    .sort((a, b) => a.start.localeCompare(b.start))

  const cycle = (staffId: string, date: ISODate) => {
    const key = `${staffId}|${date}`
    const current = map.get(key)
    const next = CYCLE[(CYCLE.indexOf(current?.kind ?? null) + 1) % CYCLE.length]
    if (next) map.set(key, { kind: next, note: current?.note ?? '' })
    else map.delete(key)
    setProject({ ...p, leave: compress(map) })
  }

  return (
    <>
      <PageHead eyebrow="Leave" title="Holidays and day-off requests">
        <div className="legend-flow">
          <span>Click a day to cycle</span>
          <span className="chip request">R Request</span>
          <ArrowIcon />
          <span className="chip granted">G Granted</span>
          <ArrowIcon />
          <span className="chip">H Holiday</span>
        </div>
      </PageHead>

      <section className="card">
        <p className="hint" style={{ margin: 0 }}>
          A request is avoided where possible. Granted requests and reserved holidays are never scheduled over; holidays are paid leave and lower
          contract hours.
        </p>
        <div className="grid-box">
          <table className="roster">
            <thead>
              <tr>
                <th className="name">Staff</th>
                {dates.map((d) => (
                  <th key={d} className={holidays.has(d) ? 'holiday' : weekday(d) >= 5 ? 'weekend' : ''}>
                    {WEEKDAYS[weekday(d)].slice(0, 2)}
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
                    return (
                      <td key={d} className={`slot ${holidays.has(d) ? 'holiday' : weekday(d) >= 5 ? 'weekend' : ''}`}>
                        <button
                          type="button"
                          className={`leave-cell ${lv?.kind ?? ''}`}
                          aria-label={`${s.name}, ${longDate(d)}: ${lv ? NAME[lv.kind] : 'no leave'}`}
                          title={lv?.note || undefined}
                          onClick={() => cycle(s.id, d)}
                        >
                          {lv && LABEL[lv.kind]}
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
          <Section title="This period" count={inPeriod.length}>
            {inPeriod.length === 0 && <p className="empty">No leave or requests yet.</p>}
            <ul className="violations" style={{ maxHeight: 'none' }}>
              {inPeriod.map((lv, i) => {
                const k = kindOf(lv)
                return (
                  <li key={i} style={{ background: 'var(--cream)' }}>
                    <span className={CHIP[k]}>{NAME[k]}</span>
                    <b>{staffName.get(lv.staff_id) ?? lv.staff_id}</b>
                    <span className="when">{lv.start === lv.end ? longDate(lv.start) : `${longDate(lv.start)} – ${longDate(lv.end)}`}</span>
                    <input
                      className="msg"
                      placeholder="Note"
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
          <Section title="Public holidays" hint="Edit under Setup.">
            {p.public_holidays.length === 0 && <p className="empty">None in this period.</p>}
            {p.public_holidays.map((h) => (
              <div key={h.date} className="row">
                <span className="badge" style={{ background: 'var(--lime-soft)', color: 'var(--lime-soft-ink)', flexDirection: 'column', fontSize: 10, lineHeight: 1, width: 44, height: 44 }}>
                  {monthShort(h.date)}
                  <b style={{ fontSize: 16 }}>{Number(h.date.slice(8))}</b>
                </span>
                <span style={{ fontWeight: 600, flex: '1 1 0' }}>
                  {h.name} {h.major && <span className="chip hard">Stórhátíð</span>}
                </span>
                <span className="muted">−{h.duty_reduction_hours} h duty</span>
              </div>
            ))}
          </Section>
        </div>
      </div>
    </>
  )
}
