import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { SetupError } from './setup.ts'
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
const workerBin = (stateDir: string) => join(stateDir, 'worker-bin')
const sameDirectory = (a: string, b: string) => a === b
export const Config = z
  .object({
    stateDir: z.string().refine(isAbsolute),
    port: z.number().int().min(0).max(65535).default(4317),
    codexPath: z.string().default('codex'),
    promptMaxChars: z.number().int().min(1000).default(100000),
    admissionContextMaxPages: z.number().int().min(1).default(10),
    admissionContextTimeoutMs: z.number().int().min(1).default(15000)
  })
  .strict()
export type DeploymentConfig = z.infer<typeof Config>
export interface Machine {
  stateDir: string
  port: number
  codexPath: string
  promptMaxChars: { get(): number }
  admissionContextMaxPages: { get(): number }
  admissionContextTimeoutMs: { get(): number }
}
export function machineOf(input: unknown): Machine {
  const c = Config.parse(input)
  return {
    ...c,
    ...Object.fromEntries(
      ['promptMaxChars', 'admissionContextMaxPages', 'admissionContextTimeoutMs'].map((k) => [
        k,
        { get: () => c[k as keyof typeof c] }
      ])
    )
  } as unknown as Machine
}
export const FeishuBotSchema = z.object({ cli: z.string().trim().default('') })
export const SETUP_FIELDS: Readonly<Record<string, readonly string[]>> = { feishu: ['cli'] }
export interface FeishuBot {
  cli: string
  appId: string
  brand: 'feishu' | 'lark'
  botId: string
  name: string
}
export interface Deployment extends Machine {
  feishu?: FeishuBot
}
/** Resolve a command name or absolute path to an executable file, ignoring the worker shim directory. */
export function executable(name: string, path: string, exclude?: string): string {
  if (name.includes('/') && !isAbsolute(name)) throw new Error(`${name} must be a command name or an absolute path`)
  const candidates = isAbsolute(name)
    ? [name]
    : path
        .split(delimiter)
        .filter((dir) => isAbsolute(dir) && !(exclude && sameDirectory(dir, exclude)))
        .map((dir) => join(dir, name))
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK)
        return candidate
      }
    } catch {
      /* Not an executable file here; try the next PATH directory. */
    }
  }
  throw new Error(`${name} is not an executable file${isAbsolute(name) ? '' : ' on PATH'}`)
}

export type Probe = (argv: string[]) => Promise<string>
function parsed<T>(schema: z.ZodType<T>, text: string): T | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined /* Non-JSON output; the caller surfaces the setup failure. */
  }
  const result = schema.safeParse(value)
  return result.success ? result.data : undefined
}
const AuthStatus = z.object({
  appId: z.string().regex(/^cli_[A-Za-z0-9]+$/),
  brand: z.enum(['feishu', 'lark']).default('feishu'),
  identities: z.object({ bot: z.object({ status: z.string() }) })
})
const BotInfo = z.object({
  bot: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9]+$/), app_name: z.string().default('') })
})
/**
 * Verify that the configured Feishu CLI is authenticated as a bot and restricted to strict mode `bot`.
 * Workers invoke this CLI as `lark-cli`, so a CLI that also permits a user identity would let workers act as that user.
 */
export async function resolveFeishuBot(
  machine: Machine,
  feishu: unknown,
  probe: Probe,
  path = process.env.PATH ?? ''
): Promise<FeishuBot | undefined> {
  const { cli: name } = FeishuBotSchema.parse(feishu ?? {})
  if (!name) return undefined
  const fail = (error: unknown): never => {
    throw error instanceof SetupError ? error : new SetupError('feishuCliFailed', { output: reason(error) })
  }
  let cli = ''
  try {
    cli = executable(name, path, workerBin(machine.stateDir))
  } catch (error) {
    fail(error)
  }
  const run = (...args: string[]): Promise<string> =>
    probe(['env', 'LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1', 'LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1', cli, ...args]).catch(fail)
  const text = await run('auth', 'status')
  const status = parsed(AuthStatus, text.slice(text.indexOf('{')))
  if (!status) return fail(new SetupError('feishuNoApp'))
  if (status.identities.bot.status !== 'ready')
    fail(new SetupError('feishuBotNotReady', { app: status.appId, status: status.identities.bot.status }))
  const mode = /strict-mode:\s*(\w+)/.exec(await run('config', 'strict-mode'))?.[1]
  if (mode !== 'bot') fail(new SetupError('feishuUserIdentity', { mode: mode ?? 'unknown' }))
  // `--format json` unwraps only `data`, whereas this endpoint returns the payload under `bot`.
  const info = parsed(
    BotInfo,
    (await run('api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot', '--format', 'ndjson')).split('\n')[0] ?? ''
  )
  if (!info) return fail(new SetupError('feishuNoBot'))
  return { cli, appId: status.appId, brand: status.brand, botId: info.bot.open_id, name: info.bot.app_name }
}
