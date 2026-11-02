import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Runtime } from '../../src/app/runtime.ts'
import { machineOf } from '../../src/deployment.ts'
export interface Host {
  runtime: Runtime
  directory: string
  stop(): Promise<void>
}
export async function startRuntime(): Promise<Host> {
  const directory = mkdtempSync(join(tmpdir(), 'superagent-runtime-'))
  const runtime = new Runtime(
    machineOf({ stateDir: directory, codexPath: resolve('tests/fixtures/codex.mjs') }),
    () => {}
  )
  await runtime.ready
  return {
    runtime,
    directory,
    async stop() {
      await runtime.stop()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
