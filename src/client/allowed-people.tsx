/** Select allowed users from source chat members; selections remain in the policy draft until saved. */
import { useEffect, useState } from 'react'
import { Button, Icon, Input, Modal } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Field } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint } from './widgets.tsx'

type Person = { id: string; name?: string }
interface Props {
  sourceId: string
  label: string
  value: Person[]
  labels: Record<string, string>
  syncChat: string
  onChange(value: Person[]): void
  refreshChats(): Promise<void>
}

function PeoplePicker({ sourceId, value, labels, syncChat, refreshChats, onAdd, onClose }: Props & {
  onAdd(people: Person[]): void; onClose(): void
}) {
  const { t, call } = usePanel()
  const chats = Object.entries(labels).sort(([, a], [, b]) => a.localeCompare(b))
  const [chat, setChat] = useState(syncChat || chats[0]?.[0] || '')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Record<string, Person>>({})
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ chat: string; people: Person[]; error?: string }>()
  const refresh = useAction(refreshChats)
  // A freshly loaded chat catalog supplies the initial selection without replacing an operator's choice.
  const firstChat = chats[0]?.[0] ?? ''
  useEffect(() => { if (!chat && firstChat) setChat(firstChat) }, [chat, firstChat])
  useEffect(() => {
    if (!chat) return
    let active = true
    setResult(undefined)
    call('GET sources/:id/people', { id: sourceId, query: { scope: chat } }).then(
      response => { if (active) setResult({ chat, people: response.people }) },
      failure => { if (active) setResult({ chat, people: [], error: errorText(failure) }) }
    )
    return () => { active = false }
  }, [call, sourceId, chat, revision])
  const current = result?.chat === chat ? result : undefined
  const existing = new Set(value.map(person => person.id))
  const pending = Object.values(selected).filter(person => !existing.has(person.id))
  const search = query.trim().toLocaleLowerCase()
  const people = current?.people.filter(person => `${person.name ?? ''} ${person.id}`.toLocaleLowerCase().includes(search)) ?? []
  return <Modal open title={t('people.choose')} closeLabel={t('close')} onClose={onClose} description={t('people.intro')}
    footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      <Button disabled={!pending.length} onClick={() => onAdd(pending)}>{t('people.addSelected', { count: pending.length })}</Button></>}>
    <div className="dt-people-picker">
      <div className="dt-people-toolbar">
        <Field label={t('people.chat')}><select className="dt-select" value={chat} onChange={event => { setChat(event.target.value); setQuery('') }}>
          <option value="" disabled>{t('people.chooseChat')}</option>
          {chat && !labels[chat] && <option value={chat}>{chat}</option>}
          {chats.map(([id, name]) => <option key={id} value={id}>{name || id}</option>)}
        </select></Field>
        <Button variant="outline" size="sm" disabled={refresh.busy} onClick={() => { void refresh.run() }}>{t('people.refreshChats')}</Button>
      </div>
      {!chats.length && <Hint>{t('people.noChats')}</Hint>}
      <Field label={t('people.search')}><Input type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field>
      <div aria-live="polite">
        {chat && !current && <Hint>{t('loading')}</Hint>}
        {current?.error && <p className="dt-error" role="alert">{t('people.loadFailed', { error: current.error })}</p>}
        {current?.error && /99991672|im:chat\.members:read/.test(current.error) && <Hint>{t('people.permissionHelp')}</Hint>}
        {current && !current.error && !people.length && <Hint>{t(query.trim() ? 'people.noMatches' : 'people.empty')}</Hint>}
      </div>
      {people.length > 0 && <ul className="dt-people-list dt-people-options" aria-label={t('people.members')}>
        {people.map(person => <li key={person.id}><label className="dt-person-option">
          <input type="checkbox" checked={existing.has(person.id) || !!selected[person.id]} disabled={existing.has(person.id)}
            onChange={event => setSelected(before => {
              const next = { ...before }
              if (event.target.checked) next[person.id] = person
              else delete next[person.id]
              return next
            })} />
          <span className="dt-person-name">{person.name || person.id}<small>{person.id}</small></span>
          {existing.has(person.id) && <small>{t('people.alreadyAdded')}</small>}
        </label></li>)}
      </ul>}
      {chat && <Button variant="ghost" size="sm" disabled={!current} onClick={() => setRevision(revision + 1)}>{t('people.refreshMembers')}</Button>}
    </div>
  </Modal>
}

export function AllowedPeople(props: Props) {
  const { t } = usePanel()
  const { value, label, onChange, syncChat } = props
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
      <Button variant="outline" size="sm" icon={<Icon name="plus" />} onClick={() => setOpen(true)}>{t('people.choose')}</Button>
    </div>
    {!value.length && <Hint>{t('people.noneSelected')}</Hint>}
    {!!value.length && <ul className="dt-people-list">{value.map(person => <li key={person.id} className="dt-person">
      <span className="dt-person-name">{person.name || person.id}<small>{person.id}</small></span>
      <Button variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={t('removeRow', { name: person.name || person.id })}
        onClick={() => onChange(value.filter(item => item.id !== person.id))} />
    </li>)}</ul>}
    {syncChat && <Hint>{t('people.syncWarning')}</Hint>}
    <details className="dt-people-manual"><summary>{t('people.manual')}</summary>
      <div className="dt-people-toolbar">
        <Field label="open_id"><Input value={manualId} spellCheck={false} onChange={event => setManualId(event.target.value)} /></Field>
        <Field label={t('people.name')}><Input value={manualName} maxLength={100} onChange={event => setManualName(event.target.value)} /></Field>
        <Button variant="outline" size="sm" disabled={!/^ou_[a-zA-Z0-9]+$/.test(id) || value.some(person => person.id === id)}
          onClick={() => { add([{ id, name: manualName.trim() }]); setManualId(''); setManualName('') }}>{t('addRow')}</Button>
      </div>
    </details>
    {open && <PeoplePicker {...props} onClose={() => setOpen(false)} onAdd={add} />}
  </div>
}
