import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import { TrashIcon } from './icons'

export function NumberField({
  value,
  onChange,
  nullable,
  step = 1,
  width,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  nullable?: boolean
  step?: number
  width?: number
  placeholder?: string
}) {
  return (
    <input
      type="number"
      className="num"
      step={step}
      style={width ? { width } : undefined}
      value={value ?? ''}
      placeholder={nullable ? placeholder : ''}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') onChange(nullable ? null : 0)
        else onChange(Number(raw))
      }}
    />
  )
}

export function TextField({ value, onChange, width, className }: { value: string; onChange: (v: string) => void; width?: number; className?: string }) {
  return <input className={className} value={value} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)} />
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

/** Multi-select rendered as toggle pills (weekdays, groups, shift types). */
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
    <span className="pills">
      {options.map((o) => {
        const on = values.includes(o.value)
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            className={on ? 'pill-toggle on' : 'pill-toggle'}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
          >
            {o.label}
          </button>
        )
      })}
    </span>
  )
}

export function Stepper({
  value,
  onChange,
  nullable,
  min = 0,
}: {
  value: number | null
  onChange: (v: number | null) => void
  nullable?: boolean
  min?: number
}) {
  const down = () => {
    if (value === null) return
    if (value <= min) onChange(nullable ? null : min)
    else onChange(value - 1)
  }
  return (
    <span className="stepper">
      <button type="button" aria-label="Decrease" disabled={value === null || (!nullable && value <= min)} onClick={down}>
        −
      </button>
      <span className={value === null ? 'off' : ''}>{value ?? 'Off'}</span>
      <button type="button" aria-label="Increase" onClick={() => onChange(value === null ? min : value + 1)}>
        +
      </button>
    </span>
  )
}

export function Section({ title, children, hint, action, count }: { title: string; children: ReactNode; hint?: string; action?: ReactNode; count?: number }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>
            {title} {count !== undefined && <span className="count">{count}</span>}
          </h2>
          {hint && <p className="hint">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <section className="page-head">
      <div className="titles">
        <h1>{title}</h1>
        {sub && <span className="page-sub">{sub}</span>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </section>
  )
}

export function RemoveButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useI18n()
  const text = label ?? t('Remove')
  return (
    <button type="button" className="icon-btn danger" aria-label={text} title={text} onClick={onClick}>
      <TrashIcon />
    </button>
  )
}
