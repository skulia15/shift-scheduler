import { useMemo, useState } from 'react'
import { periodDates, shortDate, WEEKDAYS, weekday } from '../dates'
import { download } from '../store'
import type { Assignment, Evaluation, ISODate, Project, Violation } from '../types'

interface Props {
  project: Project
  roster: Assignment[]
  setRoster: (r: Assignment[]) => void
  evaluation: Evaluation | null
}

const SHIFT_COLORS = ['#dbeafe', '#fde68a', '#c7d2fe', '#bbf7d0', '#fbcfe8', '#fed7aa']

export function RosterView({ project, roster, setRoster, evaluation }: Props) {
  const dates = useMemo(() => periodDates(project.period.start, project.period.days), [project.period])
  const [editing, setEditing] = useState<{ staffId: string; date: ISODate } | null>(null)
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all')

  const cell = useMemo(() => {
    const map = new Map<string, Assignment>()
    for (const a of roster) map.set(`${a.staff_id}|${a.date}`, a)
    return map
  }, [roster])

  const cellViolations = useMemo(() => {
    const map = new Map<string, Violation[]>()
    for (const v of evaluation?.violations ?? []) {
      if (!v.staff_id || !v.date) continue
      const key = `${v.staff_id}|${v.date}`
      map.set(key, [...(map.get(key) ?? []), v])
    }
    return map
  }, [evaluation])

  const stats = new Map((evaluation?.staff ?? []).map((s) => [s.staff_id, s]))
  const shiftIndex = new Map(project.shift_types.map((s, i) => [s.id, i]))
  const holidays = new Map(project.public_holidays.map((h) => [h.date, h.name]))
  const taskName = new Map(project.tasks.map((t) => [t.id, t.name]))
  const leaveKind = useMemo(() => {
    const map = new Map<string, string>()
    for (const lv of project.leave) {
      for (const d of periodDates(lv.start, daysBetween(lv.start, lv.end) + 1)) {
        map.set(`${lv.staff_id}|${d}`, lv.kind === 'holiday' ? 'holiday' : lv.granted ? 'granted' : 'request')
      }
    }
    return map
  }, [project.leave])

  const setCell = (staffId: string, date: ISODate, shiftId: string | null, taskIds: string[] = []) => {
    const rest = roster.filter((a) => !(a.staff_id === staffId && a.date === date))
    setRoster(shiftId ? [...rest, { staff_id: staffId, date, shift_id: shiftId, task_ids: taskIds }] : rest)
  }

  const exportCsv = () => {
    const header = ['Name', ...dates.map((d) => `${WEEKDAYS[weekday(d)]} ${d}`)]
    const rows = project.staff.map((s) => [
      s.name,
      ...dates.map((d) => {
        const a = cell.get(`${s.id}|${d}`)
        if (!a) return ''
        const code = project.shift_types.find((t) => t.id === a.shift_id)?.code ?? a.shift_id
        return [code, ...a.task_ids.map((t) => taskName.get(t) ?? t)].join(' ')
      }),
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n')
    download(`${project.name}.csv`, csv, 'text/csv')
  }

  const violations = (evaluation?.violations ?? []).filter((v) => filter === 'all' || v.severity === filter)
  const errorCount = evaluation?.violations.filter((v) => v.severity === 'error').length ?? 0
  const warningCount = (evaluation?.violations.length ?? 0) - errorCount

  return (
    <div>
      <div className="toolbar no-print">
        <span className="legend">
          {project.shift_types.map((s, i) => (
            <span key={s.id} className="chip" style={{ background: SHIFT_COLORS[i % SHIFT_COLORS.length] }}>
              {s.code} {s.name} {s.start}–{s.end}
            </span>
          ))}
          <span className="chip leave-holiday">Holiday</span>
          <span className="chip leave-request">Day-off request</span>
          <span className="chip leave-granted">Granted</span>
        </span>
        <span className="spacer" />
        <span className={errorCount ? 'count error' : 'count ok'}>{errorCount} errors</span>
        <span className="count warning">{warningCount} warnings</span>
        <button onClick={exportCsv}>Export CSV</button>
        <button onClick={() => window.print()}>Print</button>
        <button onClick={() => confirm('Clear the whole roster?') && setRoster([])}>Clear</button>
      </div>

      <div className="grid-wrap">
        <table className="roster">
          <thead>
            <tr>
              <th className="sticky name">Staff</th>
              {dates.map((d) => (
                <th key={d} className={dayClass(d, holidays)} title={holidays.get(d)}>
                  <div>{WEEKDAYS[weekday(d)].slice(0, 2)}</div>
                  <div>{shortDate(d)}</div>
                </th>
              ))}
              <th title="Shifts">#</th>
              <th title="Credited hours (with weighting) / contract target">Hours</th>
              <th title="Overtime hours">OT</th>
              <th title="Weekends worked">WE</th>
            </tr>
          </thead>
          <tbody>
            {project.groups.map((g) => (
              <GroupRows key={g.id} groupName={g.name}>
                {project.staff
                  .filter((s) => s.group_ids[0] === g.id)
                  .map((s) => {
                    const st = stats.get(s.id)
                    return (
                      <tr key={s.id}>
                        <th className="sticky name">
                          {s.name} <span className="muted">{s.employment_percent}%</span>
                        </th>
                        {dates.map((d) => {
                          const key = `${s.id}|${d}`
                          const a = cell.get(key)
                          const vs = cellViolations.get(key) ?? []
                          const severity = vs.some((v) => v.severity === 'error') ? 'error' : vs.length ? 'warning' : ''
                          const t = a ? shiftIndex.get(a.shift_id) : undefined
                          return (
                            <td
                              key={d}
                              className={`cell ${dayClass(d, holidays)} ${severity} leave-${leaveKind.get(key) ?? 'none'}`}
                              style={t !== undefined ? { background: SHIFT_COLORS[t % SHIFT_COLORS.length] } : undefined}
                              title={[
                                leaveKind.get(key) && `Leave: ${leaveKind.get(key)}`,
                                ...a?.task_ids.map((id) => `Task: ${taskName.get(id) ?? id}`) ?? [],
                                ...vs.map((v) => `${v.severity.toUpperCase()}: ${v.message}`),
                              ]
                                .filter(Boolean)
                                .join('\n')}
                              onClick={() => setEditing({ staffId: s.id, date: d })}
                            >
                              {a && (
                                <>
                                  <b>{project.shift_types[t ?? 0]?.code ?? a.shift_id}</b>
                                  {a.task_ids.length > 0 && <small>{a.task_ids.map((id) => abbreviate(taskName.get(id) ?? id)).join(' ')}</small>}
                                </>
                              )}
                            </td>
                          )
                        })}
                        <td className="num">{st?.shifts ?? ''}</td>
                        <td className={`num ${st && Math.abs(st.credited_hours - st.target_hours) >= 8 ? 'warn-text' : ''}`}>
                          {st ? `${st.credited_hours.toFixed(1)} / ${st.target_hours.toFixed(1)}` : ''}
                        </td>
                        <td className={`num ${st && st.overtime_hours >= 1 ? 'warn-text' : ''}`}>{st ? st.overtime_hours.toFixed(1) : ''}</td>
                        <td className="num">{st?.weekends_worked ?? ''}</td>
                      </tr>
                    )
                  })}
              </GroupRows>
            ))}
            <tr className="group-row">
              <th className="sticky name" colSpan={1}>
                Coverage (assigned / required)
              </th>
              <td colSpan={dates.length + 4} />
            </tr>
            {project.shift_types.flatMap((shift) =>
              project.groups.map((g) => {
                const cells = new Map(
                  (evaluation?.coverage ?? []).filter((c) => c.shift_id === shift.id && c.group_id === g.id).map((c) => [c.date, c]),
                )
                if (cells.size === 0) return null
                return (
                  <tr key={`${shift.id}-${g.id}`} className="coverage">
                    <th className="sticky name">
                      {shift.code} · {g.name}
                    </th>
                    {dates.map((d) => {
                      const c = cells.get(d)
                      return (
                        <td key={d} className={`num ${dayClass(d, holidays)} ${c && c.assigned < c.required ? 'short' : ''}`}>
                          {c ? `${c.assigned}/${c.required}` : ''}
                        </td>
                      )
                    })}
                    <td colSpan={4} />
                  </tr>
                )
              }),
            )}
          </tbody>
        </table>
      </div>

      <section className="card no-print">
        <h2>
          Rule check{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
          </select>
        </h2>
        {roster.length === 0 && <p className="hint">No roster yet — press “Generate roster”, or click cells to build one by hand.</p>}
        <ul className="violations">
          {violations.map((v, i) => (
            <li key={i} className={v.severity}>
              <span className="tag">{v.rule}</span>
              {v.date && <span className="muted">{shortDate(v.date)} </span>}
              {v.message}
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <CellEditor
          project={project}
          assignment={cell.get(`${editing.staffId}|${editing.date}`)}
          staffId={editing.staffId}
          date={editing.date}
          violations={cellViolations.get(`${editing.staffId}|${editing.date}`) ?? []}
          onSave={(shiftId, taskIds) => {
            setCell(editing.staffId, editing.date, shiftId, taskIds)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function GroupRows({ groupName, children }: { groupName: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <th className="sticky name">{groupName}</th>
        <td colSpan={999} />
      </tr>
      {children}
    </>
  )
}

function CellEditor({
  project,
  assignment,
  staffId,
  date,
  violations,
  onSave,
  onClose,
}: {
  project: Project
  assignment?: Assignment
  staffId: string
  date: ISODate
  violations: Violation[]
  onSave: (shiftId: string | null, taskIds: string[]) => void
  onClose: () => void
}) {
  const staff = project.staff.find((s) => s.id === staffId)!
  const [shiftId, setShiftId] = useState<string | null>(assignment?.shift_id ?? null)
  const [taskId, setTaskId] = useState<string>(assignment?.task_ids[0] ?? '')
  const tasks = project.tasks.filter((t) => staff.group_ids.includes(t.group_id))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {staff.name} — {WEEKDAYS[weekday(date)]} {shortDate(date)}
        </h3>
        <div className="shift-picker">
          <button className={shiftId === null ? 'active' : ''} onClick={() => setShiftId(null)}>
            Off
          </button>
          {project.shift_types.map((s) => (
            <button
              key={s.id}
              className={shiftId === s.id ? 'active' : ''}
              disabled={staff.allowed_shift_ids !== null && !staff.allowed_shift_ids.includes(s.id)}
              onClick={() => setShiftId(s.id)}
            >
              {s.code} · {s.name}
            </button>
          ))}
        </div>
        {shiftId && tasks.length > 0 && (
          <label>
            Task{' '}
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">— none —</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {violations.length > 0 && (
          <ul className="violations">
            {violations.map((v, i) => (
              <li key={i} className={v.severity}>
                {v.message}
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(shiftId, shiftId && taskId ? [taskId] : [])}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

function dayClass(date: ISODate, holidays: Map<string, string>): string {
  if (holidays.has(date)) return 'holiday'
  return weekday(date) >= 5 ? 'weekend' : ''
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

function abbreviate(name: string): string {
  return name.slice(0, 3)
}
