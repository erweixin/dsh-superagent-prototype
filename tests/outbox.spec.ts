/** Outbox delivery when processing is paused or a Source kind registers late. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OutboundMessage } from '../src/core/index.ts'
import { Commands } from '../src/infra/commands.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { startRuntime, type Host } from './fixtures/standalone.ts'
import { panelTrigger } from '../src/sources/panel.ts'
const feishu=(_id:string,text:string)=>panelTrigger(text)

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.sendReplies() } finally { vi.useRealTimers() }
}

it('holds every message while processing is paused, and sends it once processing resumes', async () => {
  const lark = vi.spyOn(h.runtime.sources.kind('panel')!.channel!, 'send')
  await h.runtime.settings.pause(true, 'panel')
  lark.mockClear()
  h.runtime.outbox.send({ id: 'held', channel: feishu('1', 'x').channel!, text: '已合并。', kind: 'notice' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('held'), lark.mock.calls.length]).toEqual(['pending', 0])
  await h.runtime.settings.pause(false, 'panel')
  await h.runtime.pump(); await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('held')).toBe('sent')
  expect(JSON.stringify(lark.mock.calls)).toContain('已合并。')
})

it('persists image references across retry and preserves them if a sent receipt was withdrawn in flight', async () => {
  const message: OutboundMessage = { id: 'image-retry', channel: { source: 'feishu', thread: 'topic', address: { messageId: 'om_original' } },
    text: 'Screenshot', kind: 'reply', images: [{ imageKey: 'img_test' }] }
  vi.spyOn(h.runtime.sources, 'channelAllowed').mockReturnValue(true)
  const send = vi.spyOn(h.runtime.sources, 'send').mockRejectedValueOnce(new Error('temporary error')).mockResolvedValue('sent')
  h.runtime.outbox.send(message)
  await h.runtime.sendReplies()
  expect(h.runtime.store.receipts.get(message.id)).toMatchObject({ status: 'pending', images: message.images })
  await at(5000)
  expect(h.runtime.store.receipts.get(message.id)).toMatchObject({ status: 'sent', images: message.images })
  expect(send.mock.calls[0]![0]).toMatchObject({ id: message.id, images: message.images })
  expect(send.mock.calls[1]![0]).toMatchObject({ id: message.id, images: message.images })
  const racing = { ...message, id: 'image-racing' }
  h.runtime.store.receipts.add(racing)
  h.runtime.store.receipts.withdraw(racing.id)
  h.runtime.store.receipts.settle(racing, 'sent')
  expect(h.runtime.store.receipts.get(racing.id)).toMatchObject({ status: 'sent', images: message.images })
})

it('keeps a message for a Source that is not installed waiting, and sends it once the Source\'s kind registers', async () => {
  const sent: OutboundMessage[] = []
  const probe: SourceKind<Record<string, never>> = { kind: 'probe', title: { zh: '探针', en: 'Probe' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async (_host, message) => { sent.push(message); return 'sent' }, link: () => ({ url: '', label: { zh: '探针', en: 'Probe' } }) } }
  h.runtime.outbox.send({ id: 'waiting', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('waiting'), h.runtime.health.reply?.state]).toEqual(['pending', 'ready'])
  h.runtime.sources.register(probe)
  // A message whose Source was not installed is tried again after 5 seconds.
  await at(5000)
  expect([h.runtime.outbox.status('waiting'), sent.map(message => message.id)]).toEqual(['sent', ['waiting']])
})
