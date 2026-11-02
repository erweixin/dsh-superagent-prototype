// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FeishuSetup } from '../src/client/feishu-setup.tsx'
import { PanelProvider } from '../src/client/provider.tsx'
import { zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: T = ((key: keyof typeof zh, values: Record<string, string> = {}) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')) as T
afterEach(() => vi.unstubAllGlobals())
it('checks without saving, clears credentials after saving and never places them in browser storage', async () => {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/setup/feishu')) {
        const body = JSON.parse(String(init.body))
        requests.push(body)
        return Response.json({
          saved: body.action === 'save',
          restarting: false,
          bot: { name: 'Demo', botId: 'ou_demo', appId: 'cli_demo', brand: 'feishu' }
        })
      }
      return Response.json({ load: { running: 0 } })
    })
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <PanelProvider t={t}>
        <FeishuSetup />
      </PanelProvider>
    )
  )
  try {
    const form = container.querySelector('form')!
    const id = form.elements.namedItem('appId') as HTMLInputElement
    const secret = form.elements.namedItem('appSecret') as HTMLInputElement
    id.value = 'cli_demo'
    secret.value = 'fixture-secret'
    const submit = async (action: string) =>
      act(async () => {
        form.dispatchEvent(
          new SubmitEvent('submit', {
            bubbles: true,
            cancelable: true,
            submitter: form.querySelector(`button[value="${action}"]`)
          })
        )
      })
    await submit('check')
    expect(requests[0]).toMatchObject({ action: 'check', appId: 'cli_demo', appSecret: 'fixture-secret' })
    expect(secret.value).toBe('fixture-secret')
    expect(container.textContent).toContain('尚未保存')
    await submit('save')
    expect(requests[1]).toMatchObject({ action: 'save' })
    expect(secret.value).toBe('')
    expect(container.textContent).toContain('已保存机器人')
    expect(container.textContent).not.toContain('fixture-secret')
    expect(JSON.stringify(localStorage)).not.toContain('fixture-secret')
    expect(JSON.stringify(sessionStorage)).not.toContain('fixture-secret')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('shows the saved bot after a fresh mount without requiring credentials again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        load: { running: 0 },
        setup: {
          accounts: { feishu: { name: 'Saved bot', appId: 'cli_saved', botId: 'ou_saved', brand: 'feishu' } },
          problem: null,
          feishuProblem: null
        }
      })
    )
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const source = { value: { enabled: true, config: { cli: '/state/feishu-bots/bot-one/lark-cli' } } }
  const mount = async (key: string) =>
    act(async () =>
      root.render(
        <PanelProvider t={t} key={key}>
          <FeishuSetup source={source} />
        </PanelProvider>
      )
    )
  try {
    await mount('first')
    expect(container.textContent).toContain('Saved bot')
    expect(container.textContent).toContain('cli_saved')
    expect(container.querySelector('input[name="appSecret"]')).toBeNull()
    await mount('refresh')
    expect(container.textContent).toContain('Saved bot')
    expect(container.textContent).toContain('已保存的飞书机器人')
    await act(async () => {
      ;[...container.querySelectorAll('button')].find((b) => b.textContent === zh.botSetupEdit)!.click()
    })
    expect((container.querySelector('input[name="appSecret"]') as HTMLInputElement).value).toBe('')
    expect(container.textContent).toContain('Saved bot')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('keeps saved configuration visible when runtime initialization fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        load: { running: 0 },
        setup: {
          accounts: null,
          feishuProblem: null,
          problem: { code: 'environmentFailed', values: { output: 'no rollout found for thread id example' } }
        }
      })
    )
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <PanelProvider t={t}>
          <FeishuSetup source={{ value: { enabled: false, config: { cli: '/saved/lark-cli' } } }} />
        </PanelProvider>
      )
    )
    expect(container.textContent).toContain('机器人配置已保存')
    expect(container.textContent).toContain('飞书来源当前已关闭')
    expect(container.textContent).toContain('no rollout found')
    expect(container.querySelector('input[name="appSecret"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
