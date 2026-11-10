import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setApiLang } from './api'
import { CheckIcon, PencilIcon, RibbonMark } from './components/icons'
import { I18nContext, makeI18n, type Lang } from './i18n'
import { download, usePersisted } from './store'
import type { Assignment, Change, Evaluation, Project, SolveResult } from './types'
import { DemandView } from './views/DemandView'
import { PersonPanel } from './views/PersonPanel'
import { LeaveView } from './views/LeaveView'
import { RosterView } from './views/RosterView'
import { RulesView } from './views/RulesView'
import { SetupView } from './views/SetupView'

const TABS = ['Roster', 'Setup', 'Demand', 'Leave', 'Rules'] as const
type Tab = (typeof TABS)[number]
export type RunMode = 'generate' | 'repair' | 'regenerate'
const UNDO_LIMIT = 50

export default function App() {
  const [lang, setLang] = usePersisted<Lang>('lang', 'en')
  const i18n = useMemo(() => makeI18n(lang), [lang])
  const { t } = i18n
  setApiLang(lang)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const [tab, setTab] = usePersisted<Tab>('tab', 'Roster')
  const [stored, setProject] = usePersisted<Project | null>('project', null)
  // Defaults for fields added since a project was saved come from the server's demo project.
  const [defaults, setDefaults] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
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
            staff: stored.staff.map((s) => ({ ...s, competence_ids: s.competence_ids ?? [], employee_number: s.employee_number ?? null, note: s.note ?? '' })),
            shift_types: stored.shift_types.map((s) => ({ ...s, category: s.category ?? null })),
            tasks: stored.tasks.map((t) => ({ ...t, competence_id: t.competence_id ?? null })),
            rules: { ...defaults.rules, ...stored.rules },
            weights: { ...defaults.weights, ...stored.weights },
          }
        : null,
    [stored, defaults],
  )
  const [roster, setRosterRaw] = usePersisted<Assignment[]>('roster', [])
  const [undoStack, setUndoStack] = useState<Assignment[][]>([])
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [solveInfo, setSolveInfo] = useState<(Pick<SolveResult, 'status' | 'solve_seconds'> & { mode: RunMode }) | null>(null)
  const [busy, setBusy] = useState<RunMode | null>(null)
  const [changes, setChanges] = useState<Change[] | null>(null)
  // "Now" for repair: earlier days are history, and notice (change fee) counts from here.
  const [personId, setPersonId] = useState<string | null>(null)
  const closePerson = useCallback(() => setPersonId(null), [])
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))

  /** Every roster change goes through here so it can be undone. */
  const setRoster = useCallback(
    (next: Assignment[]) => {
      setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), roster])
      setRosterRaw(next)
    },
    [roster, setRosterRaw],
  )
  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack
      setRosterRaw(stack[stack.length - 1])
      setChanges(null)
      setSolveInfo(null)
      return stack.slice(0, -1)
    })
  }, [setRosterRaw])

  useEffect(() => {
    if (!stored && defaults) setProject(defaults)
  }, [stored, defaults, setProject])

  // Re-check the roster whenever it, the rules or the language change.
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
    }, 250)
    return () => clearTimeout(timer)
  }, [project, roster, lang])

  if (!project) return <div className="loading">{error ?? t('Loading…')}</div>

  const run = async (mode: RunMode) => {
    setBusy(mode)
    setError(null)
    try {
      const result = mode === 'generate' ? await api.solve(project) : await api.repair(project, roster, asOf, mode)
      if (result.status !== 'failed') setRoster(result.roster)
      setEvaluation(result)
      setSolveInfo({ status: result.status, solve_seconds: result.solve_seconds, mode })
      setChanges(mode === 'generate' ? null : result.changes)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const importJson = (file: File) =>
    file.text().then((text) => {
      const data = JSON.parse(text)
      setProject(data.project ?? data)
      setRoster(data.roster ?? [])
      setSolveInfo(null)
      setChanges(null)
    })

  const startNextPeriod = async () => {
    if (!confirm(t('Start the next period? The last week stays as history and this period is added to the fairness totals. Save this period first if you want to keep it.')))
      return
    setProject(await api.nextPeriod(project, roster))
    setRoster([])
    setSolveInfo(null)
    setChanges(null)
  }

  const loadDemo = async () => {
    if (!confirm(t('Replace the current project with the demo unit? Unsaved work is lost.'))) return
    setProject(await api.sample())
    setRoster([])
    setSolveInfo(null)
    setChanges(null)
  }

  const tabLabel: Record<Tab, string> = { Roster: t('Roster'), Setup: t('Setup'), Demand: t('Demand'), Leave: t('Leave'), Rules: t('Rules') }

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <header className="topbar no-print">
          <div className="ribbon" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="topbar-inner">
            <div className="brand">
              <span className="brand-mark">
                <RibbonMark />
              </span>
              <span className="brand-name">Vaktaplan</span>
              <label className="unit-name">
                <span className="sr-only">{t('Unit name')}</span>
                <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
                <PencilIcon />
              </label>
            </div>
            <nav className="tabs" aria-label={t('Sections')}>
              {TABS.map((tb) => (
                <button key={tb} className={tb === tab ? 'active' : ''} aria-current={tb === tab ? 'page' : undefined} onClick={() => setTab(tb)}>
                  {tabLabel[tb]}
                </button>
              ))}
            </nav>
            <span className="spacer" />
            <div className="header-actions">
              <span className="save-status" role="status">
                <CheckIcon />
                {t('Saved in this browser')}
              </span>
              <div className="lang" role="group" aria-label={t('Language')}>
                {(['is', 'en'] as const).map((l) => (
                  <button key={l} className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
              <label className="btn on-slate">
                {t('Open file')}
                <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
              </label>
              <button className="btn light" onClick={() => download(`${project.name}.json`, JSON.stringify({ project, roster }, null, 2), 'application/json')}>
                {t('Save to file')}
              </button>
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
              busy={busy}
              run={run}
              undo={undo}
              undoCount={undoStack.length}
              changes={changes}
              asOf={asOf}
              setAsOf={setAsOf}
              setProject={setProject}
              onLoadDemo={loadDemo}
              onReplaceUnit={(p, r) => {
                setProject(p)
                setRoster(r)
                setSolveInfo(null)
                setChanges(null)
              }}
              onNextPeriod={startNextPeriod}
              openPerson={setPersonId}
            />
          )}
          {tab === 'Setup' && <SetupView project={project} setProject={setProject} roster={roster} setRoster={setRoster} openPerson={setPersonId} />}
          {tab === 'Demand' && <DemandView project={project} setProject={setProject} />}
          {tab === 'Leave' && <LeaveView project={project} setProject={setProject} />}
          {tab === 'Rules' && <RulesView project={project} setProject={setProject} openPerson={setPersonId} />}
        </main>
        {personId && <PersonPanel project={project} setProject={setProject} evaluation={evaluation} staffId={personId} onClose={closePerson} />}
      </div>
    </I18nContext.Provider>
  )
}
