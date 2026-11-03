import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, realpathSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs'
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
it('refreshes saved tool definitions while preserving the local transcript and delivery ledger', async () => {
  const h = harness(), execute = vi.fn(async () => ({ ok: true }))
  const oldSpec = { ...h.spec, tools: [{ name: 'orchestrator_reply', description: 'Reply', schema: z.object({ text: z.string() }), execute }] }
  const previous = (await h.runtime.ensure(oldSpec)).threadId
  await h.runtime.send(h.spec.id, 'already-delivered', 'hello')
  await vi.waitFor(() => expect(h.runtime.get(h.spec.id)?.status).toBe('idle'))
  const upgraded = { ...oldSpec, tools: [{ ...oldSpec.tools[0]!, schema: z.object({ text: z.string(), images: z.array(z.object({ image_key: z.string() })).optional() }) }] }
  const current = await h.runtime.ensure(upgraded)
  expect(current.threadId).not.toBe(previous)
  expect(current.previousThreadIds).toContain(previous)
  expect(current.deliveries['already-delivered']).toBe('sent')
  expect(current.messages.some(m => m.text === 'Test result')).toBe(true)
  expect(readFileSync(join(h.root, 'fake-injected-context.json'), 'utf8')).toContain('historical context only')
  await h.runtime.send(h.spec.id, 'image', 'CHECK_IMAGE_TOOLS')
  await vi.waitFor(() => expect(execute).toHaveBeenCalledWith({ text: 'image probe', images: [{ image_key: 'img_probe' }] }, expect.any(AbortSignal)))
  const refreshed = current.threadId
  await h.runtime.interrupt(h.spec.id)
  expect((await h.runtime.ensure(upgraded)).threadId).toBe(refreshed)
})
it('migrates legacy sessions without a tool fingerprint once after restart', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'first', 'hello')
  await vi.waitFor(() => expect(h.runtime.get(h.spec.id)?.status).toBe('idle'))
  const snapshot = structuredClone(h.runtime.get(h.spec.id)!)
  await h.runtime.stop()
  delete snapshot.toolSchemaFingerprint
  h.store.set('agent-session:worker-one', snapshot)
  const restored = new CodexRuntime(h.store, resolve('tests/fixtures/codex.mjs'), () => {}, h.root)
  runtimes.push(restored)
  const current = await restored.ensure(h.spec)
  expect(current.previousThreadIds).toEqual([snapshot.threadId])
  expect(current.deliveries.first).toBe('sent')
  expect(current.toolSchemaFingerprint).toBeTruthy()
})
it('does not replace a running turn or lose the old thread if migration fails', async () => {
  const h = harness()
  const old = (await h.runtime.ensure(h.spec)).threadId
  await h.runtime.send(h.spec.id, 'first', 'KEEP_RUNNING')
  const upgraded = { ...h.spec, tools: [{ name: 'new_tool', description: 'new', schema: z.object({}), execute: async () => ({ ok: true }) }] }
  await expect(h.runtime.ensure(upgraded)).rejects.toThrow('active turn')
  expect(h.runtime.get(h.spec.id)?.threadId).toBe(old)
  await h.runtime.interrupt(h.spec.id)
  await expect(h.runtime.ensure({ ...upgraded, environment: { TEST_FAIL_TOOL_REFRESH: '1' } })).rejects.toThrow('Context injection failed')
  expect(h.runtime.get(h.spec.id)?.threadId).toBe(old)
  expect(h.runtime.get(h.spec.id)?.deliveries.first).toBe('sent')
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
it.each([true, false])('forwards MCP application access and replies only after the panel decision (%s)', async accept => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'access', 'ELICITATION_NO_TURN')
  await vi.waitFor(() => expect(h.runtime.approvals()).toHaveLength(1))
  const approval = h.runtime.approvals()[0]!
  expect(approval.elicitation).toMatchObject({ canAccept: true, session: true, serverName: 'cua_repl' })
  expect(approval.turnId).toBe('turn-1')
  const response = join(h.root, 'elicitation-response.json')
  expect(existsSync(response)).toBe(false)
  await h.runtime.approve(approval.id, accept)
  await vi.waitFor(() => expect(JSON.parse(readFileSync(response, 'utf8')).result).toEqual(accept
    ? { action: 'accept', content: {}, _meta: { persist: 'session' } }
    : { action: 'decline', content: null }))
  expect(approval.state).toBe(accept ? 'accepted' : 'declined')
  await expect(h.runtime.approve(approval.id, true)).rejects.toThrow('expired')
})
it.each(['FOREIGN', 'STALE'])('rejects MCP requests outside the current owned turn (%s)', async scope => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'access', `ELICITATION_${scope}`)
  const response = join(h.root, 'elicitation-response.json')
  await vi.waitFor(() => expect(JSON.parse(readFileSync(response, 'utf8')).error.code).toBe(-32600))
  expect(h.runtime.approvals()).toHaveLength(0)
})
it.each(['FIELDS', 'VERIFY'])('does not approve unsupported MCP forms or device proofs (%s)', async mode => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'access', `ELICITATION_${mode}`)
  await vi.waitFor(() => expect(h.runtime.approvals()).toHaveLength(1))
  const approval = h.runtime.approvals()[0]!
  expect(approval.elicitation?.canAccept).toBe(false)
  await expect(h.runtime.approve(approval.id, true)).rejects.toThrow('does not support')
  expect(existsSync(join(h.root, 'elicitation-response.json'))).toBe(false)
  await h.runtime.approve(approval.id, false)
})
it.each(['RESOLVED', 'END_TURN'])('expires MCP approvals when the server resolves or ends the request (%s)', async event => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'access', `ELICITATION_${event}`)
  await vi.waitFor(() => expect(h.runtime.approvals()).toHaveLength(1))
  const approval = h.runtime.approvals()[0]!
  await vi.waitFor(() => expect(approval.state).toBe('expired'))
  await expect(h.runtime.approve(approval.id, true)).rejects.toThrow('expired')
  expect(existsSync(join(h.root, 'elicitation-response.json'))).toBe(false)
})
it('rechecks ticket authorization before granting application access', async () => {
  const h = harness()
  await h.runtime.ensure(h.spec)
  await h.runtime.send(h.spec.id, 'access', 'ELICITATION')
  await vi.waitFor(() => expect(h.runtime.approvals()).toHaveLength(1))
  h.authorize.mockImplementation(() => { throw new Error('Ticket ended') })
  await expect(h.runtime.approve(h.runtime.approvals()[0]!.id, true)).rejects.toThrow('Ticket ended')
  expect(existsSync(join(h.root, 'elicitation-response.json'))).toBe(false)
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
