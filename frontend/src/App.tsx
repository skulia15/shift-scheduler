import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { CalendarIcon, SparkleIcon } from './components/icons'
import { download, usePersisted } from './store'
import type { Assignment, Change, Evaluation, Project, SolveResult } from './types'
import { DemandView } from './views/DemandView'
import { LeaveView } from './views/LeaveView'
import { RosterView } from './views/RosterView'
import { RulesView } from './views/RulesView'
import { SetupView } from './views/SetupView'

const TABS = ['Roster', 'Setup', 'Demand', 'Leave', 'Rules'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [tab, setTab] = usePersisted<Tab>('tab', 'Roster')
  const [stored, setProject] = usePersisted<Project | null>('project', null)
  // Defaults for fields added since a project was saved come from the server's demo project.
  const [defaults, setDefaults] = useState<Project | null>(null)
  useEffect(() => {
    api.sample().then(setDefaults).catch((e) => setError(String(e)))
  }, [])
  const project = useMemo(
    () =>
      stored && defaults
        ? {
            ...stored,
            areas: stored.areas ?? [],
            area_demand: stored.area_demand ?? [],
            competences: stored.competences ?? [],
            history: stored.history ?? [],
            ledger: stored.ledger ?? [],
            competence_demand: stored.competence_demand ?? [],
            staff: stored.staff.map((s) => ({ ...s, competence_ids: s.competence_ids ?? [], employee_number: s.employee_number ?? null })),
            tasks: stored.tasks.map((t) => ({ ...t, competence_id: t.competence_id ?? null })),
            rules: { ...defaults.rules, ...stored.rules },
            weights: { ...defaults.weights, ...stored.weights },
          }
        : null,
    [stored, defaults],
  )
  const [roster, setRoster] = usePersisted<Assignment[]>('roster', [])
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [solveInfo, setSolveInfo] = useState<Pick<SolveResult, 'status' | 'message' | 'solve_seconds'> | null>(null)
  const [busy, setBusy] = useState<'generate' | 'repair' | null>(null)
  const [changes, setChanges] = useState<Change[] | null>(null)
  // "Now" for repair: earlier days are history, and notice (change fee) counts from here.
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!stored && defaults) setProject(defaults)
  }, [stored, defaults, setProject])

  // Re-check the roster whenever it or the rules change.
  useEffect(() => {
    if (!project) return
    const timer = setTimeout(() => {
      api
        .validate(project, roster)
        .then((ev) => {
          setEvaluation(ev)
          setError(null)
        })
        .catch((e) => setError(String(e.message ?? e)))
    }, 300)
    return () => clearTimeout(timer)
  }, [project, roster])

  if (!project) return <div className="loading">{error ?? 'Loading…'}</div>

  const run = async (mode: 'generate' | 'repair') => {
    setBusy(mode)
    setError(null)
    try {
      const result = mode === 'generate' ? await api.solve(project) : await api.repair(project, roster, asOf)
      if (result.status !== 'failed') setRoster(result.roster)
      setEvaluation(result)
      setSolveInfo(result)
      setChanges(mode === 'repair' ? result.changes : null)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }
  const startOver = () => {
    if (confirm('Start over? This regenerates the whole roster and ignores the current one, including locks.')) run('generate')
  }

  const importJson = (file: File) =>
    file.text().then((text) => {
      const data = JSON.parse(text)
      setProject(data.project ?? data)
      setRoster(data.roster ?? [])
      setSolveInfo(null)
    })

  const startNextPeriod = async () => {
    if (!confirm('Start the next period? The last week stays as history and this period is added to the fairness totals. Save this period first if you want to keep it.')) return
    setProject(await api.nextPeriod(project, roster))
    setRoster([])
    setSolveInfo(null)
    setChanges(null)
  }

  const resetToSample = async () => {
    if (!confirm('Replace the current project with the demo unit? Unsaved work is lost.')) return
    setProject(await api.sample())
    setRoster([])
    setSolveInfo(null)
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              <CalendarIcon />
            </span>
            Vaktaplan
          </div>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <div className="header-actions">
            <label className="btn on-plum">
              Open file
              <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            </label>
            <button
              className="btn on-plum"
              onClick={() => download(`${project.name}.json`, JSON.stringify({ project, roster }, null, 2), 'application/json')}
            >
              Save file
            </button>
            <button className="btn on-plum" onClick={resetToSample}>
              Demo
            </button>
            {roster.length ? (
              <button className="btn lime" disabled={!!busy} onClick={() => run('repair')} title="Fix problems with as few changes as possible">
                <SparkleIcon />
                {busy === 'repair' ? 'Repairing…' : 'Repair roster'}
              </button>
            ) : (
              <button className="btn lime" disabled={!!busy} onClick={() => run('generate')}>
                <SparkleIcon />
                {busy ? `Generating… (≤${project.solve_seconds}s)` : 'Generate roster'}
              </button>
            )}
          </div>
        </div>
      </header>
      <main>
        {error && <pre className="error-banner">{error}</pre>}
        {tab === 'Roster' && (
          <RosterView
            project={project}
            roster={roster}
            setRoster={setRoster}
            evaluation={evaluation}
            solveInfo={solveInfo}
            busy={!!busy}
            changes={changes}
            asOf={asOf}
            setAsOf={setAsOf}
            onStartOver={startOver}
            onMarkSick={(staffId, date) =>
              setProject({ ...project, leave: [...project.leave, { staff_id: staffId, start: date, end: date, kind: 'sick', granted: false, note: '' }] })
            }
            onNextPeriod={startNextPeriod}
            onLedgerChange={(ledger) => setProject({ ...project, ledger })}
          />
        )}
        {tab === 'Setup' && <SetupView project={project} setProject={setProject} />}
        {tab === 'Demand' && <DemandView project={project} setProject={setProject} />}
        {tab === 'Leave' && <LeaveView project={project} setProject={setProject} />}
        {tab === 'Rules' && <RulesView project={project} setProject={setProject} />}
      </main>
    </div>
  )
}
