/** Real CLI regression: resumed threads must receive upgraded dynamic tool schemas. No external messages are sent. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Store } from '../src/app/store.ts'
import { CodexRuntime } from '../src/executor/codex-runtime.ts'

const root = await mkdtemp(join(tmpdir(), 'superagent-tool-refresh-'))
const store = new Store(join(root, 'state.sqlite'))
const calls: unknown[] = []
const runtime = new CodexRuntime(store, 'codex', () => {}, root)
const execute = async (args: unknown) => { calls.push(args); return { recorded: true } }
const spec = { id: 'tool-refresh-probe', cwd: root, title: 'Tool schema refresh probe', role: 'worker' as const,
  instructions: 'This is an isolated tool schema test. Only call probe_report as requested. Do not use filesystem, browser, shell, MCP or external services. After the call, reply with done.',
  tools: [{ name: 'probe_report', description: 'Record test arguments locally only. Never sends a message.', schema: z.object({ text: z.string() }), execute }] }
async function settled() {
  const until = Date.now() + 120000
  while (Date.now() < until) {
    const session = runtime.get(spec.id)!
    if (session.status === 'idle') return
    if (session.status === 'failed') throw new Error(session.error)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Real CLI probe timed out')
}
try {
  const originalThread = (await runtime.ensure(spec)).threadId
  await runtime.send(spec.id, 'old-schema', 'Call probe_report exactly once with text="before".')
  await settled()
  assert.deepEqual(calls, [{ text: 'before' }])
  const upgraded = { ...spec, tools: [{ ...spec.tools[0]!, schema: z.object({ text: z.string(), images: z.array(z.object({ image_key: z.string() })) }) }] }
  const migrated = await runtime.ensure(upgraded)
  assert.notEqual(migrated.threadId, originalThread)
  assert.equal(migrated.deliveries['old-schema'], 'sent')
  await runtime.send(spec.id, 'new-schema', 'Call probe_report exactly once with text="after" and images=[{"image_key":"img_probe"}]. This key is test data and must not be sent anywhere.')
  await settled()
  assert.deepEqual(calls, [{ text: 'before' }, { text: 'after', images: [{ image_key: 'img_probe' }] }])
  console.log(JSON.stringify({ oldToolCalled: true, upgradedImagesFieldCalled: true, previousHistoryPreserved: true, noDuplicateOldCall: true }))
} finally { await runtime.stop(); store.close(); await rm(root, { recursive: true, force: true }) }
