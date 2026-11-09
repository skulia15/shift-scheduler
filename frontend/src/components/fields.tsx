import type { ReactNode } from 'react'

export function NumberField({
  value,
  onChange,
  nullable,
  step = 1,
  width = 70,
}: {
  value: number | null
  onChange: (v: number | null) => void
  nullable?: boolean
  step?: number
  width?: number
}) {
  return (
    <input
      type="number"
      step={step}
      style={{ width }}
      value={value ?? ''}
      placeholder={nullable ? 'off' : ''}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') onChange(nullable ? null : 0)
        else onChange(Number(raw))
      }}
    />
  )
}

export function TextField({ value, onChange, width }: { value: string; onChange: (v: string) => void; width?: number }) {
  return <input value={value} style={{ width }} onChange={(e) => onChange(e.target.value)} />
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Checks<T extends string | number>({
  values,
  options,
  onChange,
}: {
  values: T[]
  options: { value: T; label: string }[]
  onChange: (v: T[]) => void
}) {
  return (
    <span className="checks">
      {options.map((o) => (
        <label key={String(o.value)}>
          <input
            type="checkbox"
            checked={values.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...values, o.value] : values.filter((v) => v !== o.value))}
          />
          {o.label}
        </label>
      ))}
    </span>
  )
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  )
}
