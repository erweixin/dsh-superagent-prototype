// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FeishuConnectionForm, type FeishuConnectionProps } from '../src/integrations/feishu/client/connection-form.tsx'
import { zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'
import { sourceView } from './fixtures/source-client.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: T = (key, values = {}) => (zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
const bot = { name: 'Demo', botId: 'ou_demo', appId: 'cli_demo', brand: 'feishu' as const }
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
async function mount(overrides: Partial<FeishuConnectionProps> = {}) {
  const props: FeishuConnectionProps = {
    source: sourceView(), t, runningCount: 0, problem: null,
    configure: vi.fn(async request => ({ saved: request.action === 'save', restarting: false, bot })),
    onChanged: vi.fn(async () => {}), onRestartRequired: vi.fn(), onOpenPolicy: vi.fn(), ...overrides,
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  cleanup.push(() => { act(() => root.unmount()); container.remove() })
  const render = async (key: string) => act(async () => { root.render(<FeishuConnectionForm key={key} {...props} />) })
  await render('initial')
  return { container, props, render }
}
async function submit(container: HTMLElement, action: string) {
  const form = container.querySelector('form')!
  await act(async () => { form.dispatchEvent(new SubmitEvent('submit', {
    bubbles: true, cancelable: true, submitter: form.querySelector(`button[value="${action}"]`),
  })) })
}
function credentials(container: HTMLElement) {
  const id = container.querySelector<HTMLInputElement>('input[name="appId"]')!
  const secret = container.querySelector<HTMLInputElement>('input[name="appSecret"]')!
  id.value = 'cli_demo'; secret.value = 'fixture-secret'
  return secret
}
it('checks without saving and clears credentials before refreshing, without a PanelProvider or browser storage', async () => {
  const h = await mount()
  const secret = credentials(h.container)
  await submit(h.container, 'check')
  expect(h.props.configure).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'check', appId: 'cli_demo', appSecret: 'fixture-secret' }))
  expect(secret.value).toBe('fixture-secret')
  expect(h.props.onChanged).not.toHaveBeenCalled()
  expect(h.container.textContent).toContain('尚未保存')
  await submit(h.container, 'save')
  expect(h.props.configure).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'save' }))
  expect(secret.value).toBe('')
  expect(h.props.onChanged).toHaveBeenCalledOnce()
  expect(h.props.onRestartRequired).not.toHaveBeenCalled()
  expect(h.container.textContent).toContain('已保存机器人')
  expect(h.container.textContent).not.toContain('fixture-secret')
  expect(JSON.stringify(localStorage)).not.toContain('fixture-secret')
  expect(JSON.stringify(sessionStorage)).not.toContain('fixture-secret')
})
it('delegates restart handling to the host only after a saved response', async () => {
  const h = await mount({ configure: vi.fn(async () => ({ bot, saved: true, restarting: true })) })
  const secret = credentials(h.container)
  await submit(h.container, 'save')
  expect(secret.value).toBe('')
  expect(h.props.onRestartRequired).toHaveBeenCalledOnce()
  expect(h.props.onChanged).not.toHaveBeenCalled()
})
it('shows the saved account after a fresh mount without requiring credentials again', async () => {
  const h = await mount({ source: sourceView({ connection: { configured: true,
    account: { name: 'Saved bot', id: 'cli_saved', details: [{ label: 'App ID', value: 'cli_saved' }] },
  } }) })
  expect(h.container.textContent).toContain('Saved bot')
  expect(h.container.textContent).toContain('cli_saved')
  expect(h.container.querySelector('input[name="appSecret"]')).toBeNull()
  await h.render('fresh')
  expect(h.container.textContent).toContain('已保存的飞书机器人')
  await act(async () => { [...h.container.querySelectorAll('button')].find(b => b.textContent === zh.botSetupEdit)!.click() })
  expect(h.container.querySelector<HTMLInputElement>('input[name="appSecret"]')!.value).toBe('')
  expect(h.container.textContent).toContain('Saved bot')
})
it('keeps saved configuration visible when runtime initialization fails', async () => {
  const h = await mount({ source: sourceView({ connection: { configured: true }, value: { enabled: false, config: {} } }),
    problem: <p role="status">no rollout found</p> })
  expect(h.container.textContent).toContain('机器人配置已保存')
  expect(h.container.textContent).toContain('飞书来源当前已关闭')
  expect(h.container.textContent).toContain('no rollout found')
  expect(h.container.querySelector('input[name="appSecret"]')).toBeNull()
})
it('keeps failures local and does not refresh, restart or persist credentials', async () => {
  const h = await mount({ configure: vi.fn(async () => { throw new Error('Connection failed') }) })
  credentials(h.container)
  await submit(h.container, 'save')
  expect(h.container.querySelector('[role="alert"]')?.textContent).toBe('Connection failed')
  expect(h.props.onChanged).not.toHaveBeenCalled()
  expect(h.props.onRestartRequired).not.toHaveBeenCalled()
  expect(JSON.stringify(sessionStorage)).not.toContain('fixture-secret')
})
