import { expect, it, vi } from 'vitest'
import { SourceRegistry } from '../src/sources/registry.ts'
import { SettingsSchema } from '../src/policy.ts'
import { feishuKind } from '../src/integrations/feishu/server/source.ts'
import { feishuTrigger } from '../src/integrations/feishu/server/trigger.ts'
import { readResource, type ResourceHost } from '../src/app/resources.ts'
import { TextCache } from '../src/app/cache.ts'
import { Commands } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'

it('dispatches existing Feishu resource paths through the registry and preserves worker authorization checks', async () => {
  const settings = SettingsSchema.parse({ sources: { feishu: { enabled: true, config: { readPageSize: 7 } } } })
  const sources = new SourceRegistry(() => settings)
  const read = vi.fn(async () => ({ fixture: 'source-page' }))
  const unregister = sources.register({ ...feishuKind, resources: { ...feishuKind.resources!, read } })
  const trigger = feishuTrigger({ message_id: 'om_source', chat_id: 'oc_chat', chat_type: 'group', sender_id: 'ou_person',
    sender_type: 'user', content: 'Hello', create_time: '1728000000000' }, 'ou_bot', 'cli_bot')!
  const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
  const host = { sources, pages: new TextCache(10000), masterId: 'main', commands,
    store: { triggers: { get: () => trigger }, tickets: { get: () => undefined } } } as unknown as ResourceHost
  const resource = `feishu/${trigger.id}/message`
  expect(JSON.stringify(await readResource(host, resource, 0, undefined))).toContain('source-page')
  expect(read).toHaveBeenCalledWith(commands, trigger, resource, expect.objectContaining({ readPageSize: 7 }))
  read.mockClear()
  await expect(readResource(host, resource, 0, undefined, 'unknown-ticket')).rejects.toThrow()
  expect(read).not.toHaveBeenCalled()
  unregister()
  await expect(readResource(host, resource, 0, undefined)).rejects.toThrow('Unknown context resource')
})
