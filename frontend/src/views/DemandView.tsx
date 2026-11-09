import type { ReactNode } from 'react'
import { Checks, PageHead, RemoveButton, Section, Stepper } from '../components/fields'
import { WEEKDAYS } from '../dates'
import { patchAt, removeAt } from '../lists'
import { shiftColor } from '../shiftColors'
import type { Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

const weekdayOptions = WEEKDAYS.map((label, value) => ({ value, label: label.slice(0, 2) }))
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

function DatesField({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  return (
    <input
      placeholder="Every week"
      title="Comma-separated YYYY-MM-DD. When set, this row overrides weekday rows on those dates."
      defaultValue={value?.join(', ') ?? ''}
      style={{ width: 180 }}
      onBlur={(e) => {
        const dates = e.target.value
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean)
        onChange(dates.length ? dates : null)
      }}
    />
  )
}

function ShiftLabel({ project, shiftId }: { project: Project; shiftId: string }) {
  const i = project.shift_types.findIndex((s) => s.id === shiftId)
  const c = shiftColor(Math.max(0, i))
  return (
    <span className="badge sm" style={{ background: c.bg, color: c.fg }}>
      {project.shift_types[i]?.code ?? '?'}
    </span>
  )
}

function Options<T extends string>({ value, items, onChange }: { value: T; items: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table-scroll">
      <table className="form-table" style={{ minWidth: 860 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function DemandView({ project: p, setProject }: Props) {
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const shifts = p.shift_types.map((s) => ({ id: s.id, label: `${s.code} ${s.name}` }))
  const groups = p.groups.map((g) => ({ id: g.id, label: g.name }))

  // A typical weekday (Monday): minimum headcount per shift from weekly rows.
  const typical = p.shift_types.map((s, i) => {
    const perGroup = p.groups.map((g) => ({
      name: g.name,
      min: p.coverage.filter((c) => c.shift_id === s.id && c.group_id === g.id && !c.dates && c.weekdays.includes(0)).reduce((n, c) => n + c.min, 0),
    }))
    return { shift: s, color: shiftColor(i), total: perGroup.reduce((n, g) => n + g.min, 0), perGroup }
  })

  return (
    <>
      <PageHead eyebrow="Demand" title="Who needs to be on each shift" />

      <Section title="A typical day" hint="Minimum headcount per shift on a Monday, all groups.">
        <div className="card-grid">
          {typical.map((t) => (
            <div key={t.shift.id} className="overview" style={{ background: t.color.bg, color: t.color.fg }}>
              <div className="row">
                <b style={{ fontSize: 16 }}>{t.shift.code}</b>
                <span style={{ fontWeight: 600 }}>{t.shift.name}</span>
                <span className="spacer" />
                <span className="big">{t.total}</span>
              </div>
              <div className="split">
                {t.perGroup.map((g) => (
                  <span key={g.name}>
                    {g.min} {g.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Staffing per shift"
        hint="Minimum and optional maximum from each group. Date rows override weekday rows."
        action={
          <button
            className="btn add"
            onClick={() =>
              set({
                coverage: [...p.coverage, { shift_id: p.shift_types[0]?.id ?? '', group_id: p.groups[0]?.id ?? '', weekdays: ALL_DAYS, dates: null, min: 1, max: null }],
              })
            }
          >
            + Staffing row
          </button>
        }
      >
        <Table head={['Shift', 'Group', 'Weekdays', 'Specific dates', 'Min', 'Max']}>
          {p.coverage.map((c, i) => {
            const patch = (v: Partial<typeof c>) => set({ coverage: patchAt(p.coverage, i, v) })
            return (
              <tr key={`${i}-${c.dates?.join() ?? ''}`}>
                <td>
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    <ShiftLabel project={p} shiftId={c.shift_id} />
                    <Options value={c.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                  </span>
                </td>
                <td>
                  <Options value={c.group_id} items={groups} onChange={(group_id) => patch({ group_id })} />
                </td>
                <td>
                  <Checks values={c.weekdays} options={weekdayOptions} onChange={(weekdays) => patch({ weekdays })} />
                </td>
                <td>
                  <DatesField value={c.dates} onChange={(dates) => patch({ dates })} />
                </td>
                <td>
                  <Stepper value={c.min} onChange={(v) => patch({ min: v ?? 0 })} />
                </td>
                <td>
                  <Stepper nullable value={c.max} onChange={(max) => patch({ max })} />
                </td>
                <td className="right">
                  <RemoveButton label="Remove row" onClick={() => set({ coverage: removeAt(p.coverage, i) })} />
                </td>
              </tr>
            )
          })}
        </Table>
      </Section>

      <Section
        title="Staffing per area"
        hint="Headcount per floor or hallway. A group with any area row on a shift has every working member placed in one area."
        action={
          <button
            className="btn add"
            disabled={!p.areas.length}
            onClick={() =>
              set({
                area_demand: [
                  ...p.area_demand,
                  { area_id: p.areas[0].id, shift_id: p.shift_types[0]?.id ?? '', group_id: p.groups[0]?.id ?? '', weekdays: ALL_DAYS, dates: null, min: 1, max: null },
                ],
              })
            }
          >
            + Area row
          </button>
        }
      >
        {p.areas.length === 0 ? (
          <p className="empty">Add areas under Setup to plan per floor or hallway.</p>
        ) : (
          <Table head={['Area', 'Shift', 'Group', 'Weekdays', 'Specific dates', 'Min', 'Max']}>
            {p.area_demand.map((ad, i) => {
              const patch = (v: Partial<typeof ad>) => set({ area_demand: patchAt(p.area_demand, i, v) })
              return (
                <tr key={`${i}-${ad.dates?.join() ?? ''}`}>
                  <td>
                    <Options value={ad.area_id} items={p.areas.map((a) => ({ id: a.id, label: a.name }))} onChange={(area_id) => patch({ area_id })} />
                  </td>
                  <td>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <ShiftLabel project={p} shiftId={ad.shift_id} />
                      <Options value={ad.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                    </span>
                  </td>
                  <td>
                    <Options value={ad.group_id} items={groups} onChange={(group_id) => patch({ group_id })} />
                  </td>
                  <td>
                    <Checks values={ad.weekdays} options={weekdayOptions} onChange={(weekdays) => patch({ weekdays })} />
                  </td>
                  <td>
                    <DatesField value={ad.dates} onChange={(dates) => patch({ dates })} />
                  </td>
                  <td>
                    <Stepper value={ad.min} onChange={(v) => patch({ min: v ?? 0 })} />
                  </td>
                  <td>
                    <Stepper nullable value={ad.max} onChange={(max) => patch({ max })} />
                  </td>
                  <td className="right">
                    <RemoveButton label="Remove row" onClick={() => set({ area_demand: removeAt(p.area_demand, i) })} />
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Section>

      <Section
        title="Task needs"
        hint="People per task on a shift. Each person does at most one task per shift."
        action={
          <button
            className="btn add"
            disabled={!p.tasks.length}
            onClick={() =>
              set({ task_demand: [...p.task_demand, { task_id: p.tasks[0].id, shift_id: p.shift_types[0]?.id ?? '', weekdays: ALL_DAYS, dates: null, count: 1 }] })
            }
          >
            + Task need
          </button>
        }
      >
        <Table head={['Task', 'Shift', 'Weekdays', 'Specific dates', 'People']}>
          {p.task_demand.map((td, i) => {
            const patch = (v: Partial<typeof td>) => set({ task_demand: patchAt(p.task_demand, i, v) })
            return (
              <tr key={`${i}-${td.dates?.join() ?? ''}`}>
                <td>
                  <Options value={td.task_id} items={p.tasks.map((t) => ({ id: t.id, label: t.name }))} onChange={(task_id) => patch({ task_id })} />
                </td>
                <td>
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    <ShiftLabel project={p} shiftId={td.shift_id} />
                    <Options value={td.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                  </span>
                </td>
                <td>
                  <Checks values={td.weekdays} options={weekdayOptions} onChange={(weekdays) => patch({ weekdays })} />
                </td>
                <td>
                  <DatesField value={td.dates} onChange={(dates) => patch({ dates })} />
                </td>
                <td>
                  <Stepper value={td.count} onChange={(v) => patch({ count: v ?? 0 })} />
                </td>
                <td className="right">
                  <RemoveButton label="Remove row" onClick={() => set({ task_demand: removeAt(p.task_demand, i) })} />
                </td>
              </tr>
            )
          })}
        </Table>
      </Section>
    </>
  )
}
