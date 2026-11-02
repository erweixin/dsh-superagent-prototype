import type { Ticket } from '../core/index.ts'
import type { Store } from './store.ts'
import { KV } from '../kv.ts'

/** Unbound tickets retain their existing stable session IDs. */
export const workerSessionId = (ticket: Ticket | string): string => typeof ticket === 'string'
  ? `worker-${ticket}` : ticket.execution?.workspace?.sessionId ?? `worker-${ticket.id}`

/** Shared workers have exactly one durable current ticket; never infer it from history. */
export function ticketOfSession(id: string, store: Pick<Store, 'get'>): string | undefined {
  return id.startsWith('group-worker-') ? store.get(KV.sessions.ticket(id))
    : id.startsWith('worker-') ? id.slice(7) : undefined
}
