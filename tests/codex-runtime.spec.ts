import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, realpathSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { CodexRuntime } from '../src/executor/codex-runtime.ts'
import { Store } from '../src/app/store.ts'
import { artifactPath } from '../src/index.ts'
const roots: string[] = [],
  runtimes: CodexRuntime[] = [],
  stores: Store[] = []
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'superagent-test-'))
  roots.push(root)
  const store = new Store(join(root, 'state.sqlite'))
  stores.push(store)
  const authorize = vi.fn()
  const runtime = new CodexRuntime(store, resolve('tests/fixtures/codex.mjs'), authorize, root)
  runtimes.push(runtime)
  const spec = { id: 'worker-one', cwd: root, title: 'test', role: 'worker' as const, instructions: 'test', tools: [] }
  return { root, store, runtime, authorize, spec }
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.stop()))
  for (const s of stores.splice(0)) s.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
it('delivers once, streams output, and does not treat a turn ending as a ticket report', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  const events: string[] = []
  h.runtime.subscribe((e) => events.push(e.type))
  await h.runtime.send(h.spec.id, 'input-1', 'hello')
  await vi.waitFor(() => expect(h.runtime.get(h.spec.id)?.status).toBe('idle'))
  await h.runtime.send(h.spec.id, 'input-1', 'hello')
  expect(h.runtime.get(h.spec.id)?.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  expect(events).toContain('ended')
  expect(h.runtime.get(h.spec.id)?.messages.some((m) => m.text === 'Test result')).toBe(true)
})
it('steers the active turn and rejects writes after authorization is withdrawn', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'first', 'KEEP_RUNNING')
  const turn = h.runtime.get(h.spec.id)?.turnId
  await h.runtime.send(h.spec.id, 'second', 'next')
  expect(h.runtime.get(h.spec.id)?.turnId).toBe(turn)
  h.authorize.mockImplementation(() => {
    throw new Error('Ticket ended')
  })
  await expect(h.runtime.send(h.spec.id, 'third', 'forbidden')).rejects.toThrow('Ticket ended')
})
it('requires an explicit panel decision and expires pending approvals across restart', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'first', 'REQUEST_APPROVAL')
  await vi.waitFor(() => expect(h.runtime.approvals()).toHaveLength(1))
  expect(h.runtime.approvals()[0]?.state).toBe('pending')
  const old = h.runtime.approvals()[0]!.id
  await h.runtime.stop()
  const restored = new CodexRuntime(h.store, resolve('tests/fixtures/codex.mjs'), () => {}, h.root)
  runtimes.push(restored)
  expect(restored.approvals()[0]?.state).toBe('expired')
  await expect(restored.approve(old, true)).rejects.toThrow('expired')
})
it('validates dynamic tools through the role-bound tool registry', async () => {
  const h = harness(),
    execute = vi.fn(async () => ({ ok: true }))
  await h.runtime.ensure({
    ...h.spec,
    tools: [{ name: 'orchestrator_test', description: 'test', schema: z.object({ value: z.string() }), execute }]
  })
  await h.runtime.send(h.spec.id, 'first', 'CALL_TOOL')
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  expect(h.authorize).toHaveBeenCalled()
})
it('rejects symlink escapes when downloading artifacts', async () => {
  const h = harness()
  mkdirSync(join(h.root, 'task'))
  writeFileSync(join(h.root, 'secret'), 'secret')
  writeFileSync(join(h.root, 'task', 'result.txt'), 'result')
  symlinkSync(join(h.root, 'secret'), join(h.root, 'task', 'escape'))
  expect(await artifactPath(join(h.root, 'task'), 'result.txt')).toBe(realpathSync(join(h.root, 'task', 'result.txt')))
  await expect(artifactPath(join(h.root, 'task'), 'escape')).rejects.toThrow('outside')
  await expect(artifactPath(join(h.root, 'task'), '../secret')).rejects.toThrow('outside')
})

