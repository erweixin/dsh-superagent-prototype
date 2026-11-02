import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { panelTrigger } from '../src/sources/panel.ts'
import { workerSessionId } from '../src/app/worker-sessions.ts'
import { startApplication } from '../src/index.ts'
let app: Awaited<ReturnType<typeof startApplication>> | undefined, root: string | undefined
afterEach(async () => {
  await app?.stop()
  if (root) rmSync(root, { recursive: true, force: true })
  app = undefined
  root = undefined
})
it('serves a standalone panel, enforces same origin, and records local requests without GitHub', async () => {
  root = mkdtempSync(join(tmpdir(), 'superagent-http-'))
  const config = join(root, 'config.json')
  writeFileSync(
    config,
    JSON.stringify({ stateDir: join(root, 'state'), port: 0, codexPath: resolve('tests/fixtures/codex.mjs') })
  )
  app = await startApplication(config)
  await app.runtime.ready
  const port = (app.server.address() as { port: number }).port,
    base = `http://127.0.0.1:${port}`
  expect((await fetch(base)).status).toBe(200)
  expect((await fetch(`${base}/orchestrator/api/state`)).status).toBe(403)
  const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
  const botRequest = { action: 'check', cli: resolve('tests/fixtures/lark-setup.mjs'), appId: 'cli_fixture',
    appSecret: 'fixture-secret', brand: 'feishu' }
  const unauthorizedBot = await fetch(`${base}/orchestrator/api/setup/feishu`, {
    method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: JSON.stringify(botRequest)
  })
  expect(unauthorizedBot.status).toBe(403)
  const malformedBot = await fetch(`${base}/orchestrator/api/setup/feishu`, {
    method: 'POST', headers, body: '{"appSecret":"do-not-return-this",bad'
  })
  expect(malformedBot.status).toBe(400)
  expect(await malformedBot.text()).not.toContain('do-not-return-this')
  const botResponse = await fetch(`${base}/orchestrator/api/setup/feishu`, {
    method: 'POST', headers, body: JSON.stringify(botRequest)
  })
  expect(botResponse.status).toBe(200)
  expect(botResponse.headers.get('cache-control')).toBe('no-store')
  expect(await botResponse.json()).toEqual({bot:{appId:'cli_fixture',brand:'feishu',botId:'ou_fixture',name:'Fixture bot'},saved:false,restarting:false})
  const state = await (await fetch(`${base}/orchestrator/api/state`, { headers })).json()
  expect(state.setup.problem).toBeNull()
  expect(state.setup.accounts).not.toHaveProperty('repository')
  const rejected = await fetch(`${base}/orchestrator/api/session/message`, {
    method: 'POST',
    headers: { ...headers, origin: 'https://untrusted.example' },
    body: JSON.stringify({ text: 'untrusted' })
  })
  expect(rejected.status).toBe(403)
  const response = await fetch(`${base}/orchestrator/api/session/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'Prepare a local summary' })
  })
  expect(response.status).toBe(200)
  expect(
    app.runtime.store.read
      .triggers({}, 0, 10)
      .items.some((t) => t.source === 'panel' && t.text === 'Prepare a local summary')
  ).toBe(true)
  const original = app.runtime.store.read.triggers({}, 0, 10).items.find((t) => t.text === 'Prepare a local summary')!
  const ticketId = app.runtime.engine.decide(original.id, {
    kind: 'accept',
    title: 'Summary',
    scope: 'Summary',
    reason: 'Operator request',
    name: 'summary',
    acknowledgement: 'Received.'
  }).ticketId!
  const supplemental = await fetch(`${base}/orchestrator/api/session/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: `worker-${ticketId}`, text: 'Include a title' })
  })
  expect(supplemental.status).toBe(200)
  expect(app.runtime.store.tickets.get(ticketId)!.inputs.some((i) => i.kind === 'trigger')).toBe(true)
  app.runtime.engine.stopTicket(ticketId)
  const stopped = await fetch(`${base}/orchestrator/api/session/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: `worker-${ticketId}`, text: 'Do not create this' })
  })
  expect(stopped.status).toBe(400)
  expect(app.runtime.store.read.triggers({}, 0, 100).items.some((t) => t.text === 'Do not create this')).toBe(false)
  const kind = app.runtime.sources.kind('panel')!
  kind.workspaces = () => [{ key: 'group', directory: realpathSync(app!.runtime.machine.stateDir) }]
  kind.workspaceKey = () => 'group'
  const groupTrigger = panelTrigger('KEEP_RUNNING')
  app.runtime.receive(groupTrigger)
  const groupTicket = app.runtime.store.tickets.get(app.runtime.engine.decide(groupTrigger.id, {
    kind: 'accept', title: 'Group', scope: 'Test', reason: 'Requested', name: 'group'
  }).ticketId!)!
  const groupSession = workerSessionId(groupTicket)
  await app.runtime.pump()
  await vi.waitFor(() => expect(app!.runtime.sessions.runtime.get(groupSession)).toBeDefined())
  const snapshot = await (await fetch(`${base}/orchestrator/api/sessions`, { headers })).json()
  expect(snapshot.sessions.find((item: { id: string }) => item.id === groupSession).ticketId).toBe(groupTicket.id)
  const staleInput = await fetch(`${base}/orchestrator/api/session/message`, {
    method: 'POST', headers, body: JSON.stringify({sessionId:groupSession,ticketId,text:'Stale group input'})
  })
  expect(staleInput.status).toBe(400)
  expect(app.runtime.store.read.triggers({},0,100).items.some(t=>t.text==='Stale group input')).toBe(false)
  const currentInput = await fetch(`${base}/orchestrator/api/session/message`, {
    method: 'POST', headers, body: JSON.stringify({sessionId:groupSession,ticketId:groupTicket.id,text:'Current group input'})
  })
  expect(currentInput.status).toBe(200)
  expect(app.runtime.store.tickets.get(groupTicket.id)!.inputs.some(i=>i.kind==='trigger')).toBe(true)

})
