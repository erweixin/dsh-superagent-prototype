import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { Runtime } from '../src/app/runtime.ts'
import { Store } from '../src/app/store.ts'
import { machineOf } from '../src/deployment.ts'
import { panelTrigger } from '../src/sources/panel.ts'
import { FEISHU_KV } from '../src/integrations/feishu/server/state.ts'
import { KV } from '../src/kv.ts'
import { feishuKind } from '../src/integrations/feishu/server/source.ts'
import { feishuKind as legacyKind } from '../src/sources/feishu.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { setupChanged, Setup } from '../src/app/setup.ts'
import { SettingsSchema } from '../src/policy.ts'
import { Commands, CliError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { z } from 'zod'
import { SetupError } from '../src/setup.ts'

it('boots and accepts panel work without Feishu, keeping saved config and cursor data for later reinstallation', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'no-feishu-'))
  const machine = machineOf({ stateDir, codexPath: resolve('tests/fixtures/codex.mjs') })
  const store = new Store(join(stateDir, 'orchestrator.sqlite'))
  store.saveSettings({ sources: { feishu: { enabled: true, config: { cli: '/not-installed/lark-cli', chats: [{ chatId: 'oc_existing', listen: 'mentions' }] } } } })
  store.set(KV.feishu.history('oc_existing'), '2026-09-11T00:00:00.000Z'); store.close()
  const runtime = new Runtime(machine, () => {}, [])
  try {
    await runtime.ready
    expect(runtime.configured()).toBe(true)
    expect(runtime.setupProblem).toBeUndefined()
    expect(runtime.sources.kind('feishu')).toBeUndefined()
    expect(runtime.sources.instances().find(source => source.id === 'feishu')).toMatchObject({ installed: false, config: { cli: '/not-installed/lark-cli' } })
    expect(runtime.store.get(FEISHU_KV.history('oc_existing'))).toBe('2026-09-11T00:00:00.000Z')
    expect(existsSync(join(stateDir, 'worker-bin', 'lark-cli'))).toBe(false)
    expect(runtime.prompts.skills(runtime.prompts.current().config).some(([name]) => name === 'feishu')).toBe(false)
    const input = panelTrigger('Prepare a local summary')
    runtime.receive(input)
    await runtime.idle()
    expect(runtime.store.triggers.get(input.id)?.text).toBe('Prepare a local summary')
  } finally { await runtime.stop(); rmSync(stateDir, { recursive: true, force: true }) }
})
it('keeps old imports, setup-sensitive fields and cursor spellings compatible', () => {
  expect(legacyKind).toBe(feishuKind)
  expect(KV.feishu).toBe(FEISHU_KV)
  expect(FEISHU_KV.history('oc_existing')).toBe('feishu-history:oc_existing')
  expect(FEISHU_KV.topics('oc_existing')).toBe('feishu-history-threads:oc_existing')
  expect(FEISHU_KV.seen('thread')).toBe('thread-seen:thread')
  expect(FEISHU_KV.initialized('thread')).toBe('thread-initialized:thread')
  const before = SettingsSchema.parse({ sources: { feishu: { enabled: true, config: { cli: '/old' } } } })
  const sources = new SourceRegistry(() => before); sources.register(feishuKind)
  const changed = SettingsSchema.parse({ sources: { feishu: { enabled: true, config: { cli: '/new' } } } })
  expect(setupChanged(before, changed, sources)).toBe(true)
  const disabled = SettingsSchema.parse({ sources: { feishu: { enabled: false, config: { cli: '/old' } } } })
  expect(setupChanged(before, disabled, sources)).toBe(false)
})
it('resolves accounts and command shims using source extensions rather than hardcoded Feishu setup', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'source-setup-'))
  const machine = machineOf({ stateDir, codexPath: resolve('tests/fixtures/codex.mjs') })
  const settings = SettingsSchema.parse({ sources: { demo: { enabled: true, config: { endpoint: 'fixture' } } } })
  const sources = new SourceRegistry(() => settings)
  const resolver = vi.fn(async () => ({ id: 'demo-account' }))
  sources.register({ kind: 'demo', title: { zh: 'Demo', en: 'Demo' }, description: { zh: '', en: '' }, schema: z.object({ endpoint: z.string() }),
    fields: [], health: [], setup: { fields: ['endpoint'], resolve: resolver, shims: () => ({ 'demo-cli': 'exit 0' }) } })
  const setup = new Setup({ machine, lifetime: new AbortController().signal, restart() {} }, sources)
  try {
    expect(await setup.run(settings)).toBe(true)
    expect(setup.deployment.accounts).toEqual({ demo: { id: 'demo-account' } })
    expect(resolver).toHaveBeenCalledWith(machine, { endpoint: 'fixture' }, expect.any(Function))
    expect(readFileSync(join(stateDir, 'worker-bin', 'demo-cli'), 'utf8')).toContain('exit 0')
    expect(existsSync(join(stateDir, 'worker-bin', 'lark-cli'))).toBe(false)
    await setup.checkAccounts('source:demo', settings)
    expect(resolver).toHaveBeenCalledTimes(2)
  } finally { rmSync(stateDir, { recursive: true, force: true }) }
})
it('keeps the old command facade bot-only and accepts both account layouts', async () => {
  for (const modern of [false, true]) {
    const deployment = testDeployment()
    if (modern) { deployment.accounts = { feishu: deployment.feishu }; delete deployment.feishu }
    const commands = new Commands(() => deployment, {}, new AbortController().signal)
    const run = vi.spyOn(commands, 'run').mockResolvedValue(JSON.stringify({ ok: true, data: { value: 1 } }))
    expect(await commands.lark(['im', '+chat-list'])).toEqual({ value: 1 })
    expect(run).toHaveBeenCalledWith(expect.any(String), ['im', '+chat-list', '--as', 'bot', '--format', 'json'], undefined,
      { LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' })
    run.mockRejectedValue(new CliError('member missing', 232011))
    await expect(commands.lark(['im', '+chat-list'])).rejects.toThrow('Add the bot')
  }
})

it('keeps a failed Feishu account isolated while another source and the core remain ready', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'source-account-failure-'))
  const settings = SettingsSchema.parse({})
  const sources = new SourceRegistry(() => settings)
  sources.register({ ...feishuKind, setup: { ...feishuKind.setup!, resolve: async () => { throw new SetupError('feishuNoBot') } } })
  sources.register({ kind: 'demo', title: { zh: 'Demo', en: 'Demo' }, description: { zh: '', en: '' }, schema: z.object({}),
    fields: [], health: [], setup: { fields: ['endpoint'], resolve: async () => ({ id: 'ready' }) } })
  const setup = new Setup({ machine: machineOf({ stateDir, codexPath: resolve('tests/fixtures/codex.mjs') }),
    lifetime: new AbortController().signal, restart() {} }, sources)
  try {
    expect(await setup.run(settings)).toBe(true)
    expect(setup.sourceProblems.feishu?.code).toBe('feishuNoBot')
    expect(setup.feishuProblem).toBe(setup.sourceProblems.feishu)
    expect(setup.deployment.accounts).toEqual({ demo: { id: 'ready' } })
    expect(setup.problem).toBeUndefined()
    expect(readFileSync(join(stateDir, 'worker-bin', 'lark-cli'), 'utf8')).toContain('Feishu bot is not configured')
  } finally { rmSync(stateDir, { recursive: true, force: true }) }
})
