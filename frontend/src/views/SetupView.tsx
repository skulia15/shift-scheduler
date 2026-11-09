import { Checks, NumberField, PageHead, RemoveButton, Section, TextField } from '../components/fields'
import { CloseIcon } from '../components/icons'
import { api } from '../api'
import { monthShort } from '../dates'
import { patchAt, removeAt } from '../lists'
import { shiftColor } from '../shiftColors'
import { newId } from '../store'
import type { Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

export function SetupView({ project: p, setProject }: Props) {
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const groupOptions = p.groups.map((g) => ({ value: g.id, label: g.name }))
  const shiftOptions = p.shift_types.map((s) => ({ value: s.id, label: s.code }))
  // Replace the list with the period's Icelandic holidays for the selected agreement.
  const fillHolidays = async () => set({ public_holidays: await api.holidays(p.period.start, p.period.days, p.rules.agreement) })

  return (
    <>
      <PageHead eyebrow="Setup" title="Period, shifts and people" />
      <div className="cols">
        <div className="col-narrow">
          <Section title="Period">
            <label className="field">
              Unit name
              <TextField value={p.name} onChange={(name) => set({ name })} />
            </label>
            <label className="field">
              Starts
              <input type="date" value={p.period.start} onChange={(e) => set({ period: { ...p.period, start: e.target.value } })} />
            </label>
            <div className="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label className="field">
                Days
                <NumberField value={p.period.days} onChange={(v) => set({ period: { ...p.period, days: v ?? 28 } })} />
              </label>
              <label className="field">
                Solver time (s)
                <NumberField value={p.solve_seconds} onChange={(v) => set({ solve_seconds: v ?? 20 })} />
              </label>
            </div>
          </Section>

          <Section
            title="Groups & tasks"
            hint="Tasks are duties done within a shift, by one group."
            action={
              <button className="btn add" onClick={() => set({ groups: [...p.groups, { id: newId('group', p.groups), name: 'New group' }] })}>
                + Group
              </button>
            }
          >
            {p.groups.map((g, gi) => (
              <div key={g.id} className="group-box">
                <div className="row">
                  <TextField value={g.name} onChange={(name) => set({ groups: patchAt(p.groups, gi, { name }) })} />
                  <span className="spacer" />
                  <RemoveButton label="Remove group" onClick={() => set({ groups: removeAt(p.groups, gi) })} />
                </div>
                <div className="row">
                  {p.tasks.map((t, ti) =>
                    t.group_id !== g.id ? null : (
                      <span key={t.id} className="chip-input">
                        <input aria-label="Task name" value={t.name} onChange={(e) => set({ tasks: patchAt(p.tasks, ti, { name: e.target.value }) })} />
                        {p.competences.length > 0 && (
                          <select
                            aria-label="Required competence"
                            title="Only people with this competence may do the task"
                            className="chip-select"
                            value={t.competence_id ?? ''}
                            onChange={(e) => set({ tasks: patchAt(p.tasks, ti, { competence_id: e.target.value || null }) })}
                          >
                            <option value="">anyone</option>
                            {p.competences.map((c) => (
                              <option key={c.id} value={c.id}>
                                needs {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove ${t.name}`}
                          onClick={() => set({ tasks: removeAt(p.tasks, ti), task_demand: p.task_demand.filter((d) => d.task_id !== t.id) })}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </span>
                    ),
                  )}
                  <button
                    type="button"
                    className="dashed-btn"
                    onClick={() => set({ tasks: [...p.tasks, { id: newId('task', p.tasks), name: 'New task', group_id: g.id, competence_id: null }] })}
                  >
                    + Task
                  </button>
                </div>
              </div>
            ))}
          </Section>

          <Section
            title="Areas"
            hint="Floors, wings or hallways. Headcount per area is set under Demand."
            action={
              <button
                className="btn add"
                onClick={() => {
                  const id = newId('area', p.areas)
                  set({ areas: [...p.areas, { id, code: String.fromCharCode(65 + p.areas.length), name: 'New area' }] })
                }}
              >
                + Area
              </button>
            }
          >
            {p.areas.length === 0 && <p className="empty">No areas — everyone works the whole unit.</p>}
            {p.areas.map((a, i) => (
              <div key={a.id} className="row">
                <TextField className="code" value={a.code} onChange={(code) => set({ areas: patchAt(p.areas, i, { code }) })} />
                <TextField value={a.name} onChange={(name) => set({ areas: patchAt(p.areas, i, { name }) })} />
                <RemoveButton
                  label="Remove area"
                  onClick={() =>
                    set({
                      areas: removeAt(p.areas, i),
                      area_demand: p.area_demand.filter((d) => d.area_id !== a.id),
                      custom_rules: p.custom_rules.filter((r) => !(r.type === 'fixed_area' && r.area_id === a.id)),
                    })
                  }
                />
              </div>
            ))}
          </Section>

          <Section
            title="Competences"
            hint="Skills that cut across groups. Tick them per person in Staff; set minimums under Demand."
            action={
              <button className="btn add" onClick={() => set({ competences: [...p.competences, { id: newId('comp', p.competences), name: 'New competence' }] })}>
                + Competence
              </button>
            }
          >
            {p.competences.length === 0 && <p className="empty">None yet — e.g. Lyfjaréttindi, Íslenska, Vaktstjóri.</p>}
            {p.competences.map((c, i) => (
              <div key={c.id} className="row">
                <TextField value={c.name} onChange={(name) => set({ competences: patchAt(p.competences, i, { name }) })} />
                <span className="muted">{p.staff.filter((s) => s.competence_ids.includes(c.id)).length} people</span>
                <RemoveButton
                  label="Remove competence"
                  onClick={() =>
                    set({
                      competences: removeAt(p.competences, i),
                      competence_demand: p.competence_demand.filter((d) => d.competence_id !== c.id),
                      staff: p.staff.map((s) => ({ ...s, competence_ids: s.competence_ids.filter((x) => x !== c.id) })),
                      tasks: p.tasks.map((t) => (t.competence_id === c.id ? { ...t, competence_id: null } : t)),
                    })
                  }
                />
              </div>
            ))}
          </Section>

          <Section
            title="Public holidays"
            hint="Weighted like weekends. On weekdays they cut full-time duty (7.2 h, or 3.6 h for aðfangadagur / gamlársdagur)."
            action={
              <span className="row">
                <button className="btn plum" onClick={fillHolidays}>
                  Fill Icelandic holidays
                </button>
                <button
                  className="btn add"
                  onClick={() =>
                    set({
                      public_holidays: [
                        ...p.public_holidays,
                        { date: p.period.start, name: 'Holiday', duty_reduction_hours: 7.2, major: false, starts: '00:00', high_from: null },
                      ],
                    })
                  }
                >
                  + Holiday
                </button>
              </span>
            }
          >
            {p.public_holidays.map((h, i) => (
              <div key={i} className="tile">
                <div className="row">
                  <span className="badge" style={{ background: 'var(--lime-soft)', color: 'var(--lime-soft-ink)', flexDirection: 'column', fontSize: 10, lineHeight: 1 }}>
                    {monthShort(h.date)}
                    <b style={{ fontSize: 15 }}>{Number(h.date.slice(8))}</b>
                  </span>
                  <TextField value={h.name} onChange={(name) => set({ public_holidays: patchAt(p.public_holidays, i, { name }) })} />
                  {h.major && <span className="chip hard">Stórhátíð</span>}
                  <RemoveButton label="Remove holiday" onClick={() => set({ public_holidays: removeAt(p.public_holidays, i) })} />
                </div>
                <div className="row">
                  <input type="date" value={h.date} onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, i, { date: e.target.value }) })} />
                  <span className="muted">−</span>
                  <NumberField
                    step={0.1}
                    value={h.duty_reduction_hours}
                    onChange={(v) => set({ public_holidays: patchAt(p.public_holidays, i, { duty_reduction_hours: v ?? 0 }) })}
                  />
                  <span className="muted">h duty</span>
                </div>
                <div className="row">
                  <span className="muted">Holiday from</span>
                  <input
                    type="time"
                    aria-label="Holiday starts"
                    value={h.starts}
                    onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, i, { starts: e.target.value || '00:00' }) })}
                  />
                  <span className="muted">165% from</span>
                  <input
                    type="time"
                    aria-label="165% from"
                    value={h.high_from ?? ''}
                    onChange={(e) => set({ public_holidays: patchAt(p.public_holidays, i, { high_from: e.target.value || null }) })}
                  />
                </div>
              </div>
            ))}
          </Section>
        </div>

        <div className="col-wide">
          <Section
            title="Shift types"
            hint="An end before the start crosses midnight."
            action={
              <button
                className="btn add"
                onClick={() => {
                  const id = newId('S', p.shift_types)
                  set({ shift_types: [...p.shift_types, { id, code: id, name: 'New shift', start: '08:00', end: '16:00', break_minutes: 0, is_night: false }] })
                }}
              >
                + Shift
              </button>
            }
          >
            <div className="card-grid">
              {p.shift_types.map((s, i) => {
                const c = shiftColor(i)
                const patch = (v: Partial<typeof s>) => set({ shift_types: patchAt(p.shift_types, i, v) })
                return (
                  <div key={s.id} className="shift-card">
                    <div className="row">
                      <input
                        aria-label="Code"
                        className="badge"
                        style={{ background: c.bg, color: c.fg, border: 0, textAlign: 'center', padding: 0, height: 34 }}
                        value={s.code}
                        onChange={(e) => patch({ code: e.target.value })}
                      />
                      <TextField value={s.name} onChange={(name) => patch({ name })} />
                      <RemoveButton label="Remove shift type" onClick={() => set({ shift_types: removeAt(p.shift_types, i) })} />
                    </div>
                    <div className="times">
                      <input type="time" aria-label="Start" value={s.start} onChange={(e) => patch({ start: e.target.value })} />–
                      <input type="time" aria-label="End" value={s.end === '24:00' ? '00:00' : s.end} onChange={(e) => patch({ end: e.target.value })} />
                    </div>
                    <div className="row">
                      <label className="field inline">
                        <NumberField width={70} value={s.break_minutes} onChange={(v) => patch({ break_minutes: v ?? 0 })} />
                        <span className="muted">min unpaid break</span>
                      </label>
                      <span className="spacer" />
                      <label className="row">
                        <input type="checkbox" checked={s.is_night} onChange={(e) => patch({ is_night: e.target.checked })} />
                        {s.is_night ? <span className="night-tag">Night</span> : <span className="muted">Night</span>}
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          <Section
            title="Staff"
            count={p.staff.length}
            hint="The first group decides where a person is listed. No shifts ticked = may work any shift."
            action={
              <button
                className="btn plum"
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
                        competence_ids: [],
                        employee_number: null,
                      },
                    ],
                  })
                }
              >
                + Add person
              </button>
            }
          >
            <div className="table-scroll">
              <table className="form-table" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th title="Starfsmannanúmer — matches people in Excel / MTP files">No.</th>
                    <th>Group</th>
                    <th>Employment</th>
                    <th>May work</th>
                    {p.competences.length > 0 && <th>Competences</th>}
                    <th title="Contract hours for the whole period, instead of employment %">Hours override</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.staff.map((s, i) => (
                    <tr key={s.id}>
                      <td>
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="avatar">{s.name.charAt(0)}</span>
                          <TextField value={s.name} onChange={(name) => set({ staff: patchAt(p.staff, i, { name }) })} />
                        </span>
                      </td>
                      <td>
                        <input
                          aria-label={`${s.name} employee number`}
                          style={{ width: 72 }}
                          value={s.employee_number ?? ''}
                          onChange={(e) => set({ staff: patchAt(p.staff, i, { employee_number: e.target.value || null }) })}
                        />
                      </td>
                      <td>
                        <Checks values={s.group_ids} options={groupOptions} onChange={(group_ids) => set({ staff: patchAt(p.staff, i, { group_ids }) })} />
                      </td>
                      <td>
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="bar">
                            <span style={{ width: `${s.employment_percent}%` }} />
                          </span>
                          <NumberField width={72} value={s.employment_percent} onChange={(v) => set({ staff: patchAt(p.staff, i, { employment_percent: v ?? 100 }) })} />
                        </span>
                      </td>
                      <td>
                        <Checks
                          values={s.allowed_shift_ids ?? []}
                          options={shiftOptions}
                          onChange={(ids) => set({ staff: patchAt(p.staff, i, { allowed_shift_ids: ids.length ? ids : null }) })}
                        />
                      </td>
                      {p.competences.length > 0 && (
                        <td>
                          <Checks
                            values={s.competence_ids}
                            options={p.competences.map((c) => ({ value: c.id, label: c.name }))}
                            onChange={(competence_ids) => set({ staff: patchAt(p.staff, i, { competence_ids }) })}
                          />
                        </td>
                      )}
                      <td>
                        <NumberField width={80} nullable value={s.target_hours_override} onChange={(v) => set({ staff: patchAt(p.staff, i, { target_hours_override: v }) })} />
                      </td>
                      <td className="right">
                        <RemoveButton
                          label={`Remove ${s.name}`}
                          onClick={() =>
                            set({
                              staff: removeAt(p.staff, i),
                              leave: p.leave.filter((l) => l.staff_id !== s.id),
                              custom_rules: p.custom_rules.filter((r) => !('staff_id' in r && r.staff_id === s.id)),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>
    </>
  )
}
