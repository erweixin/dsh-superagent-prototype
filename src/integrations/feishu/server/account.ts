/** Feishu account verification and worker command routing. */
import { z } from 'zod'
import { join } from 'node:path'
import { SetupError } from '../../../setup.ts'
import { executable } from '../../../infra/executable.ts'
import type { Machine, Deployment } from '../../../deployment.ts'
import type { FeishuBot } from '../shared/account.ts'
export type { FeishuBot } from '../shared/account.ts'
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
const workerBin = (stateDir: string) => join(stateDir, 'worker-bin')
export const FeishuBotSchema = z.object({ cli: z.string().trim().default('') })
export const FEISHU_SETUP_FIELDS = ['cli'] as const
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

/** New account map first, with the previous Deployment shape accepted for compatibility. */
export const feishuAccount = (deployment: Partial<Deployment> | undefined): FeishuBot | undefined =>
  (deployment?.accounts?.feishu as FeishuBot | undefined) ?? deployment?.feishu
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
export function feishuWorkerShims(deployment: Deployment): Record<string, string> {
  const bot = feishuAccount(deployment)
  return { 'lark-cli': bot ? `exec ${quote(bot.cli)} "$@"` : 'echo "Feishu bot is not configured" >&2\nexit 1' }
}
