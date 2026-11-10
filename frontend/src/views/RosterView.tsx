import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunMode } from '../App'
import { api } from '../api'
import { PageHead } from '../components/fields'
import { AlertIcon, CheckIcon, CloseIcon, DotsIcon, ErrorDot, LockIcon, RefreshIcon, UndoIcon, WarnDot } from '../components/icons'
import { periodDates, weekday } from '../dates'
import { useI18n } from '../i18n'
import { describeRule } from '../rules'
import { holidayNote } from '../holidayNotes'
import { KINDS, shiftColor, shiftKind } from '../shiftColors'
import { download } from '../store'
import type { Assignment, Change, CoverageCell, Evaluation, ISODate, ImportResult, LedgerEntry, Project, SolveResult, Violation, WishResult, WorkbookImport } from '../types'
import { ShiftDialog } from './ShiftDialog'

interface Props {
  project: Project
  roster: Assignment[]
  setRoster: (r: Assignment[]) => void
  evaluation: Evaluation | null
  solveInfo: (Pick<SolveResult, 'status' | 'solve_seconds'> & { mode: RunMode }) | null
  busy: RunMode | null
  run: (mode: RunMode) => void
  undo: () => void
  undoCount: number
  changes: Change[] | null
  asOf: ISODate
  setAsOf: (d: ISODate) => void
  setProject: (p: Project) => void
  onLoadDemo: () => void
  onNextPeriod: () => void
  onReplaceUnit: (project: Project, roster: Assignment[]) => void
  openPerson: (staffId: string) => void
}

type Selection = { kind: 'person'; staffId: string; date: ISODate } | { kind: 'cov'; row: string; date: ISODate } | null

interface CovRow {
  key: string
  code: string
  shiftIndex: number
  label: string
  cells: Map<ISODate, CoverageCell>
  sample: CoverageCell
}

const MS_DAY = 86_400_000
const addDays = (d: ISODate, n: number) => new Date(Date.parse(d) + n * MS_DAY).toISOString().slice(0, 10)
const clock = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

