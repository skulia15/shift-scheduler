import type { Agreement, Assignment, Evaluation, ImportResult, Project, PublicHoliday, SolveResult, WishSuggestion, WorkbookImport } from './types'

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail ? formatError(detail) : `${res.status} ${res.statusText}`)
  }
  return res.json()
}

function formatError(detail: { detail?: unknown }): string {
  if (Array.isArray(detail.detail)) {
    return detail.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join('.')}: ${d.msg}`).join('\n')
  }
  return JSON.stringify(detail.detail ?? detail)
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail ? formatError(detail) : `${res.status} ${res.statusText}`)
  }
  return res.json()
}

let currentLang = 'en'
/** UI language for messages the server writes (rule check). */
export function setApiLang(lang: string) {
  currentLang = lang
}
const q = () => `lang=${currentLang}`

export const api = {
  importRoster: (project: Project, file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('project', JSON.stringify(project))
    return upload<ImportResult>('import/roster', form)
  },
  importWorkbook: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return upload<WorkbookImport>(`import/workbook?${q()}`, form)
  },
  exportRoster: async (project: Project, roster: Assignment[]): Promise<Blob> => {
    const res = await fetch('/api/export/roster.xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, roster }),
    })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    return res.blob()
  },
  sample: () => call<Project>(`sample?${q()}`),
  holidays: (start: string, days: number, agreement: Agreement) =>
    call<PublicHoliday[]>(`holidays?start=${start}&days=${days}&agreement=${agreement}`),
  solve: (project: Project) => call<SolveResult>(`solve?${q()}`, project),
  repair: (project: Project, roster: Assignment[], today: string, mode: 'repair' | 'regenerate' = 'repair') =>
    call<SolveResult>(`repair?${q()}`, { project, roster, today, mode }),
  nextPeriod: (project: Project, roster: Assignment[]) => call<Project>('next-period', { project, roster }),
  suggestWishes: (project: Project) => call<WishSuggestion[]>('wishes/suggest', project),
  validate: (project: Project, roster: Assignment[]) => call<Evaluation>(`validate?${q()}`, { project, roster }),
}
