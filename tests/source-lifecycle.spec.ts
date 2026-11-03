import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { SourceLoops } from '../src/sources/loops.ts'
import { SourceOnboarding } from '../src/sources/onboarding.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import type { SourceContext, SourceHost } from '../src/sources/host.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import type { SourceSetupHost } from '../src/sources/server.ts'
import { SettingsSchema } from '../src/policy.ts'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const kind = (id: string, run?: SourceKind['run']): SourceKind => ({ kind: id, title: { zh: id, en: id },
  description: { zh: '', en: '' }, schema: z.object({}), fields: [], health: [id], ...(run ? { run } : {}) })
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function harness() {
  const controller = new AbortController()
  const failed = vi.fn(), report = vi.fn()
  let loops!: SourceLoops
  const sources = new SourceRegistry(() => SettingsSchema.parse({}), undefined, value => loops.registered(value))
  const host: SourceHost = { sources, context: () => ({ report } as unknown as SourceContext) }
  loops = new SourceLoops(host, sources, controller.signal, failed)
  return { loops, sources, controller, failed, report }
}
it('starts each source once, cancels on unregister and waits for its final work before shutdown', async () => {
  const h = harness(), drain = deferred()
  let signal!: AbortSignal
  const run = vi.fn(async (_context, input: AbortSignal) => { signal = input; await drain.promise })
  const unregister = h.sources.register(kind('demo', run))
  expect(run).not.toHaveBeenCalled()
  h.loops.start(); h.loops.start(); await tick()
  expect(run).toHaveBeenCalledOnce()
  unregister()
  expect(signal.aborted).toBe(true)
  let closed = false
  const stopped = h.loops.stop().then(() => { closed = true })
  await tick(); expect(closed).toBe(false)
  drain.resolve(); await stopped
  expect(closed).toBe(true)
  expect(h.failed).not.toHaveBeenCalled()
})
it('starts replacement consumers only after the previous registration drains', async () => {
  const h = harness(), drain = deferred()
  const first = vi.fn(async () => { await drain.promise }), next = vi.fn(async () => {})
  const unregister = h.sources.register(kind('demo', first))
  h.loops.start(); await tick(); unregister()
  h.sources.register(kind('demo', next)); await tick()
  expect(next).not.toHaveBeenCalled()
  drain.resolve(); await tick()
  expect(next).toHaveBeenCalledOnce()
  await h.loops.stop()
})
it('isolates one failed consumer and does not start consumers after shutdown or an aborted lifetime', async () => {
  const h = harness(), drain = deferred()
  h.sources.register(kind('bad', async () => { throw new Error('fixture failure') }))
  const good = vi.fn(async () => { await drain.promise })
  h.sources.register(kind('good', good)); h.loops.start(); await tick()
  expect(h.failed).toHaveBeenCalledWith('bad', expect.any(Error))
  expect(h.report).toHaveBeenCalledWith('bad', expect.objectContaining({ state: 'error' }))
  expect(good).toHaveBeenCalledOnce()
  h.controller.abort(); drain.resolve(); await h.loops.stop()
  const late = vi.fn(async () => {})
  h.sources.register(kind('late', late)); h.loops.start(); await tick()
  expect(late).not.toHaveBeenCalled()
})
it('creates onboarding handlers once, preserves their state across hosts and removes routes when the source is unregistered', async () => {
  const h = harness()
  const handler = vi.fn(async () => ({ saved: false }))
  const create = vi.fn(() => handler)
  const plugin = { ...kind('demo'), setup: { fields: ['cli'], resolve: async () => undefined,
    onboarding: { path: 'setup/demo', create } } }
  const unregister = h.sources.register(plugin)
  const onboarding = new SourceOnboarding([plugin])
  const input = { action: 'check' }
  const host = {} as SourceSetupHost
  await onboarding.handler('setup/demo', h.sources)!(host, input)
  await onboarding.handler('setup/demo', h.sources)!({ ...host }, input)
  expect(create).toHaveBeenCalledOnce()
  expect(handler).toHaveBeenCalledTimes(2)
  unregister()
  expect(onboarding.handler('setup/demo', h.sources)).toBeUndefined()
  expect(onboarding.handler('unknown', h.sources)).toBeUndefined()
})
