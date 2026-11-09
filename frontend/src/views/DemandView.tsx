import type { ReactNode } from 'react'
import { Checks, NumberField, PageHead, RemoveButton, Section } from '../components/fields'
import { periodDates } from '../dates'
import { useI18n } from '../i18n'
import { patchAt, removeAt } from '../lists'
import { shiftColor } from '../shiftColors'
import type { Project } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

function DatesField({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  const { t } = useI18n()
  return (
    <input
      placeholder={t('Every week')}
      title={t('Comma-separated YYYY-MM-DD. When set, this row replaces weekday rows on those dates.')}
      defaultValue={value?.join(', ') ?? ''}
      style={{ width: 170 }}
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

function ShiftBadge({ project, shiftId }: { project: Project; shiftId: string }) {
  const idx = project.shift_types.findIndex((s) => s.id === shiftId)
  const c = shiftColor(Math.max(0, idx))
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      {project.shift_types[idx]?.code ?? '?'}
    </span>
  )
}

function Options<T extends string>({ value, items, onChange, label }: { value: T; items: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {items.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** A compact list row for the per-area, per-skill and per-task cards. */
function DemandRow({ children, when, onRemove }: { children: ReactNode; when: ReactNode; onRemove: () => void }) {
  return (
    <li style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="row">
        {children}
        <span className="spacer" />
        <RemoveButton onClick={onRemove} />
      </div>
      <div className="row">{when}</div>
    </li>
  )
}

export function DemandView({ project: p, setProject }: Props) {
  const i = useI18n()
  const { t } = i
  const set = (patch: Partial<Project>) => setProject({ ...p, ...patch })
  const shifts = p.shift_types.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))
  const groups = p.groups.map((g) => ({ id: g.id, label: g.name }))
  // Any Monday-to-Sunday week works for the weekday labels.
  const week = periodDates('2026-11-30', 7)
  const weekdayOptions = ALL_DAYS.map((value) => ({ value, label: i.weekdayShort(week[value]) }))

  // A normal weekday (Monday): minimum headcount per shift across groups, and skill minimums.
  const typical = p.shift_types
    .map((s) => ({
      s,
      n: p.coverage.filter((c) => c.shift_id === s.id && !c.dates && c.weekdays.includes(0)).reduce((n, c) => n + c.min, 0),
    }))
    .map(({ s, n }) => `${s.name} ${n}`)
    .join(' · ')

  const when = (weekdays: number[], dates: string[] | null, onDays: (d: number[]) => void, onDates: (d: string[] | null) => void) => (
    <>
      {!dates && <Checks values={weekdays} options={weekdayOptions} onChange={onDays} />}
      {dates && <span className="muted">{t('Only the dates listed')}</span>}
      <DatesField value={dates} onChange={onDates} />
    </>
  )

  return (
    <>
      <PageHead
        title={t('Demand')}
        sub={
          <>
            {t('Minimum headcount on a normal weekday:')} <b>{typical}</b>
          </>
        }
      />

      <Section
        title={t('Staffing per shift')}
        hint={t('How many from each group. A row for specific dates replaces the weekday rows on those dates.')}
        action={
          <button
            className="btn primary"
            onClick={() => set({ coverage: [...p.coverage, { shift_id: p.shift_types[0]?.id ?? '', group_id: p.groups[0]?.id ?? '', weekdays: ALL_DAYS, dates: null, min: 1, max: null }] })}
          >
            {t('Add staffing row')}
          </button>
        }
      >
        <div className="table-scroll">
          <table className="form-table" style={{ minWidth: 940 }}>
            <thead>
              <tr>
                <th>{t('Shift')}</th>
                <th>{t('Group')}</th>
                <th>{t('Applies on')}</th>
                <th>{t('Specific dates')}</th>
                <th>{t('At least')}</th>
                <th>{t('At most')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.coverage.map((c, idx) => {
                const patch = (v: Partial<typeof c>) => set({ coverage: patchAt(p.coverage, idx, v) })
                return (
                  <tr key={`${idx}-${c.dates?.join() ?? ''}`}>
                    <td>
                      <span className="row" style={{ flexWrap: 'nowrap' }}>
                        <ShiftBadge project={p} shiftId={c.shift_id} />
                        <Options label={t('Shift')} value={c.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                      </span>
                    </td>
                    <td>
                      <Options label={t('Group')} value={c.group_id} items={groups} onChange={(group_id) => patch({ group_id })} />
                    </td>
                    <td>{c.dates ? <span className="muted">{t('Only the dates listed')}</span> : <Checks values={c.weekdays} options={weekdayOptions} onChange={(weekdays) => patch({ weekdays })} />}</td>
                    <td>
                      <DatesField value={c.dates} onChange={(dates) => patch({ dates })} />
                    </td>
                    <td>
                      <NumberField value={c.min} onChange={(v) => patch({ min: v ?? 0 })} />
                    </td>
                    <td>
                      <NumberField nullable placeholder={t('Any')} value={c.max} onChange={(max) => patch({ max })} />
                    </td>
                    <td className="right">
                      <RemoveButton label={t('Remove row')} onClick={() => set({ coverage: removeAt(p.coverage, idx) })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="cols">
        <div className="col">
          <Section
            title={t('Staffing per area')}
            hint={t('A group with any area row on a shift has every working member placed in one hallway.')}
            action={
              <button
                className="btn"
                disabled={!p.areas.length}
                onClick={() =>
                  set({
                    area_demand: [...p.area_demand, { area_id: p.areas[0].id, shift_id: p.shift_types[0]?.id ?? '', group_id: p.groups[0]?.id ?? '', weekdays: ALL_DAYS, dates: null, min: 1, max: null }],
                  })
                }
              >
                {t('Add area row')}
              </button>
            }
          >
            {p.areas.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {t('Add areas under Setup to plan per hallway.')}
              </p>
            ) : (
              <ul className="list">
                {p.area_demand.map((ad, idx) => {
                  const patch = (v: Partial<typeof ad>) => set({ area_demand: patchAt(p.area_demand, idx, v) })
                  return (
                    <DemandRow
                      key={`${idx}-${ad.dates?.join() ?? ''}`}
                      onRemove={() => set({ area_demand: removeAt(p.area_demand, idx) })}
                      when={when(ad.weekdays, ad.dates, (weekdays) => patch({ weekdays }), (dates) => patch({ dates }))}
                    >
                      <ShiftBadge project={p} shiftId={ad.shift_id} />
                      <Options label={t('Area')} value={ad.area_id} items={p.areas.map((a) => ({ id: a.id, label: a.name }))} onChange={(area_id) => patch({ area_id })} />
                      <Options label={t('Shift')} value={ad.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                      <Options label={t('Group')} value={ad.group_id} items={groups} onChange={(group_id) => patch({ group_id })} />
                      <label className="field inline">
                        {t('At least')}
                        <NumberField width={64} value={ad.min} onChange={(v) => patch({ min: v ?? 0 })} />
                      </label>
                    </DemandRow>
                  )
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="col">
          <Section
            title={t('Skills per shift')}
            hint={t('At least this many people with a skill, counted across all groups, or within one hallway.')}
            action={
              <button
                className="btn"
                disabled={!p.competences.length}
                onClick={() =>
                  set({
                    competence_demand: [...p.competence_demand, { competence_id: p.competences[0].id, shift_id: p.shift_types[0]?.id ?? '', area_id: null, weekdays: ALL_DAYS, dates: null, min: 1 }],
                  })
                }
              >
                {t('Add skill row')}
              </button>
            }
          >
            {p.competences.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {t('Add skills under Setup (e.g. Lyfjaréttindi, Íslenska).')}
              </p>
            ) : (
              <ul className="list">
                {p.competence_demand.map((cd, idx) => {
                  const patch = (v: Partial<typeof cd>) => set({ competence_demand: patchAt(p.competence_demand, idx, v) })
                  return (
                    <DemandRow
                      key={`${idx}-${cd.dates?.join() ?? ''}`}
                      onRemove={() => set({ competence_demand: removeAt(p.competence_demand, idx) })}
                      when={when(cd.weekdays, cd.dates, (weekdays) => patch({ weekdays }), (dates) => patch({ dates }))}
                    >
                      <ShiftBadge project={p} shiftId={cd.shift_id} />
                      <Options label={t('Skill')} value={cd.competence_id} items={p.competences.map((c) => ({ id: c.id, label: c.name }))} onChange={(competence_id) => patch({ competence_id })} />
                      <Options label={t('Shift')} value={cd.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                      <Options
                        label={t('Where')}
                        value={cd.area_id ?? ''}
                        items={[{ id: '', label: t('Whole shift') }, ...p.areas.map((a) => ({ id: a.id, label: a.name }))]}
                        onChange={(area_id) => patch({ area_id: area_id || null })}
                      />
                      <label className="field inline">
                        {t('At least')}
                        <NumberField width={64} value={cd.min} onChange={(v) => patch({ min: v ?? 0 })} />
                      </label>
                    </DemandRow>
                  )
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="col">
          <Section
            title={t('Task needs')}
            hint={t('People per task on a shift. Each person does at most one task per shift.')}
            action={
              <button
                className="btn"
                disabled={!p.tasks.length}
                onClick={() => set({ task_demand: [...p.task_demand, { task_id: p.tasks[0].id, shift_id: p.shift_types[0]?.id ?? '', weekdays: ALL_DAYS, dates: null, count: 1 }] })}
              >
                {t('Add task row')}
              </button>
            }
          >
            <ul className="list">
              {p.task_demand.map((td, idx) => {
                const patch = (v: Partial<typeof td>) => set({ task_demand: patchAt(p.task_demand, idx, v) })
                return (
                  <DemandRow
                    key={`${idx}-${td.dates?.join() ?? ''}`}
                    onRemove={() => set({ task_demand: removeAt(p.task_demand, idx) })}
                    when={when(td.weekdays, td.dates, (weekdays) => patch({ weekdays }), (dates) => patch({ dates }))}
                  >
                    <ShiftBadge project={p} shiftId={td.shift_id} />
                    <Options label={t('Task')} value={td.task_id} items={p.tasks.map((x) => ({ id: x.id, label: x.name }))} onChange={(task_id) => patch({ task_id })} />
                    <Options label={t('Shift')} value={td.shift_id} items={shifts} onChange={(shift_id) => patch({ shift_id })} />
                    <label className="field inline">
                      <NumberField width={64} value={td.count} onChange={(v) => patch({ count: v ?? 0 })} />
                      {td.count === 1 ? t('person') : t('people')}
                    </label>
                  </DemandRow>
                )
              })}
            </ul>
          </Section>
        </div>
      </div>
    </>
  )
}
