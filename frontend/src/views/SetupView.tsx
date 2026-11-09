import { Checks, NumberField, Section, TextField } from '../components/fields'
import { patchAt, removeAt } from '../lists'
import { newId } from '../store'
import type { Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

export function SetupView({ project, setProject }: Props) {
  const p = project
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const groupOptions = p.groups.map((g) => ({ value: g.id, label: g.name }))
  const shiftOptions = p.shift_types.map((s) => ({ value: s.id, label: s.code }))

  return (
    <div className="stack">
      <Section title="Planning period">
        <label>
          Start <input type="date" value={p.period.start} onChange={(e) => set({ period: { ...p.period, start: e.target.value } })} />
        </label>{' '}
        <label>
          Days <NumberField value={p.period.days} onChange={(v) => set({ period: { ...p.period, days: v ?? 28 } })} />
        </label>{' '}
        <label>
          Solver time limit (s) <NumberField value={p.solve_seconds} onChange={(v) => set({ solve_seconds: v ?? 20 })} />
        </label>
      </Section>

      <Section title="Shift types" hint="End before start means the shift crosses midnight. Night shifts count for the consecutive-nights rule.">
        <table className="form-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Start</th>
              <th>End</th>
              <th>Unpaid break (min)</th>
              <th>Night</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.shift_types.map((s, i) => (
              <tr key={i}>
                <td>
                  <TextField width={40} value={s.code} onChange={(code) => set({ shift_types: patchAt(p.shift_types, i, { code }) })} />
                </td>
                <td>
                  <TextField value={s.name} onChange={(name) => set({ shift_types: patchAt(p.shift_types, i, { name }) })} />
                </td>
                <td>
                  <input type="time" value={s.start} onChange={(e) => set({ shift_types: patchAt(p.shift_types, i, { start: e.target.value }) })} />
                </td>
                <td>
                  <input type="time" value={s.end === '24:00' ? '00:00' : s.end} onChange={(e) => set({ shift_types: patchAt(p.shift_types, i, { end: e.target.value }) })} />
                </td>
                <td>
                  <NumberField value={s.break_minutes} onChange={(v) => set({ shift_types: patchAt(p.shift_types, i, { break_minutes: v ?? 0 }) })} />
                </td>
                <td>
                  <input type="checkbox" checked={s.is_night} onChange={(e) => set({ shift_types: patchAt(p.shift_types, i, { is_night: e.target.checked }) })} />
                </td>
                <td>
                  <button className="link" onClick={() => set({ shift_types: removeAt(p.shift_types, i) })}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => {
            const id = newId('S', p.shift_types)
            set({ shift_types: [...p.shift_types, { id, code: id, name: 'New shift', start: '08:00', end: '16:00', break_minutes: 0, is_night: false }] })
          }}
        >
          + Shift type
        </button>
      </Section>

      <Section title="Staff groups">
        {p.groups.map((g, i) => (
          <div key={g.id} className="row">
            <code>{g.id}</code> <TextField value={g.name} onChange={(name) => set({ groups: patchAt(p.groups, i, { name }) })} />
            <button className="link" onClick={() => set({ groups: removeAt(p.groups, i) })}>
              remove
            </button>
          </div>
        ))}
        <button onClick={() => set({ groups: [...p.groups, { id: newId('group', p.groups), name: 'New group' }] })}>+ Group</button>
      </Section>

      <Section title="Staff" hint="The first group decides where a person is listed in the roster. Leave all shift boxes unticked to allow any shift.">
        <table className="form-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Groups</th>
              <th>Employment %</th>
              <th>May work</th>
              <th>Hours override</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.staff.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <TextField value={s.name} onChange={(name) => set({ staff: patchAt(p.staff, i, { name }) })} />
                </td>
                <td>
                  <Checks values={s.group_ids} options={groupOptions} onChange={(group_ids) => set({ staff: patchAt(p.staff, i, { group_ids }) })} />
                </td>
                <td>
                  <NumberField value={s.employment_percent} onChange={(v) => set({ staff: patchAt(p.staff, i, { employment_percent: v ?? 100 }) })} />
                </td>
                <td>
                  <Checks
                    values={s.allowed_shift_ids ?? []}
                    options={shiftOptions}
                    onChange={(ids) => set({ staff: patchAt(p.staff, i, { allowed_shift_ids: ids.length ? ids : null }) })}
                  />
                </td>
                <td>
                  <NumberField nullable value={s.target_hours_override} onChange={(v) => set({ staff: patchAt(p.staff, i, { target_hours_override: v }) })} />
                </td>
                <td>
                  <button
                    className="link"
                    onClick={() =>
                      set({
                        staff: removeAt(p.staff, i),
                        leave: p.leave.filter((l) => l.staff_id !== s.id),
                      })
                    }
                  >
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
              staff: [
                ...p.staff,
                {
                  id: newId('s', p.staff),
                  name: 'New person',
                  group_ids: p.groups.slice(0, 1).map((g) => g.id),
                  employment_percent: 100,
                  allowed_shift_ids: null,
                  target_hours_override: null,
                },
              ],
            })
          }
        >
          + Staff member
        </button>
      </Section>

      <Section title="Tasks" hint="Duties assigned within a shift, done by one group.">
        {p.tasks.map((t, i) => (
          <div key={t.id} className="row">
            <code>{t.id}</code> <TextField value={t.name} onChange={(name) => set({ tasks: patchAt(p.tasks, i, { name }) })} />
            <select value={t.group_id} onChange={(e) => set({ tasks: patchAt(p.tasks, i, { group_id: e.target.value }) })}>
              {groupOptions.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <button
              className="link"
              onClick={() => set({ tasks: removeAt(p.tasks, i), task_demand: p.task_demand.filter((d) => d.task_id !== t.id) })}
            >
              remove
            </button>
          </div>
        ))}
        <button onClick={() => set({ tasks: [...p.tasks, { id: newId('task', p.tasks), name: 'New task', group_id: p.groups[0]?.id ?? '' }] })}>
          + Task
        </button>
      </Section>

      <Section
        title="Public holidays"
        hint="Weighted like weekends. Weekday holidays reduce full-time duty (7.2h, or 3.6h for aðfangadagur / gamlársdagur)."
      >
        {p.public_holidays.map((h, i) => (
          <div key={i} className="row">
            <input type="date" value={h.date} onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, i, { date: e.target.value }) })} />
            <TextField value={h.name} onChange={(name) => set({ public_holidays: patchAt(p.public_holidays, i, { name }) })} />
            reduction h{' '}
            <NumberField
              step={0.1}
              value={h.duty_reduction_hours}
              onChange={(v) => set({ public_holidays: patchAt(p.public_holidays, i, { duty_reduction_hours: v ?? 0 }) })}
            />
            <button className="link" onClick={() => set({ public_holidays: removeAt(p.public_holidays, i) })}>
              remove
            </button>
          </div>
        ))}
        <button onClick={() => set({ public_holidays: [...p.public_holidays, { date: p.period.start, name: 'Holiday', duty_reduction_hours: 7.2 }] })}>
          + Holiday
        </button>
      </Section>
    </div>
  )
}
