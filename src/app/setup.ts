import { writeEnvironment } from '../infra/environment.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SETUP_FIELDS, resolveFeishuBot, type Deployment, type Machine } from '../deployment.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'
const execute = promisify(execFile)
// Explicitly supported app-server releases; do not assume experimental APIs are forward-compatible.
const supportedCodexVersions: readonly string[] = ['0.153.4', '0.166.0']
const fields = (s: Settings) =>
  JSON.stringify(Object.entries(SETUP_FIELDS).map(([id, keys]) => keys.map((k) => s.sources[id]?.config[k] ?? '')))
export const setupChanged = (before: Settings, after: Settings) => fields(before) !== fields(after)
/** Owns the application lifecycle and state for this adapter. */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  feishuProblem?: SetupProblem
  constructor(private host: { machine: Machine; lifetime: AbortSignal; restart(): void }) {}
  get commandEnvironment(): Record<string, string | undefined> {
    return {}
  }
  get deployment() {
    if (!this.resolved) throw new Error('Setup incomplete')
    return this.resolved
  }
  configured() {
    return !!this.resolved
  }
  private probe = async (argv: string[]) => {
    const { stdout } = await execute(argv[0]!, argv.slice(1), {
      cwd: this.host.machine.stateDir,
      signal: this.host.lifetime,
      timeout: 60000
    })
    return stdout
  }
  async run(settings: Settings) {
    try {
      const version = (await this.probe([this.host.machine.codexPath, '--version'])).trim()
      const detected = /^codex-cli (\d+\.\d+\.\d+)$/.exec(version)?.[1]
      if (!detected || !supportedCodexVersions.includes(detected))
        throw new Error(
          `Supported Codex CLI versions: ${supportedCodexVersions.join(', ')}; detected ${JSON.stringify(version)} ` +
          `from ${JSON.stringify(this.host.machine.codexPath)}. Set codexPath to a supported executable.`
        )
      await this.probe([this.host.machine.codexPath, 'login', 'status'])
      const feishu = await resolveFeishuBot(this.host.machine, settings.sources.feishu?.config, this.probe).catch(
        (e) => {
          if (e instanceof SetupError) this.feishuProblem = e.problem
          else throw e
          return undefined
        }
      )
      this.resolved = { ...this.host.machine, ...(feishu ? { feishu } : {}) }
      await writeEnvironment(this.resolved, settings.executor.blockedCommands)
      this.problem = undefined
      return true
    } catch (e) {
      this.problem = new SetupError('environmentFailed', { output: String(e) }).problem
      return false
    }
  }
  fail(error: unknown) {
    this.resolved = undefined
    this.problem = new SetupError('environmentFailed', { output: String(error) }).problem
  }
  check() {
    this.restart()
  }
  restart() {
    setTimeout(() => this.host.restart(), 0)
  }
  async checkAccounts(block: SettingsBlock, settings: Settings) {
    if (block === 'source:feishu')
      await resolveFeishuBot(this.host.machine, settings.sources.feishu?.config, this.probe)
  }
  async blockCommands(blocked: readonly string[]) {
    if (this.resolved) await writeEnvironment(this.resolved, blocked)
  }
  restore() {}
}