export function RosterView(props: Props) {
  const { project, roster, setRoster, evaluation, solveInfo, busy, run, undo, undoCount, changes, asOf, setAsOf, setProject } = props
  const i = useI18n()
  const { t } = i
  const dates = useMemo(() => periodDates(project.period.start, project.period.days), [project.period])
  const pastDates = useMemo(() => (project.history.length ? periodDates(addDays(project.period.start, -7), 7) : []), [project.history.length, project.period.start])
  const past = useMemo(() => new Map(project.history.map((a) => [`${a.staff_id}|${a.date}`, a])), [project.history])

  const [sel, setSel] = useState<Selection>(null)
  const [editing, setEditing] = useState<{ staffId: string; date: ISODate } | null>(null)
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all')
  const [showAllCov, setShowAllCov] = useState(false)
  const [regenOpen, setRegenOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [importReport, setImportReport] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [workbook, setWorkbook] = useState<WorkbookImport | null>(null)
  const workbookInput = useRef<HTMLInputElement>(null)
  const importWorkbook = async (file: File) => {
    setImportError(null)
    try {
      setWorkbook(await api.importWorkbook(file))
    } catch (e) {
      setImportError(String((e as Error).message ?? e))
    }
  }
  const gridRef = useRef<HTMLDivElement>(null)
  // "Unlock that cell and regenerate": regenerate once the unlocked roster has been saved.
  const [unlockThenRegenerate, setUnlockThenRegenerate] = useState(false)
  useEffect(() => {
    if (!unlockThenRegenerate) return
    setUnlockThenRegenerate(false)
    run('regenerate')
  }, [unlockThenRegenerate, run])

  const cell = useMemo(() => {
    const map = new Map<string, Assignment>()
    for (const a of roster) map.set(`${a.staff_id}|${a.date}`, a)
    return map
  }, [roster])
  const changed = useMemo(() => new Set((changes ?? []).map((c) => `${c.staff_id}|${c.date}`)), [changes])
  const violations = useMemo(() => (roster.length ? (evaluation?.violations ?? []) : []), [roster.length, evaluation])
  const cellViolations = useMemo(() => {
    const map = new Map<string, Violation[]>()
    for (const v of violations) {
      if (!v.staff_id || !v.date) continue
      const key = `${v.staff_id}|${v.date}`
      map.set(key, [...(map.get(key) ?? []), v])
    }
    return map
  }, [violations])
  const stats = new Map((evaluation?.staff ?? []).map((s) => [s.staff_id, s]))
  const shiftIndex = new Map(project.shift_types.map((s, idx) => [s.id, idx]))
  const shiftById = new Map(project.shift_types.map((s) => [s.id, s]))
  const holidays = new Map(project.public_holidays.map((h) => [h.date, h]))
  const taskName = new Map(project.tasks.map((x) => [x.id, x.name]))
  const areaCode = new Map(project.areas.map((a) => [a.id, a.code]))
  const groupName = new Map(project.groups.map((g) => [g.id, g.name]))
  const staffById = new Map(project.staff.map((s) => [s.id, s]))
  const leaveKind = useMemo(() => {
    const map = new Map<string, 'request' | 'granted' | 'holiday' | 'sick'>()
    for (const lv of project.leave) {
      for (const d of periodDates(lv.start, Math.round((Date.parse(lv.end) - Date.parse(lv.start)) / MS_DAY) + 1)) {
        map.set(`${lv.staff_id}|${d}`, lv.kind === 'request' ? (lv.granted ? 'granted' : 'request') : lv.kind)
      }
    }
    return map
  }, [project.leave])

  // People in display order (by first group), for keyboard movement.
  const people = useMemo(() => project.groups.flatMap((g) => project.staff.filter((s) => s.group_ids[0] === g.id)), [project.groups, project.staff])

  // Coverage rows: shift × group, hallway × shift × group, skill × (hallway) × shift.
  const covRows = useMemo<CovRow[]>(() => {
    const rows = new Map<string, CovRow>()
    const compName = new Map(project.competences.map((c) => [c.id, c.name]))
    const areaName = new Map(project.areas.map((a) => [a.id, a.name]))
    const gName = new Map(project.groups.map((g) => [g.id, g.name]))
    const sIndex = new Map(project.shift_types.map((s, idx) => [s.id, idx]))
    for (const c of evaluation?.coverage ?? []) {
      const key = `${c.competence_id ?? ''}|${c.area_id ?? ''}|${c.shift_id}|${c.group_id ?? ''}`
      if (!rows.has(key)) {
        const what = c.competence_id
          ? `${compName.get(c.competence_id) ?? c.competence_id}${c.area_id ? ` · ${areaName.get(c.area_id) ?? c.area_id}` : ''}`
          : `${c.area_id ? `${areaName.get(c.area_id) ?? c.area_id} · ` : ''}${gName.get(c.group_id ?? '') ?? c.group_id}`
        const idx = sIndex.get(c.shift_id) ?? 0
        rows.set(key, { key, code: project.shift_types[idx]?.code ?? c.shift_id, shiftIndex: idx, label: what, cells: new Map(), sample: c })
      }
      rows.get(key)!.cells.set(c.date, c)
    }
    return [...rows.values()]
  }, [evaluation, project.competences, project.areas, project.groups, project.shift_types])
  const gapRows = covRows.filter((r) => [...r.cells.values()].some((c) => c.assigned < c.required))
  const visibleCov = roster.length ? (showAllCov ? covRows : gapRows) : []

  const setCell = (staffId: string, date: ISODate, a: Omit<Assignment, 'staff_id' | 'date'> | null) => {
    const rest = roster.filter((x) => !(x.staff_id === staffId && x.date === date))
    setRoster(a ? [...rest, { staff_id: staffId, date, ...a }] : rest)
  }
  /** Hand edits are locked so regenerating keeps them. */
  const setShift = (staffId: string, date: ISODate, shiftId: string | null) =>
    setCell(staffId, date, shiftId ? { shift_id: shiftId, task_ids: [], area_id: null, locked: true } : null)

  // Undo with Ctrl/Cmd+Z anywhere on the page (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const select = (s: Selection) => {
    setSel(s)
    setMoreOpen(false)
    if (s) document.getElementById(s.kind === 'person' ? `rc-${s.staffId}-${s.date}` : `cc-${s.row}-${s.date}`)?.focus()
  }
  const move = (dr: number, dc: number) => {
    if (!sel) return
    const di = Math.max(0, Math.min(dates.length - 1, dates.indexOf(sel.date) + dc))
    if (sel.kind === 'person') {
      const ri = people.findIndex((p) => p.id === sel.staffId) + dr
      if (ri >= people.length && visibleCov.length) return select({ kind: 'cov', row: visibleCov[0].key, date: dates[di] })
      const p = people[Math.max(0, Math.min(people.length - 1, ri))]
      select({ kind: 'person', staffId: p.id, date: dates[di] })
    } else {
      const ri = visibleCov.findIndex((r) => r.key === sel.row) + dr
      if (ri < 0 && people.length) return select({ kind: 'person', staffId: people[people.length - 1].id, date: dates[di] })
      const r = visibleCov[Math.max(0, Math.min(visibleCov.length - 1, ri))]
      select({ kind: 'cov', row: r.key, date: dates[di] })
    }
  }
  const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }

  const onCellKey = (e: React.KeyboardEvent, staffId: string, date: ISODate) => {
    if (ARROWS[e.key]) {
      e.preventDefault()
      return move(...ARROWS[e.key])
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      return setEditing({ staffId, date })
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (['0', 'Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault()
      return setShift(staffId, date, null)
    }
    const shift = project.shift_types.find((s) => s.code.toLowerCase() === e.key.toLowerCase())
    if (shift) {
      e.preventDefault()
      const person = staffById.get(staffId)
      if (person?.allowed_shift_ids && !person.allowed_shift_ids.includes(shift.id)) return
      setShift(staffId, date, shift.id)
    }
  }

  const onCellClick = (e: React.MouseEvent, staffId: string, date: ISODate) => {
    // Shift-click copies the selected cell across the range in the same row.
    if (e.shiftKey && sel?.kind === 'person' && sel.staffId === staffId && sel.date !== date) {
      const src = cell.get(`${staffId}|${sel.date}`)
      const [a, b] = [sel.date, date].sort()
      const range = dates.filter((d) => d >= a && d <= b && d !== sel.date)
      const rest = roster.filter((x) => !(x.staff_id === staffId && range.includes(x.date)))
      const added = src ? range.map((d) => ({ staff_id: staffId, date: d, shift_id: src.shift_id, task_ids: [], area_id: src.area_id, locked: true })) : []
      setRoster([...rest, ...added])
      return
    }
    if (sel?.kind === 'person' && sel.staffId === staffId && sel.date === date) return setEditing({ staffId, date })
    select({ kind: 'person', staffId, date })
  }

  // ------------------------------------------------------------ derived status
  const errors = violations.filter((v) => v.severity === 'error')
  const hasWishes = (evaluation?.wishes?.length ?? 0) > 0
  const warnings = violations.filter((v) => v.severity === 'warning')
  const lockedCount = roster.filter((a) => a.locked).length
  const lockedConflicts = errors.filter((v) => v.staff_id && v.date && cell.get(`${v.staff_id}|${v.date}`)?.locked && !v.rule.includes('coverage'))

  const solveSummary = () => {
    if (!solveInfo) return ''
    const s = i.num(solveInfo.solve_seconds)
    if (solveInfo.mode === 'generate') return solveInfo.status === 'optimal' ? t('Optimal roster in {s} s', { s }) : t('Roster found in {s} s', { s })
    const n = changes?.length ?? 0
    if (solveInfo.mode === 'repair') return n ? i.tn(n, 'Repaired with {n} change in {s} s', 'Repaired with {n} changes in {s} s', { s }) : t('Repair: no changes needed')
    return i.tn(n, 'Regenerated in {s} s, {n} cell changed', 'Regenerated in {s} s, {n} cells changed', { s })
  }
  const status = ((): { tone: string; title: string; detail: string } => {
    if (busy) {
      const what = { generate: t('Generating the roster…'), repair: t('Repairing the roster…'), regenerate: t('Regenerating the roster…') }[busy]
      return { tone: '', title: what, detail: t('This takes up to {n} s.', { n: project.solve_seconds }) }
    }
    if (!roster.length) return { tone: '', title: t('No roster yet'), detail: t('Press Generate roster, or import one from Excel.') }
    if (solveInfo?.status === 'failed') return { tone: 'bad', title: t('No roster keeps every locked edit within the hard rules.'), detail: t('Unlock some edits and try again.') }
    const ran = solveSummary()
    if (errors.length) {
      return {
        tone: 'bad',
        title: i.tn(errors.length, '{n} error to fix', '{n} errors to fix'),
        detail: [ran, `${i.tn(warnings.length, '{n} warning', '{n} warnings')}. ${t('Repair fixes errors with the fewest changes.')}`].filter(Boolean).join(' · '),
      }
    }
    return {
      tone: 'ok',
      title: t('Roster checked: no errors'),
      detail: [ran, warnings.length ? i.tn(warnings.length, '{n} warning costs penalty points.', '{n} warnings cost penalty points.') : t('No warnings.')].filter(Boolean).join(' · '),
    }
  })()

  const exportExcel = async () => download(`${project.name}.xlsx`, await api.exportRoster(project, roster), '')
  const importExcel = async (file: File) => {
    setImportError(null)
    try {
      const result = await api.importRoster(project, file)
      if (roster.length && !confirm(t('Replace the current roster with {n} shifts from {file}?', { n: result.shifts_imported, file: file.name }))) return
      setRoster(result.roster)
      setImportReport(result)
    } catch (e) {
      setImportError(String((e as Error).message ?? e))
    }
  }

  const last = dates[dates.length - 1]
  const agreementLabel = { sfv: 'SFV', state: t('state'), municipal: t('municipal'), reykjavik: 'Reykjavík', custom: t('custom') }[project.rules.agreement]
  const weekendCount = new Set(dates.filter((d) => weekday(d) >= 5).map((d) => (weekday(d) === 6 ? addDays(d, -1) : d))).size

  return (
    <>
      <PageHead
        title={t('Roster')}
        sub={`${i.dayMonth(dates[0])} – ${i.dayMonth(last)} ${last.slice(0, 4)} · ${t('{n} days', { n: dates.length })} · ${t('{n} staff', { n: project.staff.length })} · ${t('{a} agreement', { a: agreementLabel })}`}
      >
        <button className="btn" disabled={!undoCount} onClick={undo} title="Ctrl+Z" aria-label={t('Undo ({n} steps)', { n: undoCount })}>
          <UndoIcon />
          {t('Undo')}
          {undoCount > 0 && <span className="count">{undoCount}</span>}
        </button>
        <label className="btn" title={t('Read a roster from Excel or CSV: names down the side, days across the top')}>
          {t('Import Excel')}
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) importExcel(f)
            }}
          />
        </label>
        <button className="btn" disabled={!roster.length} onClick={exportExcel}>
          {t('Export Excel')}
        </button>
        <button className="btn" onClick={() => window.print()}>
          {t('Print')}
        </button>
        {roster.length ? (
          <>
            <button className="btn" aria-expanded={regenOpen} disabled={!!busy} onClick={() => setRegenOpen((o) => !o)}>
              <RefreshIcon spinning={busy === 'regenerate'} />
              {t('Regenerate…')}
            </button>
            <button className="btn primary" disabled={!!busy} onClick={() => run('repair')} title={t('Fix problems with as few changes as possible')}>
              <RefreshIcon spinning={busy === 'repair'} />
              {t('Repair')}
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={!!busy} onClick={() => run('generate')}>
            <RefreshIcon spinning={busy === 'generate'} />
            {t('Generate roster')}
          </button>
        )}
      </PageHead>

      {regenOpen && (
        <section className="card outlined no-print" aria-label={t('Before regenerating')}>
          <h2>{t('Regenerate the roster?')}</h2>
          <p style={{ margin: 0 }}>
            {t('The solver keeps your {locked} locked cells and may change any of the other {free} filled cells. You can undo it afterwards, and you will see exactly which cells changed.', {
              locked: lockedCount,
              free: roster.length - lockedCount,
            })}
          </p>
          {lockedConflicts.length > 0 && (
            <div className="alert error">
              <ErrorDot size={18} />
              <span>
                <b>{t('This will fail.')}</b> {lockedConflicts[0].message}. {t("The solver can't keep a locked cell that breaks a hard rule.")}
              </span>
            </div>
          )}
          <div className="row">
            {lockedConflicts.length > 0 ? (
              <>
                <button
                  className="btn primary"
                  onClick={() => {
                    const v = lockedConflicts[0]
                    setRoster(roster.map((a) => (a.staff_id === v.staff_id && a.date === v.date ? { ...a, locked: false } : a)))
                    setRegenOpen(false)
                    setUnlockThenRegenerate(true)
                  }}
                >
                  {t('Unlock that cell and regenerate')}
                </button>
                <button className="btn" onClick={() => select({ kind: 'person', staffId: lockedConflicts[0].staff_id!, date: lockedConflicts[0].date! })}>
                  {t('Show the cell')}
                </button>
              </>
            ) : (
              <button
                className="btn primary"
                onClick={() => {
                  setRegenOpen(false)
                  run('regenerate')
                }}
              >
                {t('Regenerate')}
              </button>
            )}
            <button className="btn" onClick={() => setRegenOpen(false)}>
              {t('Cancel')}
            </button>
            <label className="field inline">
              {t('Search time')}
              <select value={project.solve_seconds} onChange={(e) => setProject({ ...project, solve_seconds: Number(e.target.value) })}>
                {[10, 20, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} s
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      <div className={`status-line ${status.tone} no-print`} role="status">
        {busy ? <RefreshIcon spinning /> : status.tone === 'ok' ? <CheckIcon /> : status.tone === 'bad' ? <AlertIcon /> : null}
        <span className="title">{status.title}</span>
        <span className="detail">{status.detail}</span>
        {violations.length > 0 && <a href="#problems">{`${i.tn(errors.length, '{n} error', '{n} errors')} · ${i.tn(warnings.length, '{n} warning', '{n} warnings')}`}</a>}
      </div>

      <input
        ref={workbookInput}
        type="file"
        accept=".xlsx,.xlsm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) importWorkbook(f)
        }}
      />
      {importError && <pre className="error-banner">{importError}</pre>}
      {workbook && (
        <WorkbookCard
          result={workbook}
          onUse={(withWishes) => {
            const wishes = withWishes ? workbook.wishes.map((w, k) => ({ ...w.rule, id: `wish${k + 1}` })) : []
            props.onReplaceUnit({ ...workbook.project, custom_rules: [...workbook.project.custom_rules, ...wishes] }, workbook.roster)
            setWorkbook(null)
          }}
          onClose={() => setWorkbook(null)}
        />
      )}
      {importReport && <ImportReportCard report={importReport} onClose={() => setImportReport(null)} />}

      <div className="roster-layout">
        <section className="roster-main" aria-label={t('Roster grid')}>
          <div className="roster-toolbar no-print">
            {KINDS.map((kind) => {
              const variants = project.shift_types.filter((s) => shiftKind(s) === kind)
              if (!variants.length) return null
              const main = [...variants].sort((x, y) => x.code.length - y.code.length)[0]
              const c = shiftColor(main)
              return (
                <span
                  key={kind}
                  className="legend-shift"
                  title={variants.map((s) => `${s.code}  ${i.timeRange(s.start, s.end)}`).join('\n')}
                >
                  <span className="badge xs" style={{ background: c.bg, color: c.fg }}>
                    {main.code}
                  </span>
                  {variants.length === 1
                    ? `${main.name} ${i.timeRange(main.start, main.end)}`
                    : `${t({ morning: 'Morning shifts', evening: 'Evening shifts', night: 'Night shifts' }[kind])} · ${i.tn(variants.length, '{n} time', '{n} times')}`}
                </span>
              )
            })}
            <details className="key">
              <summary>{t('Key to marks')}</summary>
              <div className="key-panel">
                <span className="cell leave-request">{i.leaveLetter('request')}</span>
                <span>{t('Requested day off')}</span>
                <span className="cell leave-granted">{i.leaveLetter('granted')}</span>
                <span>{t('Granted day off')}</span>
                <span className="cell leave-holiday">{i.leaveLetter('holiday')}</span>
                <span>{t('Holiday leave (frí)')}</span>
                <span className="cell leave-sick">{i.leaveLetter('sick')}</span>
                <span>{t('Sick')}</span>
                <LockIcon size={14} />
                <span>{t('Your edit, locked: regenerating keeps it')}</span>
                <span className="cell">
                  <span className="mark changed" />
                </span>
                <span>{t('Changed by the last repair or regenerate')}</span>
                <ErrorDot />
                <span>{t('Error: breaks a hard rule')}</span>
                <WarnDot />
                <span>{t('Warning: costs penalty points')}</span>
                {project.areas.length > 0 && (
                  <>
                    <span>{project.areas.map((a) => a.code).join(' · ')}</span>
                    <span>{t('Hallway: {names}', { names: project.areas.map((a) => a.name).join(', ') })}</span>
                  </>
                )}
                {project.tasks.length > 0 && (
                  <>
                    <span style={{ fontSize: 11 }}>{project.tasks.map((x) => abbreviate(x.name)).join(' ')}</span>
                    <span>{t('Task: {names}', { names: project.tasks.map((x) => x.name).join(', ') })}</span>
                  </>
                )}
              </div>
            </details>
            <span className="spacer" />
            <label className="field inline small" title={t('Earlier days are history; notice for change fees counts from here')}>
              {t('As of')}
              <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} style={{ height: 34 }} />
            </label>
            <div className="menu-wrap">
              <button type="button" className="icon-btn" aria-label={t('More roster actions')} aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                <DotsIcon />
              </button>
              {moreOpen && (
                <div className="menu" role="menu">
                  <button
                    role="menuitem"
                    disabled={!lockedCount}
                    onClick={() => {
                      setRoster(roster.map((a) => ({ ...a, locked: false })))
                      setMoreOpen(false)
                    }}
                  >
                    {t('Unlock all edits')}
                  </button>
                  <button
                    role="menuitem"
                    disabled={!roster.length}
                    onClick={() => {
                      setMoreOpen(false)
                      props.onNextPeriod()
                    }}
                  >
                    {t('Start next period →')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      workbookInput.current?.click()
                    }}
                  >
                    {t('New unit from an Excel workbook…')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false)
                      props.onLoadDemo()
                    }}
                  >
                    {t('Load demo unit…')}
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    disabled={!roster.length}
                    onClick={() => {
                      setMoreOpen(false)
                      setRoster([])
                    }}
                  >
                    {t('Clear roster…')} <span className="note">{t('can be undone')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid-box" ref={gridRef}>
            <table className="roster" role="grid" aria-label={t('Roster')} aria-describedby="grid-help">
              <thead>
                <tr>
                  <th className="name">{t('Staff')}</th>
                  {pastDates.map((d, idx) => (
                    <th key={d} className={`past ${idx === pastDates.length - 1 ? 'past-edge' : ''}`} title={t('Previous roster')}>
                      <span className="wd">{i.weekdayShort(d)}</span>
                      <span className="num">{Number(d.slice(8))}</span>
                    </th>
                  ))}
                  {dates.map((d) => {
                    const h = holidays.get(d)
                    return (
                      <th key={d} className={dayClass(d, holidays) + (h?.high_from ? ' eve' : '')} title={h ? `${h.name}: ${holidayNote(h, i, false)}` : weekday(d) >= 5 ? t('Weekend') : undefined}>
                        <span className="wd">{i.weekdayShort(d)}</span>
                        <span className="num">{Number(d.slice(8))}</span>
                      </th>
                    )
                  })}
                  <th className="stat first" title={t('Credited hours (weighted for nights, evenings, weekends and holidays) / contract target after leave and public-holiday reductions')}>
                    {t('Hours')}
                    <span className="sub">{t('credited / target')}</span>
                  </th>
                  <th className="stat" title={t('Weekends worked of {n}', { n: weekendCount })}>
                    {t('Wknd')}
                    <span className="sub">{t('of {n}', { n: weekendCount })}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {project.groups.map((g) => {
                  const members = project.staff.filter((s) => s.group_ids[0] === g.id)
                  return (
                    <GroupRows key={g.id} label={g.name} count={members.length}>
                      {members.map((s) => {
                        const st = stats.get(s.id)
                        const diff = st ? st.credited_hours - st.target_hours : 0
                        return (
                          <tr key={s.id}>
                            <th
                              className="name"
                              title={[groupName.get(s.group_ids[0]), ...s.competence_ids.map((c) => project.competences.find((x) => x.id === c)?.name)].filter(Boolean).join(' · ')}
                            >
                              <button type="button" className="name-btn" onClick={() => props.openPerson(s.id)}>
                                {s.name}
                              </button>
                              <span className="pct">{s.employment_percent}%</span>
                            </th>
                            {pastDates.map((d, idx) => {
                              const a = past.get(`${s.id}|${d}`)
                              const ti = a ? shiftIndex.get(a.shift_id) : undefined
                              const color = ti !== undefined ? shiftColor(project.shift_types[ti]) : null
                              return (
                                <td key={d} className={`slot past ${idx === pastDates.length - 1 ? 'past-edge' : ''}`}>
                                  {a && (
                                    <span className="cell past" style={color ? { background: color.bg, color: color.fg } : undefined}>
                                      {shiftById.get(a.shift_id)?.code ?? a.shift_id}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                            {dates.map((d) => {
                              const key = `${s.id}|${d}`
                              const a = cell.get(key)
                              const vs = cellViolations.get(key) ?? []
                              const isError = vs.some((v) => v.severity === 'error')
                              const ti = a ? shiftIndex.get(a.shift_id) : undefined
                              const leave = leaveKind.get(key)
                              const color = ti !== undefined ? shiftColor(project.shift_types[ti]) : null
                              const sub = a
                                ? [a.area_id && (areaCode.get(a.area_id) ?? a.area_id), ...a.task_ids.map((id) => abbreviate(taskName.get(id) ?? id))].filter(Boolean).join('·')
                                : ''
                              const selected = sel?.kind === 'person' && sel.staffId === s.id && sel.date === d
                              const leaveLetter = leave ? i.leaveLetter(leave) : ''
                              const focusable = selected || (!sel && s.id === people[0]?.id && d === dates[0])
                              return (
                                <td key={d} className={`slot ${dayClass(d, holidays)}`} role="gridcell" aria-selected={selected}>
                                  <button
                                    type="button"
                                    id={`rc-${s.id}-${d}`}
                                    data-staff={s.id}
                                    data-date={d}
                                    tabIndex={focusable ? 0 : -1}
                                    className={`cell ${!a && leave ? `leave-${leave}` : ''} ${selected ? 'selected' : ''}`}
                                    style={color ? { background: color.bg, color: color.fg } : undefined}
                                    aria-label={`${s.name}, ${i.day(d)}: ${a ? (shiftById.get(a.shift_id)?.name ?? a.shift_id) : t('not on shift')}${a?.locked ? `, ${t('locked edit')}` : ''}${vs.map((v) => `. ${v.message}`).join('')}`}
                                    onClick={(e) => onCellClick(e, s.id, d)}
                                    onDoubleClick={() => setEditing({ staffId: s.id, date: d })}
                                    onKeyDown={(e) => onCellKey(e, s.id, d)}
                                  >
                                    {a ? (
                                      <>
                                        <span className={(shiftById.get(a.shift_id)?.code ?? a.shift_id).length > 2 ? 'code-long' : undefined}>
                                          {shiftById.get(a.shift_id)?.code ?? a.shift_id}
                                        </span>
                                        {sub && <span className="sub">{sub}</span>}
                                      </>
                                    ) : (
                                      leaveLetter
                                    )}
                                    {vs.length > 0 && <span className="mark err">{isError ? <ErrorDot size={13} /> : <WarnDot size={13} />}</span>}
                                    {a?.locked && (
                                      <span className="mark lock">
                                        <LockIcon />
                                      </span>
                                    )}
                                    {changed.has(key) && <span className="mark changed" />}
                                    {a && leaveLetter && <span className="mark leave">{leaveLetter}</span>}
                                  </button>
                                </td>
                              )
                            })}
                            <td className={`stat first ${st && Math.abs(diff) >= 8 ? 'warn' : ''}`}>
                              {st ? `${Math.round(st.credited_hours)} / ${Math.round(st.target_hours)}` : ''}
                              {st && Math.abs(diff) >= 8 && <span className="note">{t(diff > 0 ? '{h} h over' : '{h} h under', { h: Math.round(Math.abs(diff)) })}</span>}
                            </td>
                            <td className={`stat ${st && st.weekends_worked > Math.ceil(weekendCount / 2) ? 'warn' : ''}`}>{st?.weekends_worked ?? ''}</td>
                          </tr>
                        )
                      })}
                    </GroupRows>
                  )
                })}
                {roster.length > 0 && covRows.length > 0 && (
                  <tr className="coverage-head">
                    <th>
                      {t('Coverage')}
                      <span className="muted">
                        {gapRows.length
                          ? t('{n} of {m} rows have gaps', { n: gapRows.length, m: covRows.length }) + (showAllCov ? '' : ` · ${t('showing those')}`)
                          : t('every shift, hallway and skill is covered')}
                      </span>
                    </th>
                    <td colSpan={pastDates.length + dates.length + 2}>
                      <button className="btn sm" aria-pressed={showAllCov} onClick={() => setShowAllCov((v) => !v)}>
                        {showAllCov ? t('Show only gaps') : t('Show all {n} rows', { n: covRows.length })}
                      </button>
                    </td>
                  </tr>
                )}
                {visibleCov.map((r) => {
                  const c = shiftColor(project.shift_types[r.shiftIndex])
                  return (
                    <tr key={r.key} className="coverage">
                      <th className="name" title={`${r.code} · ${r.label}`}>
                        <span className="label">
                          <span className="badge xs" style={{ background: c.bg, color: c.fg }}>
                            {r.code}
                          </span>
                          {r.label}
                        </span>
                      </th>
                      {pastDates.length > 0 && <td colSpan={pastDates.length} className="past past-edge" />}
                      {dates.map((d) => {
                        const x = r.cells.get(d)
                        const selected = sel?.kind === 'cov' && sel.row === r.key && sel.date === d
                        return (
                          <td key={d} className={dayClass(d, holidays)}>
                            {x && (
                              <button
                                type="button"
                                id={`cc-${r.key}-${d}`}
                                tabIndex={selected ? 0 : -1}
                                className={`cov-cell ${x.assigned < x.required ? 'short' : x.preferred && x.assigned < x.preferred ? 'below' : ''} ${selected ? 'selected' : ''}`}
                                aria-label={`${r.code} ${r.label}, ${i.day(d)}: ${t('{n} of {m}', { n: x.assigned, m: x.required })}${x.preferred ? `, ${t('{n} preferred', { n: x.preferred })}` : ''}`}
                                title={x.preferred ? t('{n} preferred', { n: x.preferred }) : undefined}
                                onClick={() => select({ kind: 'cov', row: r.key, date: d })}
                                onKeyDown={(e) => {
                                  if (ARROWS[e.key]) {
                                    e.preventDefault()
                                    move(...ARROWS[e.key])
                                  }
                                }}
                              >
                                {x.assigned}/{x.required}
                              </button>
                            )}
                          </td>
                        )
                      })}
                      <td colSpan={2} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p id="grid-help" className="grid-help no-print">
            {t('Arrow keys move. Type a shift code ({codes}) or 0 to set a shift; Enter opens the cell; Ctrl+Z undoes. Shift-click copies the selected cell across a range. Your edits are locked and rechecked instantly.', {
              codes: project.shift_types.map((s) => s.code).join(', '),
            })}
          </p>
        </section>

        <aside id="problems" className="roster-side no-print" aria-label={t('Selected cell and problems')}>
          <SelectionPanel
            project={project}
            sel={sel}
            cell={cell}
            leaveKind={leaveKind}
            cellViolations={cellViolations}
            covRows={covRows}
            stats={stats}
            onEdit={(staffId, date) => setEditing({ staffId, date })}
            onSet={(staffId, date, a) => setCell(staffId, date, a)}
          />
          {hasWishes && <WishesPanel project={project} wishes={evaluation?.wishes ?? []} hasRoster={roster.length > 0} openPerson={props.openPerson} />}
          <ProblemsPanel
            project={project}
            violations={violations}
            filter={filter}
            setFilter={setFilter}
            hasRoster={roster.length > 0}
            sel={sel}
            onShow={(v) => {
              if (v.staff_id && v.date) return select({ kind: 'person', staffId: v.staff_id, date: v.date })
              if (!v.date) return
              const r = covRows.find((x) => {
                const c = x.cells.get(v.date!)
                return x.sample.shift_id === v.shift_id && c && c.assigned < c.required
              })
              if (r) {
                setShowAllCov(true)
                setTimeout(() => select({ kind: 'cov', row: r.key, date: v.date! }), 0)
              }
            }}
          />
        </aside>
      </div>

      {changes && changes.length > 0 && <ChangesCard project={project} changes={changes} />}
      <FairnessCard project={project} evaluation={evaluation} onLedgerChange={(ledger) => setProject({ ...project, ledger })} />

      {editing && (
        <ShiftDialog
          project={project}
          roster={roster}
          evaluation={evaluation}
          staffId={editing.staffId}
          date={editing.date}
          onApply={(a) => {
            setCell(editing.staffId, editing.date, a)
            setEditing(null)
            select({ kind: 'person', staffId: editing.staffId, date: editing.date })
          }}
          onMarkSick={() => {
            setProject({
              ...project,
              leave: [...project.leave, { staff_id: editing.staffId, start: editing.date, end: editing.date, kind: 'sick', granted: false, note: '' }],
            })
            setEditing(null)
          }}
          onClose={() => {
            setEditing(null)
            select({ kind: 'person', staffId: editing.staffId, date: editing.date })
          }}
        />
      )}
    </>
  )
}

function GroupRows({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <th colSpan={999}>
          {label}
          <span className="count">{count}</span>
        </th>
      </tr>
      {children}
    </>
  )
}

/** What the selected cell holds, its neighbours and problems; for a coverage cell, who could fill it. */
function SelectionPanel({
  project,
  sel,
  cell,
  leaveKind,
  cellViolations,
  covRows,
  stats,
  onEdit,
  onSet,
}: {
  project: Project
  sel: Selection
  cell: Map<string, Assignment>
  leaveKind: Map<string, string>
  cellViolations: Map<string, Violation[]>
  covRows: CovRow[]
  stats: Map<string, Evaluation['staff'][number]>
  onEdit: (staffId: string, date: ISODate) => void
  onSet: (staffId: string, date: ISODate, a: Omit<Assignment, 'staff_id' | 'date'> | null) => void
}) {
  const i = useI18n()
  const { t } = i
  const shiftById = new Map(project.shift_types.map((s, idx) => [s.id, { s, idx }]))
  const leaveText: Record<string, string> = { request: t('requested day off'), granted: t('granted day off'), holiday: t('holiday leave'), sick: t('sick') }
  if (!sel) {
    return (
      <section className="side-card">
        <h2>{t('Select a cell')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('Click a day in the roster to see the person’s surrounding days and any problems, or a coverage cell to see who is free to fill a gap.')}
        </p>
      </section>
    )
  }
  if (sel.kind === 'person') {
    const person = project.staff.find((s) => s.id === sel.staffId)
    if (!person) return null
    const key = `${sel.staffId}|${sel.date}`
    const a = cell.get(key)
    const info = a ? shiftById.get(a.shift_id) : undefined
    const color = shiftColor(info?.s)
    const problems = cellViolations.get(key) ?? []
    const leave = leaveKind.get(key)
    const neighbour = (d: ISODate, current: boolean) => {
      const x = cell.get(`${sel.staffId}|${d}`)
      const sh = x ? shiftById.get(x.shift_id)?.s : undefined
      const crosses = sh && clock(sh.end) <= clock(sh.start)
      const lv = leaveKind.get(`${sel.staffId}|${d}`)
      return (
        <div key={d} className={current ? 'current' : ''}>
          <span className="day">{i.day(d)}</span>
          <span className="what">{sh ? `${sh.code} · ${sh.name}` : lv === 'holiday' ? t('Holiday leave') : lv === 'sick' ? t('Sick') : t('Not on shift')}</span>
          {crosses && <span className="note">{t('ends {day} {time}', { day: i.weekday(addDays(d, 1)), time: sh!.end })}</span>}
        </div>
      )
    }
    return (
      <section className="side-card">
        <span className="sr-only" aria-live="polite">
          {person.name}, {i.day(sel.date)}
          {problems.length ? `, ${i.tn(problems.length, '{n} problem', '{n} problems')}` : ''}
        </span>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            <h2>{person.name}</h2>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {i.day(sel.date)} · {person.employment_percent}%{a?.locked ? ` · ${t('locked edit')}` : ''}
              {leave ? ` · ${leaveText[leave] ?? leave}` : ''}
            </p>
          </div>
          <span className="badge lg" style={{ background: color.bg, color: color.fg }}>
            {info?.s.code ?? (leave === 'holiday' ? i.leaveLetter('holiday') : '–')}
          </span>
        </div>
        <div className="neighbours">{[-1, 0, 1].map((n) => neighbour(addDays(sel.date, n), n === 0))}</div>
        {problems.map((p, idx) => (
          <p key={idx} className={`problem ${p.severity}`}>
            {p.message}
          </p>
        ))}
        <div className="row">
          <button className="btn primary" onClick={() => onEdit(sel.staffId, sel.date)}>
            {t('Edit shift, area & task')}
          </button>
          {a && (
            <button className="btn" title={t('Leaves the day empty. Holiday leave and day-off requests are entered under Leave.')} onClick={() => onSet(sel.staffId, sel.date, null)}>
              {t('Remove from shift')}
            </button>
          )}
          {a?.locked && (
            <button className="btn" onClick={() => onSet(sel.staffId, sel.date, { ...a, locked: false })}>
              {t('Unlock')}
            </button>
          )}
        </div>
      </section>
    )
  }

  // Coverage cell: who is free, rested and allowed, most under their hours first.
  const row = covRows.find((r) => r.key === sel.row)
  const x = row?.cells.get(sel.date)
  if (!row || !x) return null
  const shift = project.shift_types.find((s) => s.id === x.shift_id)!
  const color = shiftColor(project.shift_types[row.shiftIndex])
  const absolute = project.rules.min_rest_hours_absolute * 60
  const len = (s: { start: string; end: string }) => ((clock(s.end) - clock(s.start) + 24 * 60 - 1) % (24 * 60)) + 1
  const restOk = (staffId: string) => {
    const prev = cell.get(`${staffId}|${addDays(sel.date, -1)}`)
    const next = cell.get(`${staffId}|${addDays(sel.date, 1)}`)
    const start = clock(shift.start) + 24 * 60
    if (prev) {
      const p = shiftById.get(prev.shift_id)!.s
      if (start - (clock(p.start) + len(p)) < absolute) return false
    }
    if (next) {
      const n = shiftById.get(next.shift_id)!.s
      if (clock(n.start) + 48 * 60 - (start + len(shift)) < absolute) return false
    }
    return true
  }
  const fits = (s: Project['staff'][number]) =>
    (x.group_id ? s.group_ids.includes(x.group_id) : true) &&
    (x.competence_id ? s.competence_ids.includes(x.competence_id) : true) &&
    (s.allowed_shift_ids === null || s.allowed_shift_ids.includes(x.shift_id))
  const available = project.staff
    .filter((s) => fits(s) && !cell.get(`${s.id}|${sel.date}`) && !['holiday', 'sick', 'granted'].includes(leaveKind.get(`${s.id}|${sel.date}`) ?? '') && restOk(s.id))
    .map((s) => {
      const st = stats.get(s.id)
      return { s, under: st ? st.target_hours - st.credited_hours : 0, requested: leaveKind.get(`${s.id}|${sel.date}`) === 'request' }
    })
    .sort((a, b) => Number(a.requested) - Number(b.requested) || b.under - a.under)
    .slice(0, 6)
  return (
    <section className="side-card">
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <h2>
            {row.code} · {row.label}
          </h2>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            {i.day(sel.date)} · {t('{n} of {m}', { n: x.assigned, m: x.required })}
            {x.assigned < x.required ? `, ${t('short')}` : ''}
          </p>
        </div>
        <span className="badge lg" style={{ background: color.bg, color: color.fg }}>
          {row.code}
        </span>
      </div>
      <span className="muted">{available.length ? t('Free, rested and allowed, most under their hours first:') : t('Nobody free who meets the rest rules.')}</span>
      <ul className="avail">
        {available.map(({ s, under, requested }) => (
          <li key={s.id}>
            <span>
              <b>{s.name}</b>{' '}
              <span className="muted small">
                {requested ? t('asked for this day off') : under > 0 ? t('{h} h under', { h: Math.round(under) }) : t('{h} h over', { h: Math.round(-under) })}
              </span>
            </span>
            <button className="btn sm" aria-label={t('Assign {name}', { name: s.name })} onClick={() => onSet(s.id, sel.date, { shift_id: x.shift_id, task_ids: [], area_id: x.area_id, locked: true })}>
              {t('Assign')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const RULE_TITLES: Record<string, string> = {
  rest: 'Rest too short',
  short_rest: 'Short rest',
  short_rest_week: 'Short rests this week',
  weekly_rest: 'No weekly rest',
  days_off: 'Days off',
  consecutive_days: 'Too many days in a row',
  consecutive_nights: 'Too many nights in a row',
  coverage: 'Short-staffed',
  area_coverage: 'Hallway short-staffed',
  competence: 'Skill missing',
  task_coverage: 'Task not covered',
  overtime: 'Overtime',
  overtime_cap: 'Overtime cap',
  under_hours: 'Under contract hours',
  max_avg_weekly_hours: 'Average hours too high',
  weekends: 'Weekends',
  request_denied: 'Requested day off',
  leave: 'Works on leave',
  eligibility: 'Shift not allowed',
  one_shift_per_day: 'Two shifts in a day',
  task_group: 'Task for another group',
  task_competence: 'Task needs a skill',
  area_missing: 'No hallway',
  one_task_per_shift: 'Too many tasks',
  shift_length: 'Shift length',
  lone_night: 'Alone on a night',
  unknown_reference: 'Unknown item',
}

/** Which wishes the roster meets: a count, and the people with wishes it misses. */
function WishesPanel({ project, wishes, hasRoster, openPerson }: { project: Project; wishes: WishResult[]; hasRoster: boolean; openPerson: (staffId: string) => void }) {
  const i = useI18n()
  const { t } = i
  const [all, setAll] = useState(false)
  const met = wishes.filter((w) => !w.misses).length
  const byPerson = new Map<string, WishResult[]>()
  for (const w of wishes) byPerson.set(w.staff_id, [...(byPerson.get(w.staff_id) ?? []), w])
  const people = project.staff
    .map((s) => ({ s, list: byPerson.get(s.id) ?? [] }))
    .filter(({ list }) => list.length && (all || list.some((w) => w.misses)))
    .sort((a, b) => b.list.reduce((n, w) => n + w.misses, 0) - a.list.reduce((n, w) => n + w.misses, 0))
  const pct = wishes.length ? Math.round((met / wishes.length) * 100) : 100
  const rules = new Map(project.custom_rules.map((r) => [r.id, r]))
  // What the rule does ("Only MV/KV"), not the wish text it came from: one wish can give two rules.
  const label = (w: WishResult) => {
    const r = rules.get(w.rule_id)
    return r ? describeRule(i, project, r) : w.description
  }
  return (
    <section className="side-card">
      <div className="row">
        <h2 style={{ flex: '1 1 0' }}>{t('Wishes')}</h2>
        <label className="row small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t('Show met')}
        </label>
      </div>
      {!hasRoster ? (
        <p className="muted small" style={{ margin: 0 }}>{t('Generate a roster to see which wishes it meets.')}</p>
      ) : (
        <>
          <div>
            <b>{t('{met} of {n} met', { met, n: wishes.length })}</b>
            <span className="bar thick" style={{ display: 'block', marginTop: 6 }}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
          <ul className="list wishes-report">
            {people.slice(0, all ? undefined : 12).map(({ s, list }) => (
              <li key={s.id}>
                <button type="button" className="link" onClick={() => openPerson(s.id)}>
                  {s.name}
                </button>
                <span className="row" style={{ gap: 4 }}>
                  {list
                    .filter((w) => all || w.misses)
                    .map((w) => (
                      <span key={w.rule_id} className={`chip ${w.misses ? 'missed' : 'met'}`} title={[w.description, ...w.examples].join('\n')}>
                        {w.misses ? '✗' : '✓'} {w.rule_id === 'requests' ? t('Day-off requests') : label(w)}
                        {w.misses ? ` · ${w.total ? t('{n} of {m}', { n: w.misses, m: w.total }) : `${w.misses}×`}` : ''}
                      </span>
                    ))}
                </span>
              </li>
            ))}
          </ul>
          {!all && people.length > 12 && <p className="muted small" style={{ margin: 0 }}>{t('and {n} more', { n: people.length - 12 })}</p>}
        </>
      )}
    </section>
  )
}

function ProblemsPanel({
  project,
  violations,
  filter,
  setFilter,
  hasRoster,
  sel,
  onShow,
}: {
  project: Project
  violations: Violation[]
  filter: 'all' | 'error' | 'warning'
  setFilter: (f: 'all' | 'error' | 'warning') => void
  hasRoster: boolean
  sel: Selection
  onShow: (v: Violation) => void
}) {
  const i = useI18n()
  const { t } = i
  const ruleLabel = new Map(project.custom_rules.map((r) => [r.id, r.description || r.type]))
  const staffName = new Map(project.staff.map((s) => [s.id, s.name]))
  const errors = violations.filter((v) => v.severity === 'error').length
  const shown = violations.filter((v) => filter === 'all' || v.severity === filter).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return (
    <section className="side-card">
      <div className="row">
        <h2 style={{ flex: '1 1 0' }}>{t('Problems')}</h2>
        <div className="segmented" role="group" aria-label={t('Show')}>
          {(
            [
              ['all', t('All {n}', { n: violations.length })],
              ['error', t('Errors {n}', { n: errors })],
              ['warning', t('Warnings {n}', { n: violations.length - errors })],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {t('Checks daily and weekly rest, days off, leave, weekends, credited hours, staffing, hallways, skills and your unit rules.')}
      </p>
      {!hasRoster && (
        <p className="muted" style={{ margin: 0 }}>
          {t('No roster yet.')}
        </p>
      )}
      {hasRoster && violations.length === 0 && (
        <p className="problem" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>
          {t('No problems. The roster is ready to print or export.')}
        </p>
      )}
      <ul className="problems">
        {shown.map((v, idx) => {
          const active = sel?.kind === 'person' && sel.staffId === v.staff_id && sel.date === v.date
          const where = [v.staff_id && staffName.get(v.staff_id), v.date && i.day(v.date)].filter(Boolean).join(' · ')
          return (
            <li key={idx}>
              <button className={active ? 'active' : ''} onClick={() => onShow(v)}>
                {v.severity === 'error' ? <ErrorDot size={16} /> : <WarnDot size={16} />}
                <span>
                  <span className="ptitle">
                    {RULE_TITLES[v.rule] ? t(RULE_TITLES[v.rule]) : (ruleLabel.get(v.rule) ?? v.rule)}
                    {where && <span className="pwhere"> · {where}</span>}
                  </span>
                  <span className="pmsg">{v.message}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** What an Excel/CSV import read, and what it could not place. */
function ImportReportCard({ report, onClose }: { report: ImportResult; onClose: () => void }) {
  const { t } = useI18n()
  const unknown = Object.entries(report.unknown_codes)
  const clean = !report.unmatched_names.length && !unknown.length && !report.outside_period && !report.warnings.length
  return (
    <section className="card no-print">
      <div className="card-head">
        <div>
          <h2>{t('Imported from “{sheet}”', { sheet: report.sheet })}</h2>
          <p className="hint">
            {t('{n} shifts for {p} people, checked against every rule. Next: press Repair to fill in tasks and hallways and fix rule errors with the fewest shift changes.', {
              n: report.shifts_imported,
              p: report.people_found,
            })}
          </p>
        </div>
        <button type="button" className="icon-btn close" aria-label={t('Close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      {clean && (
        <p className="muted" style={{ margin: 0 }}>
          {t('Everything in the file was recognised.')}
        </p>
      )}
      {report.unmatched_names.length > 0 && (
        <div className="alert warning">
          <AlertIcon />
          <span>
            <b>{t('People not found in Staff (their shifts were skipped):')}</b> {report.unmatched_names.join(', ')}.{' '}
            {t('Add them under Setup, or give them the same employee number as the file.')}
          </span>
        </div>
      )}
      {unknown.length > 0 && (
        <div className="alert warning">
          <AlertIcon />
          <span>
            <b>{t('Codes not recognised:')}</b> {unknown.map(([code, n]) => `“${code}” ×${n}`).join(', ')}. {t('Add a shift type, area or task with that code, or fix the file.')}
          </span>
        </div>
      )}
      {report.outside_period > 0 && (
        <div className="alert warning">
          <AlertIcon />
          <span>{t('{n} shifts fall outside the planning period and were left out.', { n: report.outside_period })}</span>
        </div>
      )}
      {report.warnings.map((w, idx) => (
        <div key={idx} className="alert warning">
          <AlertIcon />
          <span>{w}</span>
        </div>
      ))}
    </section>
  )
}

/** What the last repair or regenerate changed, with notice and the change fee the agreements attach. */
function ChangesCard({ project, changes }: { project: Project; changes: Change[] }) {
  const i = useI18n()
  const { t } = i
  const staffName = new Map(project.staff.map((s) => [s.id, s.name]))
  const code = (id: string | null) => (id ? (project.shift_types.find((s) => s.id === id)?.code ?? id) : t('Not on shift'))
  const withFee = changes.filter((c) => c.fee_percent > 0)
  return (
    <section className="card no-print">
      <div className="card-head">
        <div>
          <h2>
            {t('Changes')} <span className="count">{changes.length}</span>
          </h2>
          <p className="hint">
            {t('Each change needs the employee’s consent.')} {withFee.length > 0 && i.tn(withFee.length, '{n} at short notice carries a change fee (breytingargjald).', '{n} at short notice carry a change fee (breytingargjald).')}
          </p>
        </div>
      </div>
      <ul className="list">
        {changes.map((c, idx) => (
          <li key={idx}>
            <b style={{ minWidth: 120 }}>{staffName.get(c.staff_id) ?? c.staff_id}</b>
            <span className="muted">{i.day(c.date)}</span>
            <span style={{ flex: '1 1 120px' }}>
              {code(c.before)} → {code(c.after)}
            </span>
            <span className="muted small">{c.notice_days <= 0 ? t('today') : i.tn(c.notice_days, '{n} day notice', '{n} days notice')}</span>
            {c.fee_percent > 0 && <span className="chip warn">{t('{p}% fee', { p: i.num(c.fee_percent) })}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

const LEDGER_COLUMNS: { key: 'weekends' | 'nights' | 'holiday_shifts' | 'major_holiday_shifts' | 'overtime_hours'; label: string; now: (st: Evaluation['staff'][number]) => number }[] = [
  { key: 'weekends', label: 'Weekends', now: (st) => st.weekends_worked },
  { key: 'nights', label: 'Nights', now: (st) => st.night_shifts },
  { key: 'holiday_shifts', label: 'Holiday shifts', now: (st) => st.holiday_shifts },
  { key: 'major_holiday_shifts', label: 'Stórhátíð', now: (st) => st.major_holiday_shifts },
  { key: 'overtime_hours', label: 'Overtime h', now: (st) => st.overtime_hours },
]

/** Running totals across periods: earlier periods (editable) + this roster. */
function FairnessCard({ project, evaluation, onLedgerChange }: { project: Project; evaluation: Evaluation | null; onLedgerChange: (ledger: LedgerEntry[]) => void }) {
  const i = useI18n()
  const { t } = i
  const stats = new Map((evaluation?.staff ?? []).map((s) => [s.staff_id, s]))
  const prior = new Map(project.ledger.map((e) => [e.staff_id, e]))
  const blank = (staff_id: string): LedgerEntry => ({ staff_id, periods: 0, weekends: 0, nights: 0, holiday_shifts: 0, major_holiday_shifts: 0, overtime_hours: 0, requests_denied: 0 })
  const setPrior = (staffId: string, key: (typeof LEDGER_COLUMNS)[number]['key'], value: number) => {
    const entry = { ...(prior.get(staffId) ?? blank(staffId)), [key]: value }
    onLedgerChange([...project.ledger.filter((e) => e.staff_id !== staffId), entry])
  }
  const periods = Math.max(0, ...project.ledger.map((e) => e.periods))
  return (
    <details className="card no-print">
      <summary className="card-head" style={{ cursor: 'pointer', listStyle: 'none' }}>
        <div>
          <h2>{t('Fairness over time')}</h2>
          <p className="hint">{t('Earlier periods ({n}) + this roster. Weekends and holidays go to whoever has carried fewer, per 100% employment.', { n: periods })}</p>
        </div>
        <span className="btn sm">{t('Show')}</span>
      </summary>
      <div className="table-scroll">
        <table className="form-table" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>{t('Name')}</th>
              {LEDGER_COLUMNS.map((c) => (
                <th key={c.key}>{t('{what}: earlier + now', { what: t(c.label) })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {project.staff.map((s) => {
              const st = stats.get(s.id)
              const e = prior.get(s.id)
              return (
                <tr key={s.id}>
                  <td>
                    {s.name} <span className="muted">{s.employment_percent}%</span>
                  </td>
                  {LEDGER_COLUMNS.map((c) => {
                    const before = e?.[c.key] ?? 0
                    const now = st ? c.now(st) : 0
                    return (
                      <td key={c.key}>
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <input
                            type="number"
                            className="num"
                            style={{ width: 64, height: 32 }}
                            aria-label={`${s.name}: ${t(c.label)}`}
                            value={Math.round(before * 10) / 10}
                            onChange={(ev) => setPrior(s.id, c.key, Number(ev.target.value) || 0)}
                          />
                          <span className="muted">+ {i.num(Math.round(now * 10) / 10)} =</span>
                          <b>{i.num(Math.round((before + now) * 10) / 10)}</b>
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function dayClass(date: ISODate, holidays: Map<string, unknown>): string {
  if (holidays.has(date)) return 'holiday'
  return weekday(date) >= 5 ? 'weekend' : ''
}

function abbreviate(name: string): string {
  return name.slice(0, 2)
}

/** What a planner's workbook became, before it replaces the current unit. */
function WorkbookCard({ result, onUse, onClose }: { result: WorkbookImport; onUse: (withWishes: boolean) => void; onClose: () => void }) {
  const i = useI18n()
  const [withWishes, setWithWishes] = useState(true)
  const wishPeople = new Set(result.wishes.map((w) => w.staff_id)).size
  const { t } = i
  const p = result.project
  const last = periodDates(p.period.start, p.period.days).at(-1)!
  const byKind = KINDS.map((k) => ({ k, shifts: p.shift_types.filter((s) => shiftKind(s) === k) })).filter((x) => x.shifts.length)
  const unsure = result.staffing.filter((s) => !s.certain)
  return (
    <section className="card outlined no-print" aria-label={t('New unit from an Excel workbook')}>
      <div className="card-head">
        <div>
          <h2>{t('New unit from “{sheet}”', { sheet: result.sheet })}</h2>
          <p className="hint">
            {i.dayMonth(p.period.start)} – {i.dayMonth(last)} {last.slice(0, 4)} · {i.tn(result.people, '{n} person', '{n} people')} ·{' '}
            {i.tn(result.shifts_imported, '{n} shift', '{n} shifts')} · {i.tn(p.staff.filter((s) => s.note).length, '{n} wish', '{n} wishes')}
          </p>
        </div>
        <button type="button" className="icon-btn close" aria-label={t('Close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      {!result.named && (
        <div className="alert info">
          <AlertIcon />
          <span>{t('The sheet has no names, so everyone got a made-up name. Rename people under Setup.')}</span>
        </div>
      )}
      <div>
        <b>{i.tn(result.shift_types, '{n} clock time', '{n} clock times')}</b>
        <div className="row" style={{ marginTop: 6 }}>
          {byKind.map(({ k, shifts }) => (
            <span key={k} className="row" style={{ gap: 4 }}>
              {shifts.map((s) => {
                const c = shiftColor(s)
                return (
                  <span key={s.id} className="chip" style={{ background: c.bg, color: c.fg }} title={s.name}>
                    {s.code} {i.timeRange(s.start, s.end)}
                  </span>
                )
              })}
            </span>
          ))}
        </div>
      </div>
      <div>
        <b>{t('Staffing read from the count rows')}</b>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          {unsure.length
            ? i.tn(unsure.length, '{n} needs checking under Demand.', '{n} need checking under Demand.')
            : t('All read clearly.')}
        </p>
        <ul className="list">
          {result.staffing.map((s, idx) => (
            <li key={idx}>
              {s.certain ? <CheckIcon /> : <WarnDot size={16} />}
              <span className="chip">{s.shift_id ?? '—'}</span>
              <span style={{ flex: '1 1 260px' }}>“{s.note}”</span>
              <span className="muted small">{s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
      {result.wishes.length > 0 && (
        <div>
          <label className="row">
            <input type="checkbox" checked={withWishes} onChange={(e) => setWithWishes(e.target.checked)} />
            <b>{i.tn(result.wishes.length, 'Add {n} rule read from the wishes', 'Add {n} rules read from the wishes')}</b>
          </label>
          <p className="hint" style={{ margin: '2px 0 0 24px' }}>
            {t('{people} people. All are soft: the solver follows them when it can. Check each person under Setup.', { people: wishPeople })}
          </p>
        </div>
      )}
      {result.warnings.length > 0 && (
        <details>
          <summary className="muted">{i.tn(result.warnings.length, '{n} note on the import', '{n} notes on the import')}</summary>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {result.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => onUse(withWishes)}>
          {t('Use this unit')}
        </button>
        <button className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <span className="muted small">{t('Replaces the current unit and roster. Save the current one to a file first if you want to keep it.')}</span>
      </div>
    </section>
  )
}
