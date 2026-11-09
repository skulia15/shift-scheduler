import { useMemo, useState } from 'react'
import { PageHead } from '../components/fields'
import { AlertIcon, CheckIcon, CloseIcon } from '../components/icons'
import { longDate, periodDates, WEEKDAYS, weekday } from '../dates'
import { shiftColor } from '../shiftColors'
import { download } from '../store'
import type { Assignment, Evaluation, ISODate, Project, SolveResult, Violation } from '../types'

interface Props {
  project: Project
  roster: Assignment[]
  setRoster: (r: Assignment[]) => void
  evaluation: Evaluation | null
  solveInfo: Pick<SolveResult, 'status' | 'message' | 'solve_seconds'> | null
  busy: boolean
}

export function RosterView({ project, roster, setRoster, evaluation, solveInfo, busy }: Props) {
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
  const areaCode = new Map(project.areas.map((a) => [a.id, a.code]))
  const leaveKind = useMemo(() => {
    const map = new Map<string, string>()
    for (const lv of project.leave) {
      for (const d of periodDates(lv.start, daysBetween(lv.start, lv.end) + 1)) {
        map.set(`${lv.staff_id}|${d}`, lv.kind === 'holiday' ? 'holiday' : lv.granted ? 'granted' : 'request')
      }
    }
    return map
  }, [project.leave])

  const setCell = (staffId: string, date: ISODate, shiftId: string | null, taskIds: string[], areaId: string | null) => {
    const rest = roster.filter((a) => !(a.staff_id === staffId && a.date === date))
    setRoster(shiftId ? [...rest, { staff_id: staffId, date, shift_id: shiftId, task_ids: taskIds, area_id: areaId }] : rest)
  }

  const exportCsv = () => {
    const header = ['Name', ...dates.map((d) => `${WEEKDAYS[weekday(d)]} ${d}`)]
    const rows = project.staff.map((s) => [
      s.name,
      ...dates.map((d) => {
        const a = cell.get(`${s.id}|${d}`)
        if (!a) return ''
        const code = project.shift_types.find((t) => t.id === a.shift_id)?.code ?? a.shift_id
        const area = a.area_id ? (areaCode.get(a.area_id) ?? a.area_id) : null
        return [code, area, ...a.task_ids.map((t) => taskName.get(t) ?? t)].filter(Boolean).join(' ')
      }),
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n')
    download(`${project.name}.csv`, csv, 'text/csv')
  }

  // An empty roster breaks every coverage rule; listing them all is noise.
  const all = roster.length ? (evaluation?.violations ?? []) : []
  const errorCount = all.filter((v) => v.severity === 'error').length
  const warningCount = all.length - errorCount
  const violations = all.filter((v) => filter === 'all' || v.severity === filter)
  const shiftCoverage = (evaluation?.coverage ?? []).filter((c) => !c.area_id && !c.competence_id)
  const coverageMet = shiftCoverage.filter((c) => c.assigned >= c.required).length
  const shortDays = new Set(shiftCoverage.filter((c) => c.assigned < c.required).map((c) => c.date))
  const groupCounts = project.groups.map((g) => `${project.staff.filter((s) => s.group_ids[0] === g.id).length} ${g.name}`)
  const last = dates[dates.length - 1]

  return (
    <>
      <PageHead eyebrow={`${longDate(dates[0])} – ${longDate(last)} ${last.slice(0, 4)} · ${dates.length} days`} title={project.name}>
        {busy ? (
          <div className="status-pill busy">Generating roster…</div>
        ) : (
          solveInfo && (
            <div className={`status-pill ${solveInfo.status}`}>
              {solveInfo.status === 'optimal' || solveInfo.status === 'feasible' ? <CheckIcon /> : <AlertIcon />}
              {solveInfo.status === 'optimal'
                ? `Optimal roster found in ${solveInfo.solve_seconds} s`
                : solveInfo.status === 'feasible'
                  ? `Good roster found in ${solveInfo.solve_seconds} s`
                  : solveInfo.message}
            </div>
          )
        )}
      </PageHead>

      <section className="kpis no-print" aria-label="Summary">
        <div className="kpi">
          <span className="label">Staff rostered</span>
          <span className="value">{project.staff.length}</span>
          <span className="sub">{groupCounts.join(' · ')}</span>
        </div>
        <div className="kpi">
          <span className="label">Rule errors</span>
          <span className={`value ${errorCount ? 'error' : ''}`}>{errorCount}</span>
          <span className="sub">Hard rules broken</span>
        </div>
        <div className="kpi">
          <span className="label">Warnings</span>
          <span className={`value ${warningCount ? 'warn' : ''}`}>{warningCount}</span>
          <span className="sub">Soft rules penalised</span>
        </div>
        <div className="kpi dark">
          <span className="label">Coverage met</span>
          <span className="value">{roster.length ? `${coverageMet} / ${shiftCoverage.length}` : '—'}</span>
          <span className="sub">
            {!roster.length ? 'No roster yet' : shortDays.size ? `Short on ${shortDays.size} day${shortDays.size > 1 ? 's' : ''}` : 'Every shift fully staffed'}
          </span>
        </div>
      </section>

      <section className="card">
        <div className="row no-print">
          {project.shift_types.map((s, i) => {
            const c = shiftColor(i)
            return (
              <span key={s.id} className="chip" style={{ background: c.bg, color: c.fg }}>
                <b>{s.code}</b> {s.name} {s.start}–{s.end}
              </span>
            )
          })}
          <span className="divider" />
          <span className="chip">F Holiday</span>
          <span className="chip request">Day-off request</span>
          <span className="chip granted">Granted</span>
          <span className="spacer" />
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn ghost" onClick={() => confirm('Clear the whole roster?') && setRoster([])}>
            Clear
          </button>
        </div>

        <div className="grid-box">
          <table className="roster">
            <thead>
              <tr>
                <th className="name">Staff</th>
                {dates.map((d) => (
                  <th key={d} className={dayClass(d, holidays)} title={holidays.get(d)}>
                    {WEEKDAYS[weekday(d)].slice(0, 2)}
                    <span className="num">{Number(d.slice(8))}</span>
                  </th>
                ))}
                <th className="stat first">Hours</th>
                <th className="stat" title="Overtime hours">
                  OT
                </th>
                <th className="stat" title="Weekends worked">
                  WE
                </th>
              </tr>
            </thead>
            <tbody>
              {project.groups.map((g) => (
                <GroupRows key={g.id} label={g.name}>
                  {project.staff
                    .filter((s) => s.group_ids[0] === g.id)
                    .map((s) => {
                      const st = stats.get(s.id)
                      return (
                        <tr key={s.id}>
                          <th className="name">
                            {s.name} <span className="pct">{s.employment_percent}%</span>
                          </th>
                          {dates.map((d) => {
                            const key = `${s.id}|${d}`
                            const a = cell.get(key)
                            const vs = cellViolations.get(key) ?? []
                            const severity = vs.some((v) => v.severity === 'error') ? 'error' : vs.length ? 'warning' : ''
                            const t = a ? shiftIndex.get(a.shift_id) : undefined
                            const leave = leaveKind.get(key)
                            const color = t !== undefined ? shiftColor(t) : null
                            const sub = a
                              ? [a.area_id && (areaCode.get(a.area_id) ?? a.area_id), ...a.task_ids.map((id) => abbreviate(taskName.get(id) ?? id))]
                                  .filter(Boolean)
                                  .join('·')
                              : ''
                            return (
                              <td key={d} className={`slot ${dayClass(d, holidays)}`}>
                                <button
                                  type="button"
                                  data-staff={s.id}
                                  data-date={d}
                                  className={`shift-cell ${!a && leave ? `leave-${leave}` : ''} ${severity}`}
                                  style={color ? { background: color.bg, color: color.fg } : undefined}
                                  title={[
                                    leave && `Leave: ${leave}`,
                                    ...(a?.task_ids.map((id) => `Task: ${taskName.get(id) ?? id}`) ?? []),
                                    ...vs.map((v) => `${v.severity.toUpperCase()}: ${v.message}`),
                                  ]
                                    .filter(Boolean)
                                    .join('\n')}
                                  onClick={() => setEditing({ staffId: s.id, date: d })}
                                >
                                  {a ? (
                                    <>
                                      {project.shift_types[t ?? 0]?.code ?? a.shift_id}
                                      {sub && <small>{sub}</small>}
                                    </>
                                  ) : leave === 'holiday' ? (
                                    'F'
                                  ) : null}
                                </button>
                              </td>
                            )
                          })}
                          <td className={`stat first ${st && Math.abs(st.credited_hours - st.target_hours) >= 8 ? 'warn' : ''}`}>
                            {st ? `${st.credited_hours.toFixed(0)} / ${st.target_hours.toFixed(0)}` : ''}
                          </td>
                          <td className={`stat ${st && st.overtime_hours >= 1 ? 'warn' : 'dim'}`}>{st ? st.overtime_hours.toFixed(1) : ''}</td>
                          <td className="stat">{st?.weekends_worked ?? ''}</td>
                        </tr>
                      )
                    })}
                </GroupRows>
              ))}
              <GroupRows label="Coverage · assigned / required">
                {project.shift_types.flatMap((shift) =>
                  project.groups.map((g) => (
                    <CoverageRow
                      key={`${shift.id}-${g.id}`}
                      label={`${shift.code} · ${g.name}`}
                      dates={dates}
                      holidays={holidays}
                      cells={(evaluation?.coverage ?? []).filter((c) => c.shift_id === shift.id && c.group_id === g.id && !c.area_id && !c.competence_id)}
                    />
                  )),
                )}
                {project.areas.flatMap((area) =>
                  project.shift_types.flatMap((shift) =>
                    project.groups.map((g) => (
                      <CoverageRow
                        key={`${area.id}-${shift.id}-${g.id}`}
                        label={`${area.name} · ${shift.code} · ${g.name}`}
                        dates={dates}
                        holidays={holidays}
                        cells={(evaluation?.coverage ?? []).filter((c) => c.area_id === area.id && c.shift_id === shift.id && c.group_id === g.id)}
                      />
                    )),
                  ),
                )}
                {project.competences.flatMap((comp) =>
                  [null, ...project.areas].flatMap((area) =>
                    project.shift_types.map((shift) => (
                      <CoverageRow
                        key={`${comp.id}-${area?.id ?? 'all'}-${shift.id}`}
                        label={`${comp.name}${area ? ` · ${area.name}` : ''} · ${shift.code}`}
                        dates={dates}
                        holidays={holidays}
                        cells={(evaluation?.coverage ?? []).filter(
                          (c) => c.competence_id === comp.id && c.shift_id === shift.id && (c.area_id ?? null) === (area?.id ?? null),
                        )}
                      />
                    )),
                  ),
                )}
              </GroupRows>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card no-print">
        <div className="card-head">
          <h2>Rule check</h2>
          <div className="segmented" role="group" aria-label="Filter">
            {(
              [
                ['all', `All ${all.length}`],
                ['error', `Errors ${errorCount}`],
                ['warning', `Warnings ${warningCount}`],
              ] as const
            ).map(([value, label]) => (
              <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {roster.length === 0 && <p className="empty">No roster yet — press “Generate roster”, or click cells to build one by hand.</p>}
        {roster.length > 0 && violations.length === 0 && <p className="empty">Nothing to report.</p>}
        <ul className="violations">
          {violations.map((v, i) => (
            <li key={i} className={v.severity}>
              <span className="dot" />
              <span className="rule-tag">{v.rule}</span>
              {v.date && <span className="when">{`${WEEKDAYS[weekday(v.date)].slice(0, 2)} ${longDate(v.date)}`}</span>}
              <span className="msg">{v.message}</span>
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
          onSave={(shiftId, taskIds, areaId) => {
            setCell(editing.staffId, editing.date, shiftId, taskIds, areaId)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function GroupRows({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <th colSpan={999}>{label}</th>
      </tr>
      {children}
    </>
  )
}

function CoverageRow({ label, dates, holidays, cells }: { label: string; dates: ISODate[]; holidays: Map<string, string>; cells: Evaluation['coverage'] }) {
  if (cells.length === 0) return null
  const byDate = new Map(cells.map((c) => [c.date, c]))
  return (
    <tr className="coverage">
      <th className="name">{label}</th>
      {dates.map((d) => {
        const c = byDate.get(d)
        const short = c && c.assigned < c.required
        return (
          <td key={d} className={short ? 'short' : dayClass(d, holidays)}>
            {c ? `${c.assigned}/${c.required}` : ''}
          </td>
        )
      })}
      <td colSpan={3} />
    </tr>
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
  onSave: (shiftId: string | null, taskIds: string[], areaId: string | null) => void
  onClose: () => void
}) {
  const staff = project.staff.find((s) => s.id === staffId)!
  const [shiftId, setShiftId] = useState<string | null>(assignment?.shift_id ?? null)
  const [taskId, setTaskId] = useState<string>(assignment?.task_ids[0] ?? '')
  const [areaId, setAreaId] = useState<string>(assignment?.area_id ?? '')
  const tasks = project.tasks.filter((t) => staff.group_ids.includes(t.group_id) && (!t.competence_id || staff.competence_ids.includes(t.competence_id)))
  const group = project.groups.find((g) => g.id === staff.group_ids[0])
  const dayName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekday(date)]

  const options = [
    { id: null as string | null, code: '–', name: 'Off', time: 'No shift', color: { bg: '#e7e5da', fg: '#4d474e' }, allowed: true },
    ...project.shift_types.map((s, i) => ({
      id: s.id as string | null,
      code: s.code,
      name: s.name,
      time: `${s.start}–${s.end}`,
      color: shiftColor(i),
      allowed: staff.allowed_shift_ids === null || staff.allowed_shift_ids.includes(s.id),
    })),
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-labelledby="cell-editor-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">
              {dayName} {longDate(date)}
            </p>
            <h2 id="cell-editor-title">{staff.name}</h2>
            <p className="hint">
              {group?.name} · {staff.employment_percent}%
            </p>
          </div>
          <button type="button" className="icon-btn close" aria-label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        <fieldset>
          <legend>Shift</legend>
          <div className="shift-options">
            {options.map((o) => (
              <button
                key={o.id ?? 'off'}
                type="button"
                aria-pressed={shiftId === o.id}
                disabled={!o.allowed}
                className={shiftId === o.id ? 'shift-option active' : 'shift-option'}
                onClick={() => setShiftId(o.id)}
              >
                <span className="badge" style={{ background: o.color.bg, color: o.color.fg }}>
                  {o.code}
                </span>
                <span>
                  <span className="name">{o.name}</span>
                  <span className="time">{o.time}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {shiftId && project.areas.length > 0 && (
          <label className="field">
            Area
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">— none —</option>
              {project.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {shiftId && tasks.length > 0 && (
          <label className="field">
            Task
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

        {violations.map((v, i) => (
          <div key={i} className={`alert ${v.severity}`}>
            <AlertIcon />
            <span>{v.message}</span>
          </div>
        ))}

        <div className="modal-actions">
          <button className="btn lg" onClick={onClose}>
            Cancel
          </button>
          <button className="btn plum lg" onClick={() => onSave(shiftId, shiftId && taskId ? [taskId] : [], shiftId && areaId ? areaId : null)}>
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
