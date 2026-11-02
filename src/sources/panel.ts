/** Local operator requests use the same intake and outbox as remote sources. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { SourceKind } from './kind.ts'
import type { Store } from '../app/store.ts'
import type { Trigger, OutboundMessage } from '../core/index.ts'
import { record } from '../kv.ts'
export const panelReplies = record<OutboundMessage[]>('panel-replies')
export function panelKind(store: Store): SourceKind {
  return {
    kind: 'panel',
    title: { zh: '本机面板', en: 'Local panel' },
    description: { zh: '本机操作者的请求', en: 'Local operator requests' },
    schema: z.object({}).strict(),
    fields: [],
    health: [],
    scope: () => ({ listened: true, observed: false, row: 'operator' }),
    channel: {
      link: () => ({ url: '', label: { zh: '面板', en: 'Panel' } }),
      send: async (_host, message) => {
        const old = store.get(panelReplies) ?? []
        if (!old.some((m) => m.id === message.id)) store.set(panelReplies, [...old, message])
        return 'sent'
      }
    }
  }
}
export function panelTrigger(text: string, thread: string = randomUUID()): Trigger {
  return {
    id: `panel:${randomUUID()}`,
    source: 'panel',
    threads: [{ source: 'panel', id: thread }],
    actor: { source: 'panel', id: 'operator' },
    human: true,
    addressed: 'direct',
    at: new Date().toISOString(),
    text,
    meta: {},
    channel: { source: 'panel', thread, address: { thread } }
  }
}
