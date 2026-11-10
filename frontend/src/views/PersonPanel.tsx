import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Select } from '../components/fields'
import { CloseIcon } from '../components/icons'
import { RuleCard } from '../components/RuleCard'
import { blankRule, describeRule, isPersonRule, PERSON_RULE_TYPES } from '../rules'
import { useI18n } from '../i18n'
import { newId } from '../store'
import type { CustomRule, Evaluation, Project, WishSuggestion } from '../types'

interface Props {
  project: Project
  setProject: (p: Project) => void
  evaluation: Evaluation | null
  staffId: string
  onClose: () => void
}

/** One person's wishes: the note as they wrote it, suggested rules read from it, and their rules. */
export function PersonPanel({ project: p, setProject, evaluation, staffId, onClose }: Props) {
  const i = useI18n()
  const { t } = i
  const idx = p.staff.findIndex((s) => s.id === staffId)
  const person = p.staff[idx]
  const [newType, setNewType] = useState<CustomRule['type']>('weekend_pattern')
  const [suggestions, setSuggestions] = useState<WishSuggestion[]>([])

  const rules = p.custom_rules.map((r, at) => ({ r, at })).filter(({ r }) => isPersonRule(r) && r.staff_id === staffId)
  const ruleIds = useMemo(() => new Set(rules.map(({ r }) => r.id)), [rules])
  const unmet = (evaluation?.violations ?? []).filter((v) => v.staff_id === staffId && ruleIds.has(v.rule))

  // Re-read the note as it changes; suggestions already accepted are not offered again.
  const note = person?.note ?? ''
  const mine = JSON.stringify(rules.map(({ r }) => r.description))
  useEffect(() => {
    if (!note.trim()) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(() => {
      api
        .suggestWishes(p)
        .then((all) => setSuggestions(all.filter((s) => s.staff_id === staffId)))
        .catch(() => setSuggestions([]))
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, mine, staffId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!person) return null

  const setRules = (next: CustomRule[]) => setProject({ ...p, custom_rules: next })
  const accept = (picked: WishSuggestion[]) => {
    const added: CustomRule[] = []
    for (const s of picked) added.push({ ...s.rule, id: newId('wish', [...p.custom_rules, ...added]) })
    setRules([...p.custom_rules, ...added])
  }
  const group = p.groups.find((g) => g.id === person.group_ids[0])?.name

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="person-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="person-title">{person.name}</h2>
            <span className="muted">
              {[group, `${person.employment_percent}%`].filter(Boolean).join(' · ')}
              {rules.length > 0 && ` · ${i.tn(rules.length, '{n} rule', '{n} rules')}`}
              {unmet.length > 0 && ` · ${i.tn(unmet.length, '{n} not met in this roster', '{n} not met in this roster')}`}
            </span>
          </div>
          <button type="button" className="icon-btn close" aria-label={t('Close')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        <label className="field">
          <span className="label">{t('Wishes, as they wrote them')}</span>
          <textarea
            rows={2}
            placeholder={t('e.g. every other weekend, no evenings')}
            value={person.note}
            onChange={(e) => setProject({ ...p, staff: p.staff.map((s) => (s.id === staffId ? { ...s, note: e.target.value } : s)) })}
          />
        </label>

        {suggestions.length > 0 && (
          <fieldset>
            <legend className="row">
              {t('Read from the wishes')}
              <span className="spacer" />
              <button type="button" className="btn small primary" onClick={() => accept(suggestions)}>
                {t('Add all')}
              </button>
            </legend>
            <ul className="list suggestions">
              {suggestions.map((s, k) => (
                <li key={k}>
                  <span className="quote">“{s.text}”</span>
                  <span className="chip">{describeRule(i, p, s.rule)}</span>
                  <span className="muted small">{s.rule.hard ? t('Hard') : t('{n} pts', { n: s.rule.weight })}</span>
                  <button type="button" className="btn small" onClick={() => accept([s])}>
                    {t('Add')}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {unmet.length > 0 && (
          <div className="alert warning">
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {unmet.slice(0, 6).map((v, k) => (
                <li key={k}>
                  {v.date ? `${i.day(v.date)}: ` : ''}
                  {v.message}
                </li>
              ))}
              {unmet.length > 6 && <li className="muted">{t('and {n} more', { n: unmet.length - 6 })}</li>}
            </ul>
          </div>
        )}

        <fieldset>
          <legend>{t('Rules for {name}', { name: person.name })}</legend>
          {rules.length === 0 && <p className="muted small" style={{ margin: '0 0 8px' }}>{t('None yet. Add the suggestions above, or a rule below.')}</p>}
          <div className="person-rule-list">
            {rules.map(({ r, at }) => (
              <RuleCard
                key={r.id}
                rule={r}
                project={p}
                showStaff={false}
                onChange={(patch) => setRules(p.custom_rules.map((x, k) => (k === at ? ({ ...x, ...patch } as CustomRule) : x)))}
                onRemove={() => setRules(p.custom_rules.filter((_, k) => k !== at))}
              />
            ))}
          </div>
        </fieldset>

        <div className="modal-actions">
          <label className="field inline">
            <span className="sr-only">{t('Rule type to add')}</span>
            <Select value={newType} options={PERSON_RULE_TYPES.filter((x) => x.value !== 'fixed_area' || p.areas.length).map((x) => ({ value: x.value, label: t(x.label) }))} onChange={setNewType} />
          </label>
          <button className="btn" onClick={() => setRules([...p.custom_rules, blankRule(newType, p, newId('wish', p.custom_rules), staffId)])}>
            {t('Add rule')}
          </button>
          <span className="keys">{t('Soft rules are wishes; hard rules are never broken.')}</span>
          <button className="btn primary" onClick={onClose}>
            {t('Done')}
          </button>
        </div>
      </div>
    </div>
  )
}
