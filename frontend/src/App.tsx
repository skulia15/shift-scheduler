import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { download, usePersisted } from './store'
import type { Assignment, Evaluation, Project, SolveResult } from './types'
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
  // Projects saved before areas existed lack these fields.
  const project = useMemo(() => (stored ? { ...stored, areas: stored.areas ?? [], area_demand: stored.area_demand ?? [] } : null), [stored])
  const [roster, setRoster] = usePersisted<Assignment[]>('roster', [])
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [solveInfo, setSolveInfo] = useState<Pick<SolveResult, 'status' | 'message' | 'solve_seconds'> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) api.sample().then(setProject).catch((e) => setError(String(e)))
  }, [project, setProject])

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

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.solve(project)
      setRoster(result.roster)
      setEvaluation(result)
      setSolveInfo(result)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const importJson = (file: File) =>
    file.text().then((text) => {
      const data = JSON.parse(text)
      setProject(data.project ?? data)
      setRoster(data.roster ?? [])
      setSolveInfo(null)
    })

  const resetToSample = async () => {
    if (!confirm('Replace the current project with the demo unit? Unsaved work is lost.')) return
    setProject(await api.sample())
    setRoster([])
    setSolveInfo(null)
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <input className="title" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={generate}>
            {busy ? `Generating… (≤${project.solve_seconds}s)` : 'Generate roster'}
          </button>
          <button onClick={() => download(`${project.name}.json`, JSON.stringify({ project, roster }, null, 2), 'application/json')}>
            Save file
          </button>
          <label className="button">
            Open file
            <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </label>
          <button onClick={resetToSample}>Demo</button>
        </div>
      </header>
      {error && <pre className="error-banner">{error}</pre>}
      {solveInfo && tab === 'Roster' && (
        <div className={`solve-info ${solveInfo.status}`}>
          {solveInfo.message} ({solveInfo.solve_seconds}s)
        </div>
      )}
      <main>
        {tab === 'Roster' && <RosterView project={project} roster={roster} setRoster={setRoster} evaluation={evaluation} />}
        {tab === 'Setup' && <SetupView project={project} setProject={setProject} />}
        {tab === 'Demand' && <DemandView project={project} setProject={setProject} />}
        {tab === 'Leave' && <LeaveView project={project} setProject={setProject} />}
        {tab === 'Rules' && <RulesView project={project} setProject={setProject} />}
      </main>
    </div>
  )
}
