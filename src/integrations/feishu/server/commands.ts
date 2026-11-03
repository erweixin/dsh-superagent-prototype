/** Bot-only CLI invocation and Feishu error translation. */
import { CliError, type Commands } from '../../../infra/commands.ts'
import { feishuAccount } from './account.ts'

/** Rewrites Feishu error 232011 (bot not in chat) with remediation instructions. */
function membership(error: unknown): unknown {
  if (!(error instanceof CliError) || error.code !== 232011) return error
  const hint = 'The Feishu bot is not a member of the chat. Add the bot in the chat settings, then retry.'
  return new CliError(hint, error.code, error.exitCode)
}
export async function runFeishuCommand<T>(commands: Pick<Commands, 'deployment' | 'run'>, args: string[], cwd?: string): Promise<T> {
  const bot = feishuAccount(commands.deployment)
  if (!bot) throw new Error('The Feishu Source has no working bot CLI')
  const output = await commands.run(bot.cli, [...args, '--as', 'bot', '--format', 'json'], cwd, { LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' })
    .catch((error: unknown) => { throw membership(error) })
  const result = JSON.parse(output) as { ok: boolean; data: T; error?: { code?: number; message?: string } }
  const code = result.error?.code
  if (!result.ok) throw membership(new CliError(`${result.error?.message ?? 'Feishu command failed'}${code ? ` (${code})` : ''}`, code))
  return result.data
}
