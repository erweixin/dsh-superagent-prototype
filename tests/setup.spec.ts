import { SourceRegistry } from '../src/sources/registry.ts'
import { installedSourceKinds } from '../src/app/source-plugins.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Setup } from '../src/app/setup.ts'
import { machineOf } from '../src/deployment.ts'
import { SettingsSchema } from '../src/policy.ts'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function harness(output: string) {
  vi.stubEnv('TEST_CODEX_VERSION_OUTPUT', output)
  const stateDir = mkdtempSync(join(tmpdir(), 'superagent-setup-'))
  roots.push(stateDir)
  const codexPath = resolve('tests/fixtures/codex.mjs')
  const sources = new SourceRegistry(() => SettingsSchema.parse({}))
  for (const kind of installedSourceKinds) sources.register(kind)
  const setup = new Setup({ machine: machineOf({ stateDir, codexPath }), lifetime: new AbortController().signal, restart() {} }, sources)
  return { setup, stateDir, codexPath }
}

it.each(['0.153.4', '0.166.0'])('prepares the environment with supported Codex CLI %s', async (version) => {
  const { setup, stateDir } = harness(`codex-cli ${version}`)
  expect(await setup.run(SettingsSchema.parse({}))).toBe(true)
  expect(setup.configured()).toBe(true)
  expect(setup.problem).toBeUndefined()
  expect(existsSync(join(stateDir, 'worker-bin', 'lark-cli'))).toBe(true)
})

it.each(['codex-cli 0.152.0', 'codex-cli 0.167.0', 'codex-cli 0.166.0-alpha.1', 'unexpected output'])(
  'reports the actual CLI and path without preparing an unsupported environment: %s', async (output) => {
    const { setup, stateDir, codexPath } = harness(output)
    expect(await setup.run(SettingsSchema.parse({}))).toBe(false)
    expect(setup.configured()).toBe(false)
    expect(setup.problem?.code).toBe('environmentFailed')
    expect(setup.problem?.detail).toContain(output)
    expect(setup.problem?.detail).toContain(codexPath)
    expect(setup.problem?.detail).toContain('0.166.0')
    expect(existsSync(join(stateDir, 'worker-bin'))).toBe(false)
  }
)
