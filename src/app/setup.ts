import { writeEnvironment } from '../infra/environment.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Deployment, Machine } from '../deployment.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'
const execute = promisify(execFile)
// Explicitly supported app-server releases; do not assume experimental APIs are forward-compatible.
const supportedCodexVersions: readonly string[] = ['0.153.4', '0.166.0']
const fields = (s: Settings, sources: SourceRegistry) =>
  JSON.stringify(Object.entries(sources.setupFields()).map(([id, keys]) => keys.map(k => s.sources[id]?.config[k] ?? '')))
export const setupChanged = (before: Settings, after: Settings, sources: SourceRegistry) => fields(before, sources) !== fields(after, sources)
/** Owns the application lifecycle and state for this adapter. */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  readonly sourceProblems: Record<string, SetupProblem> = {}
  /** Compatibility accessor; source consumers use sourceProblems by ID. */
  get feishuProblem(): SetupProblem | undefined { return this.sourceProblems.feishu }
  constructor(private host: { machine: Machine; lifetime: AbortSignal; restart(): void }, private readonly sources: SourceRegistry) {}
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
      const accounts: Record<string, unknown> = {}
      const legacy: Record<string, unknown> = {}
      for (const id of Object.keys(this.sourceProblems)) delete this.sourceProblems[id]
      for (const kind of this.sources.installed()) {
        if (!kind.setup) continue
        try {
          const account = await kind.setup.resolve(this.host.machine, settings.sources[kind.kind]?.config, this.probe)
          if (account !== undefined) {
            accounts[kind.kind] = account
            if (kind.setup.legacyAccountKey) legacy[kind.setup.legacyAccountKey] = account
          }
        } catch (error) {
          if (!(error instanceof SetupError)) throw error
          this.sourceProblems[kind.kind] = error.problem
        }
      }
      this.resolved = { ...this.host.machine, accounts, ...legacy }
      await writeEnvironment(this.resolved, settings.executor.blockedCommands, this.shims(this.resolved))
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
    if (!block.startsWith('source:')) return
    const id = block.slice('source:'.length)
    await this.sources.kind(id)?.setup?.resolve(this.host.machine, settings.sources[id]?.config, this.probe)
  }
  async blockCommands(blocked: readonly string[]) {
    if (this.resolved) await writeEnvironment(this.resolved, blocked, this.shims(this.resolved))
  }
  private shims(deployment: Deployment): Record<string, string> {
    const shims: Record<string, string> = {}
    for (const kind of this.sources.installed()) {
      for (const [name, script] of Object.entries(kind.setup?.shims?.(deployment) ?? {})) {
        if (name in shims) throw new Error(`Duplicate source command: ${name}`)
        shims[name] = script
      }
    }
    return shims
  }
  restore() {}
}
