// Uses the current local Codex login; writes only in a fresh temporary state directory.
import assert from 'node:assert/strict'
import { Runtime } from '../src/app/runtime.ts'
import { machineOf } from '../src/deployment.ts'
import { panelReplies, panelTrigger } from '../src/sources/panel.ts'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function main() {
  const stateDir = await mkdtemp(join(tmpdir(), 'superagent-real-smoke-'))
  const r = new Runtime(machineOf({ stateDir, codexPath: 'codex' }), () => {})
  try {
    await r.ready
    if (!r.configured()) throw new Error(r.setupProblem?.detail ?? 'Setup failed')
    r.receive(
      panelTrigger(
        'This is an explicit local smoke-test request. Create result.txt in your assigned task directory containing exactly SUPERAGENT_SMOKE_OK and verify its contents. Do not use external services or modify files outside the task directory. Report ready and reply with a short result summary.'
      )
    )
    await r.pump()
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const ticket = r.store.tickets.list()[0]
      if (ticket?.ended && (r.store.get(panelReplies)?.length ?? 0) >= 2) {
        const data = await readFile(join(ticket.execution!.directory, 'result.txt'), 'utf8')
        assert.equal(ticket.ended.outcome, 'completed')
        assert.equal(data.trim(), 'SUPERAGENT_SMOKE_OK')
        console.log(
          JSON.stringify({
            stateDir,
            outcome: ticket.ended.outcome,
            replies: r.store.get(panelReplies)?.length,
            artifactMatches: data.trim() === 'SUPERAGENT_SMOKE_OK'
          })
        )
        return
      }
    }
    console.log(
      JSON.stringify({
        stateDir,
        tickets: r.store.tickets.list().map((t) => ({ id: t.id, assignments: t.assignments })),
        sessions: r.sessions.runtime
          .list()
          .map((s) => ({ id: s.id, status: s.status, error: s.error, messages: s.messages.slice(-4) }))
      })
    )
    throw new Error('Smoke deadline exceeded')
  } finally {
    await r.stop()
  }
}
main().catch((e) => {
  console.error(String(e))
  process.exitCode = 1
})
