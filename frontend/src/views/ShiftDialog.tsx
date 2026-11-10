import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { CloseIcon, ErrorDot, WarnDot } from '../components/icons'
import { useI18n } from '../i18n'
import { shiftColor } from '../shiftColors'
import type { Assignment, Evaluation, ISODate, Project, Violation } from '../types'

interface Props {
  project: Project
  roster: Assignment[]
  evaluation: Evaluation | null
  staffId: string
  date: ISODate
  onApply: (a: Omit<Assignment, 'staff_id' | 'date'> | null) => void
  onMarkSick: () => void
  onClose: () => void
}

interface Effect {
  severity: 'error' | 'warning' | 'ok' | 'pending'
  text: string
}

const MS_DAY = 86_400_000
const addDays = (d: ISODate, n: number) => new Date(Date.parse(d) + n * MS_DAY).toISOString().slice(0, 10)
const clock = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
const key = (v: Violation) => `${v.rule}|${v.staff_id}|${v.date}|${v.shift_id}|${v.message}`

/** Edit one cell. Each shift option shows what choosing it would do to the rule check. */
export function ShiftDialog({ project, roster, evaluation, staffId, date, onApply, onMarkSick, onClose }: Props) {
  const i = useI18n()
  const { t } = i
  const staff = project.staff.find((s) => s.id === staffId)!
  const current = roster.find((a) => a.staff_id === staffId && a.date === date)
  const [shiftId, setShiftId] = useState<string | null>(current?.shift_id ?? null)
  const [taskId, setTaskId] = useState<string>(current?.task_ids[0] ?? '')
  const [areaId, setAreaId] = useState<string>(current?.area_id ?? '')
  const [locked, setLocked] = useState(true)
  const [effects, setEffects] = useState<Record<string, Effect>>({})
  const tasks = project.tasks.filter((x) => staff.group_ids.includes(x.group_id) && (!x.competence_id || staff.competence_ids.includes(x.competence_id)))
  const group = project.groups.find((g) => g.id === staff.group_ids[0])
  const usesAreas = project.areas.length > 0 && (project.area_demand.some((d) => staff.group_ids.includes(d.group_id)) || project.custom_rules.some((r) => r.type === 'fixed_area' && r.staff_id === staffId))

  const options = useMemo(
    () => [
      { id: null as string | null, code: t('Off'), name: t('Off'), time: '', color: { bg: '#e6ebe9', fg: '#2d3538' }, allowed: true },
      ...project.shift_types.map((s, idx) => ({
        id: s.id as string | null,
        code: s.code,
        name: s.name,
        time: i.timeRange(s.start, s.end),
        color: shiftColor(idx),
        allowed: staff.allowed_shift_ids === null || staff.allowed_shift_ids.includes(s.id),
      })),
    ],
    [project.shift_types, staff.allowed_shift_ids, i, t],
  )

  // Preview: check the roster with each option and describe what changes around this person and day.
  useEffect(() => {
    if (!evaluation) return
    let cancelled = false
    const near = (v: Violation) =>
      (v.staff_id === staffId && (!v.date || Math.abs(Date.parse(v.date) - Date.parse(date)) <= MS_DAY)) || (!v.staff_id && v.date === date)
    const before = evaluation.violations.filter(near)
    const beforeKeys = new Set(before.map(key))
    const rest = roster.filter((a) => !(a.staff_id === staffId && a.date === date))
    for (const o of options) {
      if (!o.allowed) continue
      const id = o.id ?? 'off'
      const trial = o.id ? [...rest, { staff_id: staffId, date, shift_id: o.id, task_ids: [], area_id: null }] : rest
      api.validate(project, trial).then((ev) => {
        if (cancelled) return
        const after = ev.violations.filter(near).filter((v) => !(v.rule === 'task_coverage' || v.rule === 'area_missing'))
        const afterKeys = new Set(after.map(key))
        const added = after.filter((v) => !beforeKeys.has(key(v)))
        const cleared = before.filter((v) => !afterKeys.has(key(v)) && v.severity === 'error')
        let effect: Effect
        const newError = added.find((v) => v.severity === 'error')
        const newWarn = added.find((v) => v.severity === 'warning')
        if (newError) effect = { severity: 'error', text: newError.message }
        else if (newWarn) effect = { severity: 'warning', text: newWarn.message }
        else if (cleared.length) effect = { severity: 'ok', text: t('Clears: {what}', { what: cleared[0].message }) }
        else effect = { severity: 'ok', text: (current?.shift_id ?? null) === o.id ? t('Current choice, no new problems.') : t('No new problems.') }
        setEffects((e) => ({ ...e, [id]: effect }))
      })
    }
    return () => {
      cancelled = true
    }
    // Only on open: the preview describes the roster as it is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = () =>
    onApply(shiftId ? { shift_id: shiftId, task_ids: taskId ? [taskId] : [], area_id: areaId || null, locked } : null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') {
        e.preventDefault()
        apply()
      }
    }
    // Attach after the keystroke that opened the dialog has finished, or its Enter would apply at once.
    const timer = setTimeout(() => window.addEventListener('keydown', onKey), 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  })

  const neighbour = (d: ISODate) => {
    const a = roster.find((x) => x.staff_id === staffId && x.date === d)
    const s = a ? project.shift_types.find((x) => x.id === a.shift_id) : undefined
    const crosses = s && clock(s.end) <= clock(s.start)
    return (
      <div key={d}>
        <span className="day">{i.day(d)}</span>
        <span className="what">{s ? `${s.code} · ${s.name}` : t('Off')}</span>
        {crosses && <span className="note">{t('ends {day} {time}', { day: i.weekday(addDays(d, 1)), time: s!.end })}</span>}
      </div>
    )
  }
  const chosen = options.find((o) => o.id === shiftId)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-sub" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="dlg-title">{staff.name}</h2>
            <p id="dlg-sub" className="muted" style={{ margin: '4px 0 0' }}>
              {i.day(date)} · {group?.name} · {staff.employment_percent}%{current?.locked ? ` · ${t('locked edit')}` : ''}
            </p>
          </div>
          <button type="button" className="icon-btn close" aria-label={t('Close without saving')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="neighbours" aria-label={t('Surrounding days')}>
          {neighbour(addDays(date, -1))}
          <div className="current">
            <span className="day">{i.day(date)}</span>
            <span className="what">{chosen?.id ? `${chosen.code} · ${chosen.name}` : t('Off')}</span>
          </div>
          {neighbour(addDays(date, 1))}
        </div>

        <fieldset>
          <legend>{t('Shift')}</legend>
          <div className="shift-options" role="radiogroup" aria-label={t('Shift')}>
            {options.map((o) => {
              const effect = effects[o.id ?? 'off']
              return (
                <button
                  key={o.id ?? 'off'}
                  type="button"
                  role="radio"
                  aria-checked={shiftId === o.id}
                  disabled={!o.allowed}
                  className="shift-option"
                  onClick={() => setShiftId(o.id)}
                >
                  <span className="badge lg" style={{ background: o.color.bg, color: o.color.fg, fontSize: o.id ? 16 : 12 }}>
                    {o.code}
                  </span>
                  <span className="text">
                    <span className="name">
                      {o.name} <span className="time">{o.time}</span>
                    </span>
                    <span className={`effect ${o.allowed ? (effect?.severity ?? 'pending') : 'pending'}`}>
                      {!o.allowed ? t('Not allowed for {name}', { name: staff.name }) : (effect?.text ?? t('Checking…'))}
                    </span>
                  </span>
                  {effect?.severity === 'error' && <ErrorDot size={16} />}
                  {effect?.severity === 'warning' && <WarnDot size={16} />}
                </button>
              )
            })}
          </div>
        </fieldset>

        {shiftId && (tasks.length > 0 || usesAreas) && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            {tasks.length > 0 && (
              <fieldset style={{ flex: '1 1 220px' }}>
                <legend>
                  {t('Task')} <span className="muted">{t('one per shift')}</span>
                </legend>
                <div className="segmented" role="radiogroup" aria-label={t('Task')}>
                  {[{ id: '', name: t('No task') }, ...tasks].map((x) => (
                    <button key={x.id} type="button" role="radio" aria-checked={taskId === x.id} onClick={() => setTaskId(x.id)}>
                      {x.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {usesAreas ? (
              <fieldset style={{ flex: '1 1 200px' }}>
                <legend>{t('Area')}</legend>
                <div className="segmented" role="radiogroup" aria-label={t('Area')}>
                  {[{ id: '', name: t('None') }, ...project.areas].map((a) => (
                    <button key={a.id} type="button" role="radio" aria-checked={areaId === a.id} onClick={() => setAreaId(a.id)}>
                      {a.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              project.areas.length > 0 && (
                <div style={{ flex: '1 1 200px' }}>
                  <span className="field" style={{ marginBottom: 8 }}>
                    {t('Area')}
                  </span>
                  <span className="muted">{t('Not used for {group}.', { group: group?.name ?? '' })}</span>
                </div>
              )
            )}
          </div>
        )}

        {shiftId && (
          <label className="row">
            <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
            {t('Keep locked so regenerating doesn’t change it')}
          </label>
        )}

        <div className="modal-actions">
          <span className="keys">{t('Esc cancels · Enter applies')}</span>
          {current && (
            <button className="btn ghost" onClick={onMarkSick} title={t('Adds sick leave for this day; press Repair to cover it')}>
              {t('Mark sick')}
            </button>
          )}
          <button className="btn lg" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary lg" onClick={apply}>
            {t('Apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
