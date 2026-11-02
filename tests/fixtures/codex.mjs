#!/usr/bin/env node
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.153.4')
  process.exit(0)
}
if (process.argv[2] === 'login') {
  console.log('Logged in')
  process.exit(0)
}
const send = (v) => process.stdout.write(JSON.stringify(v) + '\n')
let thread = `test-${randomUUID()}`,
  turn = 0
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (!m.method) {
    if (m.id === 100 && m.result) {
      const accepted = m.result.decision === 'accept'
      if (accepted) writeFileSync('approved-command-ran', 'yes')
      send({
        method: 'item/agentMessage/delta',
        params: { threadId: thread, itemId: 'approval-result', delta: accepted ? 'accepted' : 'declined' }
      })
      send({
        method: 'turn/completed',
        params: { threadId: thread, turn: { id: `turn-${turn}`, status: 'completed' } }
      })
    }
    return
  }
  const p = m.params ?? {}
  let result = {}
  if (m.method === 'initialize') result = { userAgent: 'codex-test' }
  if (m.method === 'thread/resume' && process.env.TEST_MISSING_ROLLOUT === '1') {
    send({id:m.id,error:{code:-32600,message:`no rollout found for thread id ${p.threadId}`}})
    return
  }
  if (m.method === 'thread/start' || m.method === 'thread/resume') {
    thread = p.threadId ?? thread
    let turns = []
    try {
      turns = JSON.parse(readFileSync('fake-history.json', 'utf8'))
    } catch {}
    result = { thread: { id: thread, turns } }
  }
  if (m.method === 'model/list')
    result = { data: [{ model: 'test-model', displayName: 'Test', supportedReasoningEfforts: [] }], nextCursor: null }
  if (m.method === 'turn/start') {
    if (
      p.sandboxPolicy?.type === 'workspaceWrite' &&
      (p.sandboxPolicy.excludeSlashTmp !== true ||
        p.sandboxPolicy.excludeTmpdirEnvVar !== true ||
        p.sandboxPolicy.writableRoots?.[0] !== p.cwd)
    ) {
      send({ id: m.id, error: { message: 'Unsafe worker sandbox' } })
      return
    }
    const id = `turn-${++turn}`
    result = { turn: { id, status: 'inProgress' } }
    send({ method: 'turn/started', params: { threadId: thread, turn: result.turn } })
    const text = p.input?.[0]?.text ?? ''
    if (text.includes('CRASH_AFTER_RECEIPT')) {
      writeFileSync(
        'fake-history.json',
        JSON.stringify([
          {
            id,
            items: [
              { id: 'received', type: 'userMessage', content: p.input },
              { id: 'missed-output', type: 'agentMessage', text: 'Recovered from provider history' }
            ]
          }
        ])
      )
      process.exit(1)
    }
    if (text.includes('CRASH_ON_SEND')) process.exit(1)
    if (text.includes('ACTIVITIES')) {
      send({
        method: 'thread/started',
        params: { thread: { id: 'child', parentThreadId: thread, status: { type: 'active' } } }
      })
      send({ method: 'turn/started', params: { threadId: 'child', turn: { id: 'child-turn' } } })
      send({
        method: 'item/started',
        params: { threadId: thread, item: { id: 'background', type: 'commandExecution', status: 'inProgress' } }
      })
      setTimeout(
        () => send({ method: 'turn/completed', params: { threadId: thread, turn: { id, status: 'completed' } } }),
        20
      )
      setTimeout(
        () =>
          send({
            method: 'turn/completed',
            params: { threadId: 'child', turn: { id: 'child-turn', status: 'completed' } }
          }),
        120
      )
      setTimeout(
        () =>
          send({
            method: 'item/completed',
            params: {
              threadId: thread,
              item: { id: 'background', type: 'commandExecution', status: 'completed', exitCode: 0 }
            }
          }),
        250
      )
      setTimeout(
        () =>
          send({
            method: 'item/completed',
            params: {
              threadId: thread,
              item: {
                id: 'background',
                type: 'commandExecution',
                status: 'completed',
                processId: 'pty-1',
                exitCode: null
              }
            }
          }),
        60
      )
    } else if (text.includes('DUPLICATE_TOOL')) {
      const call = {
        method: 'item/tool/call',
        params: {
          threadId: thread,
          turnId: id,
          callId: 'same-call',
          tool: 'orchestrator_test',
          arguments: { value: 'ok' }
        }
      }
      setTimeout(() => send({ ...call, id: 201 }), 10)
      setTimeout(() => send({ ...call, id: 202 }), 80)
    } else if (text.includes('REQUEST_APPROVAL'))
      setTimeout(
        () =>
          send({
            id: 100,
            method: 'item/commandExecution/requestApproval',
            params: {
              threadId: thread,
              turnId: id,
              itemId: 'cmd-1',
              command: 'touch /outside/test',
              reason: 'test boundary'
            }
          }),
        10
      )
    else if (text.includes('CALL_TOOL'))
      setTimeout(
        () =>
          send({
            id: 101,
            method: 'item/tool/call',
            params: {
              threadId: thread,
              turnId: id,
              callId: 'call',
              tool: 'orchestrator_test',
              arguments: { value: 'ok' }
            }
          }),
        10
      )
    else if (!text.includes('KEEP_RUNNING'))
      setTimeout(() => {
        send({
          method: 'item/agentMessage/delta',
          params: { threadId: thread, itemId: `message-${turn}`, delta: 'Test result' }
        })
        send({ method: 'turn/completed', params: { threadId: thread, turn: { id, status: 'completed' } } })
      }, 25)
  }
  if (m.method === 'turn/steer') {
    if (p.input?.[0]?.text?.includes('RACE_END')) {
      send({
        method: 'turn/completed',
        params: { threadId: thread, turn: { id: p.expectedTurnId, status: 'completed' } }
      })
      send({ id: m.id, error: { code: -32600, message: 'Turn already completed' } })
      return
    }
    result = { turnId: p.expectedTurnId }
  }
  if (m.method === 'turn/interrupt')
    send({ method: 'turn/completed', params: { threadId: thread, turn: { id: p.turnId, status: 'interrupted' } } })
  if (m.id !== undefined) send({ id: m.id, result })
})
