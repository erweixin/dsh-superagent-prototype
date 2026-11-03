import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { SourceRegistry } from '../src/sources/registry.ts'
import { feishuKind } from '../src/sources/feishu.ts'
import { settingsView } from '../src/app/views/settings.ts'
import { sourceConnection } from '../src/app/views/sources.ts'
import { Store } from '../src/app/store.ts'
import { machineOf } from '../src/deployment.ts'
import { SetupError } from '../src/setup.ts'

it('publishes generic connection facts without credentials and retains saved state during setup failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'source-contract-'))
  const store = new Store(join(directory, 'state.sqlite'))
  try {
    store.saveSettings({ sources: { feishu: { enabled: true, config: { cli: '/saved/bot-cli' } } } })
    const registry = new SourceRegistry(() => store.settings())
    registry.register(feishuKind)
    const bot = { cli: '/saved/bot-cli', appId: 'cli_demo', brand: 'feishu' as const, botId: 'ou_demo', name: 'Demo', appSecret: 'never-publish' }
    const setup = { deployment: { ...machineOf({ stateDir: '/tmp/test' }), feishu: bot } }
    const source = settingsView(store, registry, {}, setup, '/tmp/test').sources[0]!
    expect(source.connection).toEqual({ configured: true, account: { id: 'cli_demo', name: 'Demo', details: [
      { label: 'App ID', value: 'cli_demo' }, { label: 'Platform', value: '飞书' },
    ] } })
    expect(JSON.stringify(source)).not.toContain('never-publish')
    const problem = new SetupError('environmentFailed', { output: 'fixture failure' }).problem
    expect(settingsView(store, registry, {}, { problem }, '/tmp/test').sources[0]?.connection)
      .toEqual({ configured: true, problem })
    expect(store.settings().sources.feishu?.config.cli).toBe('/saved/bot-cli')
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
it('supports connection views from an unrelated source and removes them on unregister', () => {
  const directory = mkdtempSync(join(tmpdir(), 'source-contract-'))
  const store = new Store(join(directory, 'state.sqlite'))
  try {
    const registry = new SourceRegistry(() => store.settings())
    const unregister = registry.register({ kind: 'demo', title: { zh: 'Demo', en: 'Demo' }, description: { zh: '', en: '' },
      schema: z.object({}), fields: [], health: [], connection: () => ({ configured: true, account: { id: 'demo', name: 'Demo', details: [] } }),
    })
    const instance = registry.instance('demo')!
    expect(sourceConnection(registry, instance, {})?.account?.id).toBe('demo')
    unregister()
    expect(sourceConnection(registry, instance, {})).toBeUndefined()
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