it('keeps the worker active until child turns and background commands have both ended', async () => {
  const h = harness(),
    ended = vi.fn()
  await h.runtime.ensure(h.spec)
  h.runtime.subscribe((e) => {
    if (e.type === 'ended') ended()
  })
  await h.runtime.send(h.spec.id, 'activities', 'ACTIVITIES')
  await vi.waitFor(() => expect(h.runtime.get(h.spec.id)?.turnId).toBeUndefined())
  expect(h.runtime.get(h.spec.id)?.status).toBe('running')
  expect(ended).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(h.runtime.get(h.spec.id)?.status).toBe('idle'))
  expect(ended).toHaveBeenCalledOnce()
})
it('deduplicates a repeated dynamic tool call before it can repeat a business effect', async () => {
  const h = harness(),
    execute = vi.fn(async () => ({ ok: true }))
  await h.runtime.ensure({
    ...h.spec,
    tools: [{ name: 'orchestrator_test', description: 'test', schema: z.object({ value: z.string() }), execute }]
  })
  await h.runtime.send(h.spec.id, 'duplicate', 'DUPLICATE_TOOL')
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(execute).toHaveBeenCalledOnce()
})
it('starts a new turn only after steer was definitively rejected by an ended turn', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'one', 'KEEP_RUNNING')
  await h.runtime.send(h.spec.id, 'two', 'RACE_END')
  expect(h.runtime.get(h.spec.id)?.deliveries.two).toBe('sent')
  expect(h.runtime.get(h.spec.id)?.turnId).toBe('turn-2')
})
it('records a crash as failure and refuses to replay an uncertain delivery after reconnect', async () => {
  const h = harness(),
    events: string[] = []
  await h.runtime.ensure(h.spec)
  h.runtime.subscribe((e) => events.push(e.type))
  await expect(h.runtime.send(h.spec.id, 'uncertain', 'CRASH_ON_SEND')).rejects.toThrow('exited')
  expect(h.runtime.get(h.spec.id)?.status).toBe('failed')
  expect(events).not.toContain('ended')
  await h.runtime.ensure(h.spec)
  await expect(h.runtime.send(h.spec.id, 'uncertain', 'CRASH_ON_SEND')).rejects.toThrow('Uncertain')
})
it('passes an abortable lifetime to in-flight business tools and waits for cancellation on stop', async () => {
  const h = harness(),
    aborted = vi.fn()
  const execute = vi.fn(
    (_args, signal: AbortSignal) =>
      new Promise((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted()
            resolve({ cancelled: true })
          },
          { once: true }
        )
      )
  )
  await h.runtime.ensure({
    ...h.spec,
    tools: [{ name: 'orchestrator_test', description: 'test', schema: z.object({ value: z.string() }), execute }]
  })
  await h.runtime.send(h.spec.id, 'tool', 'CALL_TOOL')
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
  await h.runtime.interrupt(h.spec.id)
  expect(aborted).toHaveBeenCalledOnce()
})
it('reconciles a received input and missing output from provider history without replaying it', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await expect(h.runtime.send(h.spec.id, 'received', 'CRASH_AFTER_RECEIPT')).rejects.toThrow('exited')
  await h.runtime.ensure(h.spec)
  expect(h.runtime.get(h.spec.id)?.deliveries.received).toBe('sent')
  expect(h.runtime.get(h.spec.id)?.consumed).toContain('received')
  expect(h.runtime.get(h.spec.id)?.messages.some((m) => m.text === 'Recovered from provider history')).toBe(true)
  await expect(h.runtime.send(h.spec.id, 'received', 'CRASH_AFTER_RECEIPT')).resolves.toBeUndefined()
})
it('discards stale turn IDs after an abrupt service restart', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'first', 'KEEP_RUNNING')
  const snapshot = structuredClone(h.runtime.get(h.spec.id)!)
  await h.runtime.stop()
  h.store.set('agent-session:worker-one', snapshot)
  const restored = new CodexRuntime(h.store, resolve('tests/fixtures/codex.mjs'), () => {}, h.root)
  runtimes.push(restored)
  expect(restored.get(h.spec.id)?.turnId).toBeUndefined()
  expect(restored.get(h.spec.id)?.status).toBe('interrupted')
  await restored.ensure(h.spec)
  await restored.send(h.spec.id, 'retry', 'KEEP_RUNNING')
  expect(restored.get(h.spec.id)?.status).toBe('running')
})

it('declining a permission request does not execute it and an ended request cannot be approved again', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'approval', 'REQUEST_APPROVAL')
  await vi.waitFor(() => expect(h.runtime.approvals()).toHaveLength(1))
  const id = h.runtime.approvals()[0]!.id
  await h.runtime.approve(id, false)
  await vi.waitFor(() => expect(h.runtime.get(h.spec.id)?.messages.some((m) => m.text === 'declined')).toBe(true))
  expect(existsSync(join(h.root, 'approved-command-ran'))).toBe(false)
  await expect(h.runtime.approve(id, true)).rejects.toThrow('expired')
})

it('recreates a missing rollout only for an unused session and persists the replacement mapping', async () => {
  const h = harness()
  const spec = { ...h.spec, role: 'orchestrator' as const }
  const original = (await h.runtime.ensure(spec)).threadId
  await h.runtime.stop()
  const restored = new CodexRuntime(h.store, resolve('tests/fixtures/codex.mjs'), () => {}, h.root)
  runtimes.push(restored)
  const session = await restored.ensure({ ...spec, environment: { TEST_MISSING_ROLLOUT: '1' } })
  expect(session.threadId).not.toBe(original)
  expect(session.messages).toEqual([])
  expect(session.deliveries).toEqual({})
  expect(session.status).toBe('idle')
  await restored.stop()
  const again = new CodexRuntime(h.store, resolve('tests/fixtures/codex.mjs'), () => {}, h.root)
  runtimes.push(again)
  expect(again.get(spec.id)?.threadId).toBe(session.threadId)
})

it.each(['sending', 'sent'] as const)('does not recreate a missing rollout with a %s delivery', async (delivery) => {
  const h = harness()
  const session = await h.runtime.ensure(h.spec)
  const original = session.threadId
  session.deliveries['input-1'] = delivery
  await h.runtime.stop()
  const restored = new CodexRuntime(h.store, resolve('tests/fixtures/codex.mjs'), () => {}, h.root)
  runtimes.push(restored)
  await expect(restored.ensure({ ...h.spec, environment: { TEST_MISSING_ROLLOUT: '1' } })).rejects.toThrow('no rollout found')
  expect(restored.get(h.spec.id)?.threadId).toBe(original)
  expect(restored.get(h.spec.id)?.deliveries['input-1']).toBe(delivery)
})
