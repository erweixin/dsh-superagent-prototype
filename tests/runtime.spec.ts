import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/standalone.ts'
import { panelTrigger } from '../src/sources/panel.ts'
import { latestAssignment } from '../src/core/index.ts'
let host: Host | undefined
afterEach(async () => {
  await host?.stop()
  host = undefined
})
it('starts without GitHub or a repository and preserves explicit intake, deduplication, independent workers and reports', async () => {
  host = await startRuntime()
  const r = host.runtime
  expect(r.configured()).toBe(true)
  expect(r.sources.kind('github')).toBeUndefined()
  const trigger = panelTrigger('Create a local report')
  expect(r.receive(trigger)).toBe('stored')
  expect(r.receive(trigger)).toBe('duplicate')
  const decision = r.engine.decide(trigger.id, {
    kind: 'accept',
    title: 'Local report',
    scope: 'Write a report',
    reason: 'Explicit operator request',
    name: 'local-report',
    acknowledgement: 'I will prepare the report.'
  })
  expect(decision.ticketId).toBeTruthy()
  await r.pump()
  await vi.waitFor(() => expect(latestAssignment(r.store.tickets.get(decision.ticketId!)!)?.state).toBe('running'))
  await vi.waitFor(() => expect(r.sessions.runtime.get(`worker-${decision.ticketId}`)?.status).toBe('idle'))
  expect(r.store.tickets.get(decision.ticketId!)?.ended).toBeUndefined()
  r.engine.report(decision.ticketId!, { state: 'ready', summary: 'Report verified.' })
  expect(r.store.tickets.get(decision.ticketId!)?.ended?.outcome).toBe('completed')
})
it('rejects an unauthorized remote sender', async () => {
  host = await startRuntime()
  const r = host.runtime,
    trigger = panelTrigger('Do work')
  trigger.source = 'feishu'
  trigger.actor = { source: 'feishu', id: 'ou_stranger' }
  trigger.threads = [{ source: 'feishu', id: 'oc_test:om_test' }]
  trigger.meta = { direct: true, chatId: 'oc_test' }
  r.receive(trigger)
  expect(() =>
    r.engine.decide(trigger.id, { kind: 'accept', title: 'Forbidden', scope: 'x', reason: 'x', name: 'forbidden' })
  ).toThrow('not_a_member')
  expect(r.store.tickets.list()).toHaveLength(0)
})
it('isolates simultaneous workers and records follow-ups while rejecting work after a stop', async () => {
  host = await startRuntime()
  const r = host.runtime
  const accept = (text: string, name: string) => {
    const trigger = panelTrigger(text)
    r.receive(trigger)
    return r.engine.decide(trigger.id, {
      kind: 'accept',
      title: text,
      scope: text,
      reason: 'Explicit request',
      name,
      acknowledgement: 'Received.'
    }).ticketId!
  }
  const first = accept('First task KEEP_RUNNING', 'first-task'),
    second = accept('Second task KEEP_RUNNING', 'second-task')
  await r.pump()
  await vi.waitFor(() =>
    expect(r.sessions.runtime.list().filter((s) => s.role === 'worker' && s.status === 'running')).toHaveLength(2)
  )
  const one = r.store.tickets.get(first)!,
    two = r.store.tickets.get(second)!
  expect(one.execution!.directory).not.toBe(two.execution!.directory)
  expect(r.sessions.runtime.get(`worker-${first}`)!.threadId).not.toBe(
    r.sessions.runtime.get(`worker-${second}`)!.threadId
  )
  const followup = panelTrigger('Additional detail', `worker-${first}`)
  r.receive(followup)
  r.engine.attach(first, followup.id)
  await r.pump()
  expect(r.store.tickets.get(first)!.inputs.some((i) => i.kind === 'trigger' && i.triggerId === followup.id)).toBe(true)
  expect(r.store.tickets.get(second)!.inputs.some((i) => i.kind === 'trigger' && i.triggerId === followup.id)).toBe(
    false
  )
  r.engine.stopTicket(first)
  await expect(r.sessions.runtime.send(`worker-${first}`, 'late', 'forbidden')).rejects.toThrow()
  expect(r.store.tickets.get(first)?.ended?.by).toBe('human')
})
