// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SourceClientsProvider, type SourceClientPlugin } from '../src/client/source-plugins.tsx'
import { SourceSettings } from '../src/client/source.tsx'
import { EvalSettings } from '../src/client/eval.tsx'
import { SettingsProvider } from '../src/client/settings-kit.tsx'
import { PanelProvider } from '../src/client/provider.tsx'
import { feishuClientPlugin } from '../src/integrations/feishu/client/plugin.tsx'
import { SettingsSchema } from '../src/policy.ts'
import { zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'
import { sourceView } from './fixtures/source-client.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: T = (key, values = {}) => (zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); sessionStorage.clear() })
async function mount(sources: ReturnType<typeof sourceView>[], plugins: readonly SourceClientPlugin[], children: ReactNode = <SourceSettings />) {
  const defaults = SettingsSchema.parse({ policy: { sources: { other: { allowed: [{ id: 'keep' }] } } } })
  const settings = { policyVersion: 'test-version', sources, environment: { root: '/tmp/work', variables: [] },
    blocks: { policy: { value: defaults.policy, revision: 7 }, eval: { value: defaults.eval, revision: 0 }, executor: { value: defaults.executor, revision: 0 } } }
  const writes: { path: string; body: { value: typeof defaults.policy; revision: number } }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname.replace('/orchestrator/api/', '')
    if (path === 'state') return Response.json({ load: { running: 0 }, masterId: 'test' })
    if (path === 'settings') return Response.json(settings)
    if (path === 'models') return Response.json({ groups: [] })
    if (init.method === 'PUT') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body })
      settings.blocks.policy = { value: body.value, revision: body.revision + 1 }
      return Response.json({ revision: body.revision + 1, restarting: false })
    }
    return Response.json({ items: [] })
  }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  cleanup.push(() => { act(() => root.unmount()); container.remove() })
  const render = async (installed: readonly SourceClientPlugin[]) => act(async () => {
    root.render(<SourceClientsProvider plugins={installed}><PanelProvider t={t}><SettingsProvider>{children}</SettingsProvider></PanelProvider></SourceClientsProvider>)
  })
  await render(plugins)
  return { container, writes, render }
}
it('removes the Feishu connection entry when its browser plugin is unregistered, preserving generic source forms', async () => {
  const h = await mount([sourceView({ fields: [{ key: 'directMessages', type: 'switch', label: { zh: '接收私聊', en: 'Direct messages' } }] })], [feishuClientPlugin])
  expect(h.container.querySelector('input[name="appSecret"]')).not.toBeNull()
  expect(h.container.textContent).toContain('接收私聊')
  await h.render([])
  expect(h.container.querySelector('input[name="appSecret"]')).toBeNull()
  expect(h.container.textContent).not.toContain('连接飞书机器人')
  expect(h.container.textContent).toContain('接收私聊')
  expect(h.writes).toEqual([])
})
it('does not mount a connection editor for a removed server kind', async () => {
  const h = await mount([sourceView({ installed: false })], [feishuClientPlugin])
  expect(h.container.querySelector('input[name="appSecret"]')).toBeNull()
  expect(h.container.textContent).toContain(zh.sourceNotInstalled)
})
it('selects components by kind while passing the instance ID to the extension', async () => {
  const plugin: SourceClientPlugin = { kind: 'demo', ConnectionPanel: ({ source }) => <p data-testid="connection">{source.id}</p> }
  const h = await mount([sourceView({ id: 'second-account', kind: 'demo' })], [plugin])
  expect(h.container.querySelector('[data-testid="connection"]')?.textContent).toBe('second-account')
  expect(h.container.querySelector('form')?.id).toBe('dt-source-second-account')
})
it('keeps extension policy edits in the parent draft and saves the entire policy with its original revision', async () => {
  const plugin: SourceClientPlugin = { kind: 'demo', policyFields: { allowed: ({ part, onChange }) =>
    <button type="button" data-testid="edit" onClick={() => onChange({ ...part, allowed: [{ id: 'demo-person' }] })}>Select person</button> } }
  const policy = { fields: [{ key: 'allowed', type: 'rows' as const, label: { zh: 'Allowed', en: 'Allowed' }, columns: [] }], explicit: { zh: '明确请求', en: 'Explicit request' } }
  const h = await mount([sourceView({ id: 'instance-two', kind: 'demo', policy })], [plugin], <EvalSettings focus="instance-two" />)
  await act(async () => { h.container.querySelector<HTMLButtonElement>('[data-testid="edit"]')!.click() })
  expect(h.writes).toEqual([])
  await act(async () => { h.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(h.writes).toHaveLength(1)
  expect(h.writes[0]).toMatchObject({ path: 'settings/policy', body: { revision: 7, value: { sources: {
    'instance-two': { allowed: [{ id: 'demo-person' }] }, other: { allowed: [{ id: 'keep' }] },
  } } } })
})
