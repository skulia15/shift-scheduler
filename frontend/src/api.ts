import type { Agreement, Assignment, Evaluation, Project, PublicHoliday, SolveResult } from './types'

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

export const api = {
  sample: () => call<Project>('sample'),
  holidays: (start: string, days: number, agreement: Agreement) =>
    call<PublicHoliday[]>(`holidays?start=${start}&days=${days}&agreement=${agreement}`),
  solve: (project: Project) => call<SolveResult>('solve', project),
  validate: (project: Project, roster: Assignment[]) => call<Evaluation>('validate', { project, roster }),
}
