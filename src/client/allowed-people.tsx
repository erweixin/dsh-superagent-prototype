/** Source-independent member selection. Lookups, copy, ID rules and error hints are supplied by the adapter. */
import { useEffect, useRef, useState } from 'react'
import { Button, Icon, Input, Modal } from './controls.tsx'
import { Field } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint } from './widgets.tsx'

export type Person = { id: string; name?: string }
export type PeopleTextKey = 'choose' | 'intro' | 'scope' | 'chooseScope' | 'refreshScopes' | 'noScopes' | 'search' | 'members'
  | 'loadFailed' | 'noMatches' | 'empty' | 'alreadyAdded' | 'addSelected' | 'refreshMembers' | 'noneSelected'
  | 'syncWarning' | 'manual' | 'name' | 'close' | 'cancel' | 'loading' | 'removeRow' | 'addRow'
export interface AllowedPeopleProps {
  label: string
  value: Person[]
  labels: Record<string, string>
  initialScope: string
  syncEnabled: boolean
  idLabel: string
  validId(id: string): boolean
  text(key: PeopleTextKey, values?: Record<string, string | number>): string
  errorHint(error: string): string | undefined
  onChange(value: Person[]): void
  loadPeople(scope: string): Promise<Person[]>
  refreshScopes(): Promise<void>
}

function PeoplePicker({ value, labels, initialScope, refreshScopes, loadPeople, text: t, errorHint, onAdd, onClose }: AllowedPeopleProps & {
  onAdd(people: Person[]): void; onClose(): void
}) {
  const scopes = Object.entries(labels).sort(([, a], [, b]) => a.localeCompare(b))
  const [scope, setScope] = useState(initialScope || scopes[0]?.[0] || '')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Record<string, Person>>({})
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ scope: string; people: Person[]; error?: string }>()
  const refreshing = useRef(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const refresh = async () => {
    if (refreshing.current) return
    refreshing.current = true
    setRefreshBusy(true)
    setRefreshError('')
    try { await refreshScopes() }
    catch (failure) { setRefreshError(errorText(failure)) }
    finally { refreshing.current = false; setRefreshBusy(false) }
  }
  // A freshly loaded scope catalog supplies the initial selection without replacing an operator's choice.
  const firstScope = scopes[0]?.[0] ?? ''
  useEffect(() => { if (!scope && firstScope) setScope(firstScope) }, [scope, firstScope])
  useEffect(() => {
    if (!scope) return
    let active = true
    setResult(undefined)
    loadPeople(scope).then(
      people => { if (active) setResult({ scope, people }) },
      failure => { if (active) setResult({ scope, people: [], error: errorText(failure) }) }
    )
    return () => { active = false }
  }, [loadPeople, scope, revision])
  const current = result?.scope === scope ? result : undefined
  const existing = new Set(value.map(person => person.id))
  const pending = Object.values(selected).filter(person => !existing.has(person.id))
  const search = query.trim().toLocaleLowerCase()
  const people = current?.people.filter(person => `${person.name ?? ''} ${person.id}`.toLocaleLowerCase().includes(search)) ?? []
  return <Modal open title={t('choose')} closeLabel={t('close')} onClose={onClose} description={t('intro')}
    footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      <Button disabled={!pending.length} onClick={() => onAdd(pending)}>{t('addSelected', { count: pending.length })}</Button></>}>
    <div className="dt-people-picker">
      <div className="dt-people-toolbar">
        <Field label={t('scope')}><select className="dt-select" value={scope} onChange={event => { setScope(event.target.value); setQuery('') }}>
          <option value="" disabled>{t('chooseScope')}</option>
          {scope && !labels[scope] && <option value={scope}>{scope}</option>}
          {scopes.map(([id, name]) => <option key={id} value={id}>{name || id}</option>)}
        </select></Field>
        <Button variant="outline" size="sm" disabled={refreshBusy} onClick={() => { void refresh() }}>{t('refreshScopes')}</Button>
      </div>
      {refreshError && <p className="dt-error" role="alert">{refreshError}</p>}
      {!scopes.length && <Hint>{t('noScopes')}</Hint>}
      <Field label={t('search')}><Input type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field>
      <div aria-live="polite">
        {scope && !current && <Hint>{t('loading')}</Hint>}
        {current?.error && <p className="dt-error" role="alert">{t('loadFailed', { error: current.error })}</p>}
        {current?.error && errorHint(current.error) && <Hint>{errorHint(current.error)}</Hint>}
        {current && !current.error && !people.length && <Hint>{t(query.trim() ? 'noMatches' : 'empty')}</Hint>}
      </div>
      {people.length > 0 && <ul className="dt-people-list dt-people-options" aria-label={t('members')}>
        {people.map(person => <li key={person.id}><label className="dt-person-option">
          <input type="checkbox" checked={existing.has(person.id) || !!selected[person.id]} disabled={existing.has(person.id)}
            onChange={event => setSelected(before => {
              const next = { ...before }
              if (event.target.checked) next[person.id] = person
              else delete next[person.id]
              return next
            })} />
          <span className="dt-person-name">{person.name || person.id}<small>{person.id}</small></span>
          {existing.has(person.id) && <small>{t('alreadyAdded')}</small>}
        </label></li>)}
      </ul>}
      {scope && <Button variant="ghost" size="sm" disabled={!current} onClick={() => setRevision(revision + 1)}>{t('refreshMembers')}</Button>}
    </div>
  </Modal>
}

export function AllowedPeople(props: AllowedPeopleProps) {
  const { value, label, onChange, syncEnabled, text: t, idLabel, validId } = props
  const [open, setOpen] = useState(false)
  const [manualId, setManualId] = useState('')
  const [manualName, setManualName] = useState('')
  const add = (people: Person[]) => {
    const ids = new Set(value.map(person => person.id))
    onChange([...value, ...people.filter(person => {
      if (ids.has(person.id)) return false
      ids.add(person.id)
      return true
    })])
    setOpen(false)
  }
  const id = manualId.trim()
  return <div className="dt-field">
    <div className="dt-subhead">
      <span className="dt-field-head">{label}<span className="dt-count">{value.length || ''}</span></span>
      <Button variant="outline" size="sm" icon={<Icon name="plus" />} onClick={() => setOpen(true)}>{t('choose')}</Button>
    </div>
    {!value.length && <Hint>{t('noneSelected')}</Hint>}
    {!!value.length && <ul className="dt-people-list">{value.map(person => <li key={person.id} className="dt-person">
      <span className="dt-person-name">{person.name || person.id}<small>{person.id}</small></span>
      <Button variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={t('removeRow', { name: person.name || person.id })}
        onClick={() => onChange(value.filter(item => item.id !== person.id))} />
    </li>)}</ul>}
    {syncEnabled && <Hint>{t('syncWarning')}</Hint>}
    <details className="dt-people-manual"><summary>{t('manual')}</summary>
      <div className="dt-people-toolbar">
        <Field label={idLabel}><Input value={manualId} spellCheck={false} onChange={event => setManualId(event.target.value)} /></Field>
        <Field label={t('name')}><Input value={manualName} maxLength={100} onChange={event => setManualName(event.target.value)} /></Field>
        <Button variant="outline" size="sm" disabled={!validId(id) || value.some(person => person.id === id)}
          onClick={() => { add([{ id, name: manualName.trim() }]); setManualId(''); setManualName('') }}>{t('addRow')}</Button>
      </div>
    </details>
    {open && <PeoplePicker {...props} onClose={() => setOpen(false)} onAdd={add} />}
  </div>
}
