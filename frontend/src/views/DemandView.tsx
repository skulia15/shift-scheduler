import { Checks, NumberField, Section } from '../components/fields'
import { patchAt, removeAt } from '../lists'
import { WEEKDAYS } from '../dates'
import type { Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

const weekdayOptions = WEEKDAYS.map((label, value) => ({ value, label: label.slice(0, 2) }))

function DatesField({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  return (
    <input
      placeholder="weekdays apply"
      title="Comma-separated YYYY-MM-DD. When set, this row overrides weekday rows on those dates."
      defaultValue={value?.join(', ') ?? ''}
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

export function DemandView({ project: p, setProject }: Props) {
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })

  return (
    <div className="stack">
      <Section title="Staffing per shift" hint="Minimum (and optional maximum) headcount from each group on each shift. Date rows override weekday rows.">
        <table className="form-table">
          <thead>
            <tr>
              <th>Shift</th>
              <th>Group</th>
              <th>Weekdays</th>
              <th>Specific dates</th>
              <th>Min</th>
              <th>Max</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.coverage.map((c, i) => (
              <tr key={`${i}-${c.dates?.join() ?? ''}`}>
                <td>
                  <select value={c.shift_id} onChange={(e) => set({ coverage: patchAt(p.coverage, i, { shift_id: e.target.value }) })}>
                    {p.shift_types.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={c.group_id} onChange={(e) => set({ coverage: patchAt(p.coverage, i, { group_id: e.target.value }) })}>
                    {p.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Checks values={c.weekdays} options={weekdayOptions} onChange={(weekdays) => set({ coverage: patchAt(p.coverage, i, { weekdays }) })} />
                </td>
                <td>
                  <DatesField value={c.dates} onChange={(dates) => set({ coverage: patchAt(p.coverage, i, { dates }) })} />
                </td>
                <td>
                  <NumberField value={c.min} onChange={(v) => set({ coverage: patchAt(p.coverage, i, { min: v ?? 0 }) })} />
                </td>
                <td>
                  <NumberField nullable value={c.max} onChange={(max) => set({ coverage: patchAt(p.coverage, i, { max }) })} />
                </td>
                <td>
                  <button className="link" onClick={() => set({ coverage: removeAt(p.coverage, i) })}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() =>
            set({
              coverage: [
                ...p.coverage,
                { shift_id: p.shift_types[0]?.id ?? '', group_id: p.groups[0]?.id ?? '', weekdays: [0, 1, 2, 3, 4, 5, 6], dates: null, min: 1, max: null },
              ],
            })
          }
        >
          + Staffing row
        </button>
      </Section>

      <Section title="Task needs" hint="How many people do each task on a shift. Each person does at most one task per shift.">
        <table className="form-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Shift</th>
              <th>Weekdays</th>
              <th>Specific dates</th>
              <th>People</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.task_demand.map((td, i) => (
              <tr key={`${i}-${td.dates?.join() ?? ''}`}>
                <td>
                  <select value={td.task_id} onChange={(e) => set({ task_demand: patchAt(p.task_demand, i, { task_id: e.target.value }) })}>
                    {p.tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={td.shift_id} onChange={(e) => set({ task_demand: patchAt(p.task_demand, i, { shift_id: e.target.value }) })}>
                    {p.shift_types.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Checks values={td.weekdays} options={weekdayOptions} onChange={(weekdays) => set({ task_demand: patchAt(p.task_demand, i, { weekdays }) })} />
                </td>
                <td>
                  <DatesField value={td.dates} onChange={(dates) => set({ task_demand: patchAt(p.task_demand, i, { dates }) })} />
                </td>
                <td>
                  <NumberField value={td.count} onChange={(v) => set({ task_demand: patchAt(p.task_demand, i, { count: v ?? 0 }) })} />
                </td>
                <td>
                  <button className="link" onClick={() => set({ task_demand: removeAt(p.task_demand, i) })}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          disabled={!p.tasks.length}
          onClick={() =>
            set({
              task_demand: [
                ...p.task_demand,
                { task_id: p.tasks[0].id, shift_id: p.shift_types[0]?.id ?? '', weekdays: [0, 1, 2, 3, 4, 5, 6], dates: null, count: 1 },
              ],
            })
          }
        >
          + Task need
        </button>
      </Section>
    </div>
  )
}
