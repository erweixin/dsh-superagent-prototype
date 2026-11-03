/** Local-operator onboarding. Credentials never enter Store, prompts, or settings history. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import { executable } from '../../../infra/executable.ts'
import { resolveFeishuBot } from './account.ts'
import type { SourceSetupHost } from '../../../sources/server.ts'
import { workerBin } from '../../../infra/environment.ts'

import type { FeishuBotSetupResult } from '../shared/contracts.ts'

const Request = z
  .object({
    action: z.enum(['check', 'save']),
    cli: z.string().trim().min(1).max(4096),
    appId: z.string().regex(/^cli_[a-zA-Z0-9]+$/),
    appSecret: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .regex(/^[^\s\x00-\x1f\x7f]+$/),
    brand: z.enum(['feishu', 'lark']).default('feishu')
  })
  .strict()
export type { FeishuBotSetupRequest, FeishuBotSetupResult } from '../shared/contracts.ts'
// Ignore inherited identity/profile overrides so this application's bot cannot accidentally use personal credentials.
const isolatedVariables = [
  'LARKSUITE_CLI_APP_ID',
  'LARKSUITE_CLI_APP_SECRET',
  'LARKSUITE_CLI_BRAND',
  'LARKSUITE_CLI_USER_ACCESS_TOKEN',
  'LARKSUITE_CLI_TENANT_ACCESS_TOKEN',
  'LARKSUITE_CLI_TENANT_ACCESS_TOKEN_SOURCE',
  'LARKSUITE_CLI_PROFILE',
  'LARKSUITE_CLI_DEFAULT_AS',
  'LARKSUITE_CLI_STRICT_MODE',
  'LARKSUITE_CLI_AUTH_PROXY',
  'LARKSUITE_CLI_PROXY_KEY',
  'LARKSUITE_CLI_CONFIG_DIR',
  'OPENCLAW_CLI',
  'OPENCLAW_HOME',
  'OPENCLAW_STATE_DIR',
  'OPENCLAW_CONFIG_PATH',
  'OPENCLAW_SERVICE_MARKER',
  'OPENCLAW_SERVICE_VERSION',
  'OPENCLAW_GATEWAY_PORT',
  'OPENCLAW_SHELL',
  'HERMES_HOME',
  'HERMES_QUIET',
  'HERMES_EXEC_ASK',
  'HERMES_GATEWAY_TOKEN',
  'HERMES_SESSION_KEY',
  'LARK_CHANNEL'
]
const quoted = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"
function environment(directory: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of isolatedVariables) delete env[key]
  return {
    ...env,
    LARKSUITE_CLI_CONFIG_DIR: directory,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1'
  }
}
/** Only return known categories and numeric codes; raw CLI output may contain credentials. */
function failureDetail(stderr: string): string {
  let detail: { type?: unknown; subtype?: unknown; code?: unknown } = {}
  try {
    detail = JSON.parse(stderr.slice(stderr.indexOf('{'), stderr.lastIndexOf('}') + 1)).error ?? {}
  } catch {}
  const hints: Record<string, string> = {
    invalid_client: '应用凭据被拒绝：请核对 App ID、App Secret 和飞书/Lark 平台。',
    token_missing: 'CLI 未能取得机器人 token，请检查机器人账户配置。',
    missing_scope: '机器人缺少接口权限，请在飞书开放平台检查应用权限。',
    rate_limit: '飞书请求频率受限，请稍后重试。'
  }
  const types: Record<string, string> = {
    network: '网络连接失败，请检查服务进程的代理、DNS 和 TLS 配置。',
    authentication: '机器人认证失败，请检查应用凭据和 CLI 账户配置。',
    authorization: '机器人无权调用接口，请检查应用权限和机器人能力。',
    config: 'CLI 账户配置无效，请检查应用凭据与平台。',
    validation: 'CLI 参数或配置校验失败，请检查 CLI 版本。'
  }
  const subtype =
    typeof detail.subtype === 'string' && Object.hasOwn(hints, detail.subtype) ? detail.subtype : ''
  const type = typeof detail.type === 'string' && Object.hasOwn(types, detail.type) ? detail.type : ''
  const code =
    typeof detail.code === 'number' && Number.isSafeInteger(detail.code) ? `; code=${detail.code}` : ''
  return `${subtype || type || 'unknown'}${code}: ${hints[subtype] ?? types[type] ?? 'CLI 执行失败；请检查 CLI 版本、网络和机器人配置。'}`
}
/** Discard raw CLI diagnostics after extracting a safe failure category. */
function run(
  file: string,
  args: string[],
  directory: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  secret?: string
) {
  signal.throwIfAborted()
  return new Promise<string>((resolve, reject) => {
    let failed = false,
      output = '',
      diagnostics = '',
      exit: number | undefined,
      stopped = '',
      killer: ReturnType<typeof setTimeout> | undefined
    const child = execFile(
      file,
      args,
      { cwd: directory, env, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        failed ||= !!error
        exit = typeof error?.code === 'number' ? error.code : undefined
        diagnostics = stderr
        output = stdout
      }
    )
    const terminate = () => {
      failed = true
      stopped = signal.aborted
        ? 'cancelled: 服务正在关闭或重启，请稍后重试。'
        : 'timeout: CLI 超过 45 秒未完成，请检查网络或系统凭据存储提示。'
      child.kill('SIGTERM')
      killer ??= setTimeout(() => child.kill('SIGKILL'), 2000)
    }
    const timeout = setTimeout(terminate, 45000)
    signal.addEventListener('abort', terminate, { once: true })
    // Wait for exit even after cancellation so cleanup cannot race a still-writing CLI.
    child.once('close', () => {
      clearTimeout(timeout)
      clearTimeout(killer)
      signal.removeEventListener('abort', terminate)
      if (failed)
        reject(
          new Error(
            `Feishu CLI check failed (${args.includes('/open-apis/bot/v3/info') ? 'bot-info' : args.includes('init') ? 'config-init' : 'verify-config'}${exit === undefined ? '' : `; exit=${exit}`}): ${stopped || failureDetail(diagnostics)}`
          )
        )
      else resolve(output)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(secret === undefined ? undefined : secret + '\n')
    if (signal.aborted) terminate()
  })
}
function inside(root: string, path: string) {
  const part = relative(root, path)
  return !part || (!part.startsWith('..') && !isAbsolute(part))
}
/** Serializes local-operator bot setup and activates only verified, isolated CLI configurations. */
export class FeishuBotSetup {
  private busy = false
  async configure(host: SourceSetupHost, value: unknown): Promise<FeishuBotSetupResult> {
    const parsed = Request.safeParse(value)
    if (!parsed.success) throw new Error('Enter a valid CLI path, App ID, App Secret and platform.')
    if (this.busy) throw new Error('Another bot setup is in progress. Wait for it to finish.')
    const input = parsed.data
    let cli: string
    try {
      cli = executable(input.cli, process.env.PATH ?? '', workerBin(host.machine.stateDir))
    } catch {
      throw new Error('Cannot find the lark-cli executable. Install it or enter its absolute path.')
    }
    const root = join(host.machine.stateDir, 'feishu-bots')
    if (inside(root, cli) || inside(workerBin(host.machine.stateDir), cli))
      throw new Error('Use the original lark-cli executable, not the generated bot wrapper.')
    this.busy = true
    let directory: string | undefined,
      keep = false
    try {
      host.lifetime.throwIfAborted()
      const block = host.settings.block('source:feishu')
      await mkdir(root, { recursive: true, mode: 0o700 })
      directory = await mkdtemp(join(root, 'bot-'))
      const env = environment(directory)
      // CLI 1.0.98 resolves bot tokens through its file-backed account provider, even when
      // environment credentials are supplied. Verify in a disposable private configuration
      // before config init can update a shared OS keychain entry for this App ID.
      const probeDirectory = await mkdtemp(join(directory, 'check-'))
      let info: string
      try {
        await writeFile(
          join(probeDirectory, 'config.json'),
          JSON.stringify({
            currentApp: input.appId,
            apps: [{ appId: input.appId, appSecret: input.appSecret, brand: input.brand, strictMode: 'bot' }]
          }),
          { mode: 0o600, flag: 'wx' }
        )
        info = await run(
          cli,
          ['api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot', '--format', 'ndjson'],
          probeDirectory,
          host.lifetime,
          environment(probeDirectory)
        )
      } finally {
        await rm(probeDirectory, { recursive: true, force: true })
      }
      let remote: unknown
      try {
        remote = JSON.parse(info.split('\n')[0] ?? '')
      } catch {
        throw new Error('The CLI returned an unreadable bot response.')
      }
      const response = z
        .object({
          bot: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9]+$/), app_name: z.string().default('') })
        })
        .safeParse(remote)
      if (!response.success)
        throw new Error(
          'Bot verification failed. Enable the application bot capability and check its credentials.'
        )
      const bot: FeishuBotSetupResult['bot'] = {
        appId: input.appId,
        brand: input.brand,
        botId: response.data.bot.open_id,
        name: response.data.bot.app_name
      }
      if (input.action === 'check') return { bot, saved: false, restarting: false }
      await run(
        cli,
        ['config', 'init', '--app-id', input.appId, '--app-secret-stdin', '--brand', input.brand],
        directory,
        host.lifetime,
        env,
        input.appSecret
      )
      await run(cli, ['config', 'strict-mode', 'bot'], directory, host.lifetime, env)
      const wrapper = join(directory, 'lark-cli')
      await writeFile(
        wrapper,
        `#!/bin/sh\n# Generated by feishu-superagent: isolated bot identity\nunset ${isolatedVariables.join(' ')}\nexport LARKSUITE_CLI_CONFIG_DIR=${quoted(directory)}\nexport LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1\nexec ${quoted(cli)} "$@"\n`,
        { mode: 0o700, flag: 'wx' }
      )
      const resolved = await resolveFeishuBot(host.machine, { cli: wrapper }, (argv) =>
        run(argv[0]!, argv.slice(1), directory!, host.lifetime, env)
      )
      if (
        !resolved ||
        resolved.appId !== input.appId ||
        resolved.botId !== bot.botId ||
        resolved.brand !== input.brand
      )
        throw new Error('The saved CLI identity does not match the verified bot.')
      host.lifetime.throwIfAborted()
      const current = block.value as { enabled: boolean; config: Record<string, unknown> }
      const saved = await host.settings.save(
        'source:feishu',
        { enabled: true, config: { ...current.config, cli: wrapper } },
        block.revision,
        'panel'
      )
      keep = true
      return { bot, saved: true, restarting: saved.restarting }
    } catch (error) {
      // Never reflect an untrusted executable's output, nor Zod input values, into API responses or logs.
      const message = error instanceof Error ? error.message : 'Bot setup failed'
      throw new Error(
        message.includes(input.appSecret)
          ? 'Bot setup failed. Check the supplied credentials and CLI configuration.'
          : message
      )
    } finally {
      try {
        if (directory && !keep) await rm(directory, { recursive: true, force: true })
      } finally {
        this.busy = false
      }
    }
  }
}
