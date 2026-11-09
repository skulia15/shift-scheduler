import { useState } from 'react'
import { Checks, NumberField, PageHead, RemoveButton, Section, TextField } from '../components/fields'
import { CloseIcon } from '../components/icons'
import { periodDates } from '../dates'
import { useI18n } from '../i18n'
import { patchAt, removeAt } from '../lists'
import { shiftColor } from '../shiftColors'
import { newId } from '../store'
import type { Assignment, Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
  roster: Assignment[]
  setRoster: (r: Assignment[]) => void
}

export function SetupView({ project: p, setProject, roster, setRoster }: Props) {
  const i = useI18n()
  const { t } = i
  const [query, setQuery] = useState('')
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const groupOptions = p.groups.map((g) => ({ value: g.id, label: g.name }))
  const shiftOptions = p.shift_types.map((s) => ({ value: s.id, label: s.code }))
  const dates = periodDates(p.period.start, Math.max(1, p.period.days))
  const end = dates[dates.length - 1]
  const shownStaff = p.staff.map((s, idx) => ({ s, idx })).filter(({ s }) => !query || s.name.toLowerCase().includes(query.toLowerCase()))

  const removePerson = (idx: number) => {
    const s = p.staff[idx]
    if (!confirm(t('Remove {name}? Their leave and roster cells are removed too.', { name: s.name }))) return
    set({
      staff: removeAt(p.staff, idx),
      leave: p.leave.filter((l) => l.staff_id !== s.id),
      custom_rules: p.custom_rules.filter((r) => !('staff_id' in r && r.staff_id === s.id)),
    })
    setRoster(roster.filter((a) => a.staff_id !== s.id))
  }

  return (
    <>
      <PageHead title={t('Setup')} sub={t('Changes take effect the next time you repair or regenerate the roster.')} />
      <div className="cols">
        <div className="col-narrow">
          <Section title={t('Period')}>
            <div className="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label className="field">
                {t('Starts')}
                <input type="date" value={p.period.start} onChange={(e) => e.target.value && set({ period: { ...p.period, start: e.target.value } })} />
              </label>
              <label className="field">
                {t('Length in days')}
                <NumberField value={p.period.days} onChange={(v) => set({ period: { ...p.period, days: Math.max(1, Math.min(84, v ?? 28)) } })} />
              </label>
            </div>
            <p className="help" style={{ margin: 0 }}>
              {t('Ends {date}. 1–84 days; whole weeks keep weekend fairness simple.', { date: `${i.day(end)} ${end.slice(0, 4)}` })}
            </p>
          </Section>

          <Section
            title={t('Groups & tasks')}
            hint={t('Tasks are duties within a shift, done by one group. A task can require a skill.')}
            action={
              <button className="btn" onClick={() => set({ groups: [...p.groups, { id: newId('group', p.groups), name: t('New group') }] })}>
                {t('Add group')}
              </button>
            }
          >
            {p.groups.map((g, gi) => (
              <div key={g.id} className="group-box">
                <div className="row">
                  <TextField value={g.name} onChange={(name) => set({ groups: patchAt(p.groups, gi, { name }) })} />
                  <span className="muted small">{i.tn(p.staff.filter((s) => s.group_ids.includes(g.id)).length, '{n} person', '{n} people')}</span>
                  <span className="spacer" />
                  <RemoveButton label={t('Remove group')} onClick={() => set({ groups: removeAt(p.groups, gi) })} />
                </div>
                <div className="row">
                  {p.tasks.map((x, ti) =>
                    x.group_id !== g.id ? null : (
                      <span key={x.id} className="chip-input">
                        <input aria-label={t('Task name')} value={x.name} onChange={(e) => set({ tasks: patchAt(p.tasks, ti, { name: e.target.value }) })} />
                        {p.competences.length > 0 && (
                          <select
                            aria-label={t('Required skill')}
                            className="chip-select"
                            value={x.competence_id ?? ''}
                            onChange={(e) => set({ tasks: patchAt(p.tasks, ti, { competence_id: e.target.value || null }) })}
                          >
                            <option value="">{t('anyone')}</option>
                            {p.competences.map((c) => (
                              <option key={c.id} value={c.id}>
                                {t('needs {skill}', { skill: c.name })}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('Remove {name}', { name: x.name })}
                          onClick={() => set({ tasks: removeAt(p.tasks, ti), task_demand: p.task_demand.filter((d) => d.task_id !== x.id) })}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </span>
                    ),
                  )}
                  <button
                    type="button"
                    className="dashed-btn"
                    onClick={() => set({ tasks: [...p.tasks, { id: newId('task', p.tasks), name: t('New task'), group_id: g.id, competence_id: null }] })}
                  >
                    {t('Add task')}
                  </button>
                </div>
              </div>
            ))}
          </Section>

          <Section
            title={t('Areas')}
            hint={t('Hallways or floors people are placed in. Staffing per area is set under Demand.')}
            action={
              <button
                className="btn"
                onClick={() => {
                  const id = newId('area', p.areas)
                  set({ areas: [...p.areas, { id, code: String.fromCharCode(65 + p.areas.length), name: t('New area') }] })
                }}
              >
                {t('Add area')}
              </button>
            }
          >
            {p.areas.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {t('No areas: everyone works the whole unit.')}
              </p>
            )}
            {p.areas.map((a, idx) => (
              <div key={a.id} className="row">
                <TextField className="code" value={a.code} onChange={(code) => set({ areas: patchAt(p.areas, idx, { code }) })} />
                <TextField value={a.name} onChange={(name) => set({ areas: patchAt(p.areas, idx, { name }) })} />
                <RemoveButton
                  label={t('Remove area')}
                  onClick={() =>
                    set({
                      areas: removeAt(p.areas, idx),
                      area_demand: p.area_demand.filter((d) => d.area_id !== a.id),
                      custom_rules: p.custom_rules.filter((r) => !(r.type === 'fixed_area' && r.area_id === a.id)),
                    })
                  }
                />
              </div>
            ))}
          </Section>

          <Section
            title={t('Skills')}
            hint={t('Tag people with skills, then require them per shift or hallway under Demand. A task can require a skill.')}
            action={
              <button className="btn" onClick={() => set({ competences: [...p.competences, { id: newId('comp', p.competences), name: t('New skill') }] })}>
                {t('Add skill')}
              </button>
            }
          >
            {p.competences.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {t('None yet, e.g. Lyfjaréttindi, Íslenska, Vaktstjóri.')}
              </p>
            )}
            {p.competences.map((c, idx) => (
              <div key={c.id} className="row">
                <TextField value={c.name} onChange={(name) => set({ competences: patchAt(p.competences, idx, { name }) })} />
                <span className="muted small">{i.tn(p.staff.filter((s) => s.competence_ids.includes(c.id)).length, '{n} person', '{n} people')}</span>
                <RemoveButton
                  label={t('Remove skill')}
                  onClick={() =>
                    set({
                      competences: removeAt(p.competences, idx),
                      competence_demand: p.competence_demand.filter((d) => d.competence_id !== c.id),
                      staff: p.staff.map((s) => ({ ...s, competence_ids: s.competence_ids.filter((x) => x !== c.id) })),
                      tasks: p.tasks.map((x) => (x.competence_id === c.id ? { ...x, competence_id: null } : x)),
                    })
                  }
                />
              </div>
            ))}
          </Section>
        </div>

        <div className="col-wide">
          <Section
            title={t('Shift types')}
            hint={t('An end before the start crosses midnight.')}
            action={
              <button
                className="btn"
                onClick={() => {
                  const id = newId('S', p.shift_types)
                  set({ shift_types: [...p.shift_types, { id, code: id, name: t('New shift'), start: '08:00', end: '16:00', break_minutes: 0, is_night: false }] })
                }}
              >
                {t('Add shift')}
              </button>
            }
          >
            <div className="table-scroll">
              <table className="form-table">
                <thead>
                  <tr>
                    <th>{t('Code')}</th>
                    <th>{t('Name')}</th>
                    <th>{t('Starts')}</th>
                    <th>{t('Ends')}</th>
                    <th>{t('Unpaid break')}</th>
                    <th>{t('Night')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.shift_types.map((s, idx) => {
                    const c = shiftColor(idx)
                    const patch = (v: Partial<typeof s>) => set({ shift_types: patchAt(p.shift_types, idx, v) })
                    return (
                      <tr key={s.id}>
                        <td>
                          <input
                            aria-label={t('Code')}
                            className="code"
                            style={{ background: c.bg, color: c.fg, borderColor: 'transparent' }}
                            value={s.code}
                            onChange={(e) => patch({ code: e.target.value })}
                          />
                        </td>
                        <td>
                          <TextField value={s.name} onChange={(name) => patch({ name })} />
                        </td>
                        <td>
                          <input type="time" aria-label={t('Starts')} value={s.start} onChange={(e) => patch({ start: e.target.value })} />
                        </td>
                        <td>
                          <input type="time" aria-label={t('Ends')} value={s.end === '24:00' ? '00:00' : s.end} onChange={(e) => patch({ end: e.target.value })} />
                        </td>
                        <td>
                          <span className="row" style={{ flexWrap: 'nowrap' }}>
                            <NumberField width={70} value={s.break_minutes} onChange={(v) => patch({ break_minutes: v ?? 0 })} />
                            <span className="muted">{t('min')}</span>
                          </span>
                        </td>
                        <td>
                          <input type="checkbox" aria-label={t('Night')} checked={s.is_night} onChange={(e) => patch({ is_night: e.target.checked })} />
                        </td>
                        <td className="right">
                          <RemoveButton label={t('Remove shift type')} onClick={() => set({ shift_types: removeAt(p.shift_types, idx) })} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title={t('Staff')}
            count={p.staff.length}
            action={
              <span className="row">
                <input type="search" placeholder={t('Find a person')} aria-label={t('Find a person')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 180 }} />
                <button
                  className="btn primary"
                  onClick={() =>
                    set({
                      staff: [
                        ...p.staff,
                        {
                          id: newId('s', p.staff),
                          name: t('New person'),
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
                  {t('Add person')}
                </button>
              </span>
            }
          >
            <div className="table-scroll">
              <table className="form-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th title={t('Starfsmannanúmer: matches people in Excel / MTP files')}>{t('No.')}</th>
                    <th>{t('Group')}</th>
                    <th>{t('Employment')}</th>
                    <th title={t('None ticked: may work any shift')}>{t('May work')}</th>
                    {p.competences.length > 0 && <th>{t('Skills')}</th>}
                    <th title={t('Contract hours for the whole period, instead of employment %')}>{t('Hours override')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shownStaff.map(({ s, idx }) => (
                    <tr key={s.id}>
                      <td>
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="avatar">{s.name.charAt(0)}</span>
                          <TextField value={s.name} onChange={(name) => set({ staff: patchAt(p.staff, idx, { name }) })} />
                        </span>
                      </td>
                      <td>
                        <input
                          aria-label={t('{name} employee number', { name: s.name })}
                          style={{ width: 72 }}
                          value={s.employee_number ?? ''}
                          onChange={(e) => set({ staff: patchAt(p.staff, idx, { employee_number: e.target.value || null }) })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={t('Group')}
                          value={s.group_ids[0] ?? ''}
                          onChange={(e) => set({ staff: patchAt(p.staff, idx, { group_ids: [e.target.value, ...s.group_ids.slice(1).filter((g) => g !== e.target.value)] }) })}
                        >
                          {groupOptions.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <NumberField width={72} value={s.employment_percent} onChange={(v) => set({ staff: patchAt(p.staff, idx, { employment_percent: v ?? 100 }) })} />
                          <span className="muted">%</span>
                        </span>
                      </td>
                      <td>
                        <Checks values={s.allowed_shift_ids ?? []} options={shiftOptions} onChange={(ids) => set({ staff: patchAt(p.staff, idx, { allowed_shift_ids: ids.length ? ids : null }) })} />
                      </td>
                      {p.competences.length > 0 && (
                        <td>
                          <Checks
                            values={s.competence_ids}
                            options={p.competences.map((c) => ({ value: c.id, label: c.name }))}
                            onChange={(competence_ids) => set({ staff: patchAt(p.staff, idx, { competence_ids }) })}
                          />
                        </td>
                      )}
                      <td>
                        <NumberField width={80} nullable placeholder={t('Off')} value={s.target_hours_override} onChange={(v) => set({ staff: patchAt(p.staff, idx, { target_hours_override: v }) })} />
                      </td>
                      <td className="right">
                        <RemoveButton label={t('Remove {name}', { name: s.name })} onClick={() => removePerson(idx)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="help" style={{ margin: 0 }}>
              {t('Removing someone asks first, because it also removes their leave and roster cells.')}
            </p>
          </Section>
        </div>
      </div>
    </>
  )
}
