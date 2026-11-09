import type { Agreement, Assignment, Evaluation, ImportResult, Project, PublicHoliday, SolveResult } from './types'

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

export const api = {
  importRoster: (project: Project, file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('project', JSON.stringify(project))
    return upload<ImportResult>('import/roster', form)
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
  sample: () => call<Project>('sample'),
  holidays: (start: string, days: number, agreement: Agreement) =>
    call<PublicHoliday[]>(`holidays?start=${start}&days=${days}&agreement=${agreement}`),
  solve: (project: Project) => call<SolveResult>('solve', project),
  repair: (project: Project, roster: Assignment[], today: string) => call<SolveResult>('repair', { project, roster, today }),
  nextPeriod: (project: Project, roster: Assignment[]) => call<Project>('next-period', { project, roster }),
  validate: (project: Project, roster: Assignment[]) => call<Evaluation>('validate', { project, roster }),
}
