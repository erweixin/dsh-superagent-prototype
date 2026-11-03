/** Feishu roster lookup and identity rules around the reusable member picker. */
import { useCallback } from 'react'
import { AllowedPeople, type Person, type PeopleTextKey } from '../../../client/allowed-people.tsx'
import type { PolicyFieldProps } from '../../../client/source-plugins.tsx'
import { localized } from '../../../client/text.ts'
import type { SuperagentKey } from '../../../client/locales.ts'

export function FeishuAllowedPeople({ source, field, part, services: { t, call }, onChange, reload }: PolicyFieldProps) {
  const loadPeople = useCallback(async (scope: string) =>
    (await call('GET sources/:id/people', { id: source.id, query: { scope } })).people, [call, source.id])
  const keys: Partial<Record<PeopleTextKey, SuperagentKey>> = {
    scope: 'people.chat', chooseScope: 'people.chooseChat', refreshScopes: 'people.refreshChats', noScopes: 'people.noChats',
    close: 'close', cancel: 'cancel', loading: 'loading', removeRow: 'removeRow', addRow: 'addRow',
  }
  return <AllowedPeople label={localized(t, field.label)} value={(part.allowed ?? []) as Person[]}
    labels={source.labels} initialScope={String(part.syncChat ?? '')} syncEnabled={!!part.syncChat}
    idLabel="open_id" validId={id => /^ou_[a-zA-Z0-9]+$/.test(id)}
    text={(key, values) => t(keys[key] ?? `people.${key}` as SuperagentKey, values)}
    errorHint={error => /99991672|im:chat\.members:read/.test(error) ? t('people.permissionHelp') : undefined}
    loadPeople={loadPeople}
    refreshScopes={async () => { await call('POST sources/:id/labels', { id: source.id }); await reload() }}
    onChange={allowed => onChange({ ...part, allowed })} />
}
