// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AllowedPeople } from '../src/client/allowed-people.tsx'
import { PanelProvider } from '../src/client/provider.tsx'
import { zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: T = ((key: keyof typeof zh, values: Record<string, string> = {}) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')) as T
type Person = { id: string; name?: string }
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
async function mount(roster: (chat: string) => Promise<Response>, initial: Person[] = [{ id: 'ou_alice', name: 'Alice' }]) {
  const requests: { path: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url, 'http://localhost')
    requests.push({ path: parsed.pathname, method: init.method ?? 'GET' })
    if (parsed.pathname.endsWith('/people')) return roster(parsed.searchParams.get('scope')!)
    return Response.json({ load: { running: 0 } })
  }))
  let selected = initial
  const changed = vi.fn()
  function Harness() {
    const [value, setValue] = useState(initial)
    selected = value
    return <AllowedPeople sourceId="feishu" label="Allowed users" value={value}
      labels={{ oc_a: 'A team', oc_b: 'B team' }} syncChat="" refreshChats={async () => {}}
      onChange={next => { changed(next); setValue(next) }} />
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  cleanup.push(() => { act(() => root.unmount()); container.remove() })
  await act(async () => { root.render(<PanelProvider t={t}><Harness /></PanelProvider>) })
  return { container, requests, changed, selected: () => selected }
}
const click = async (element: HTMLElement) => act(async () => { element.click() })
const button = (label: string, parent: ParentNode = document) => [...parent.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
async function selectChat(chat: string) {
  const select = dialog().querySelector('select')!
  await act(async () => { select.value = chat; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('searches and selects across chats, preserves the current list, deduplicates users, and only edits the draft', async () => {
  const h = await mount(async chat => Response.json({ people: chat === 'oc_a'
    ? [{ id: 'ou_alice', name: 'Alice' }, { id: 'ou_bob', name: 'Bob' }]
    : [{ id: 'ou_bob', name: 'Bob' }, { id: 'ou_carol', name: 'Carol' }] }))
  await click(button(zh['people.choose']))
  const choices = () => [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  expect(choices()[0]!.disabled).toBe(true)
  expect(choices()[0]!.checked).toBe(true)
  await input(dialog().querySelector('input[type="search"]')!, 'Bob')
  expect(choices()).toHaveLength(1)
  await click(choices()[0]!)
  await selectChat('oc_b')
  expect(choices()[0]!.checked).toBe(true)
  await click(choices()[1]!)
  expect(h.changed).not.toHaveBeenCalled()
  await click(button('添加已选用户（2）'))
  expect(h.selected()).toEqual([{ id: 'ou_alice', name: 'Alice' }, { id: 'ou_bob', name: 'Bob' }, { id: 'ou_carol', name: 'Carol' }])
  expect(dialog()).toBeNull()
  expect(h.requests.every(request => request.method === 'GET')).toBe(true)
  await click(button(zh['people.choose']))
  expect(choices().every(choice => choice.disabled)).toBe(true)
  await click(button(zh.cancel))
  expect(h.changed).toHaveBeenCalledTimes(1)
  const remove = h.container.querySelector<HTMLButtonElement>('[aria-label="移除 Bob"]')
    ?? [...h.container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label')?.includes('Bob'))!
  await click(remove)
  expect(h.selected().map(p => p.id)).toEqual(['ou_alice', 'ou_carol'])
})
it('ignores a late roster response after changing chats and discards unconfirmed selections on cancel', async () => {
  let finish!: (response: Response) => void
  const h = await mount(chat => chat === 'oc_a' ? new Promise(resolve => { finish = resolve })
    : Promise.resolve(Response.json({ people: [{ id: 'ou_bob', name: 'Bob' }] })))
  await click(button(zh['people.choose']))
  await selectChat('oc_b')
  await act(async () => { finish(Response.json({ people: [{ id: 'ou_stale', name: 'Stale' }] })) })
  expect(dialog().textContent).not.toContain('Stale')
  await click(dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!)
  await click(button(zh.cancel))
  expect(h.changed).not.toHaveBeenCalled()
  expect(h.selected()).toEqual([{ id: 'ou_alice', name: 'Alice' }])
})
it('shows lookup errors without changing access and supports a manual open_id when a user is not listed', async () => {
  const h = await mount(async () => Response.json({ error: 'Missing member permission (99991672)' }, { status: 400 }))
  await click(button(zh['people.choose']))
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Missing member permission')
  expect(dialog().textContent).toContain('im:chat.members:read')
  expect(button('添加已选用户（0）').disabled).toBe(true)
  await click(button(zh.cancel))
  const fields = h.container.querySelectorAll<HTMLInputElement>('details input')
  await input(fields[0]!, 'ou_manual')
  await input(fields[1]!, 'Manual User')
  await click(button(zh.addRow, h.container))
  expect(h.selected()).toContainEqual({ id: 'ou_manual', name: 'Manual User' })
  expect(h.requests.every(request => request.method === 'GET')).toBe(true)
})
