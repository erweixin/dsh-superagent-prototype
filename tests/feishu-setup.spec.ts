import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { FeishuBotSetup } from '../src/app/feishu-setup.ts'
import { machineOf, resolveFeishuBot } from '../src/deployment.ts'
import { execFileSync } from 'node:child_process'

let root = ''
afterEach(() => {
  vi.unstubAllEnvs()
  if (root) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  root = mkdtempSync(join(tmpdir(), "feishu-setup-'quoted-"))
  const controller = new AbortController()
  const save = vi.fn(async () => ({
    saved: true,
    revision: 2,
    policy_changed: false,
    restarting: true,
    context_delivery: 'pending' as const
  }))
  const settings = {
    block: () => ({
      block: 'source:feishu',
      revision: 1,
      value: { enabled: false, config: { cli: '', directMessages: true, otherChats: 'none' } }
    }),
    save
  }
  const host = { machine: machineOf({ stateDir: root }), lifetime: controller.signal, settings }
  const request = {
    action: 'save',
    cli: resolve('tests/fixtures/lark-setup.mjs'),
    appId: 'cli_fixture',
    appSecret: 'fixture-secret',
    brand: 'feishu'
  }
  vi.stubEnv('LARK_SETUP_TEST_LOG', join(root, 'calls.jsonl'))
  return { host, request, save, manager: new FeishuBotSetup(), controller }
}
it('checks transient credentials without saving config or changing business settings', async () => {
  const { manager, host, request, save } = fixture()
  const result = await manager.configure(host, { ...request, action: 'check' })
  expect(result).toMatchObject({
    saved: false,
    restarting: false,
    bot: { appId: 'cli_fixture', botId: 'ou_fixture' }
  })
  expect(save).not.toHaveBeenCalled()
  expect(readdirSync(join(root, 'feishu-bots'))).toEqual([])
  expect(readFileSync(join(root, 'calls.jsonl'), 'utf8')).not.toContain(request.appSecret)
})
it('stores only an isolated CLI path, preserves source scope, uses stdin and ignores inherited identities', async () => {
  const { manager, host, request, save } = fixture()
  vi.stubEnv('LARKSUITE_CLI_USER_ACCESS_TOKEN', 'personal-token')
  vi.stubEnv('LARKSUITE_CLI_BRAND', 'lark')
  vi.stubEnv('LARKSUITE_CLI_APP_ID', 'cli_other')
  const result = await manager.configure(host, request)
  expect(result.saved).toBe(true)
  expect(JSON.stringify(result)).not.toContain(request.appSecret)
  expect(save).toHaveBeenCalledWith(
    'source:feishu',
    {
      enabled: true,
      config: {
        cli: expect.any(String),
        directMessages: true,
        otherChats: 'none'
      }
    },
    1,
    'panel'
  )
  const saved = (save.mock.calls as unknown[][])[0]![1] as { config: { cli: string } }
  expect(JSON.stringify(save.mock.calls)).not.toContain(request.appSecret)
  expect(readFileSync(saved.config.cli, 'utf8')).not.toContain(request.appSecret)
  expect(statSync(saved.config.cli).mode & 0o777).toBe(0o700)
  const bot = await resolveFeishuBot(host.machine, saved.config, async (args) =>
    execFileSync(args[0]!, args.slice(1), { encoding: 'utf8' })
  )
  expect(bot).toMatchObject(result.bot)
  const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8')
  expect(calls).toContain('--app-secret-stdin')
  expect(calls).not.toContain(request.appSecret)
  expect(calls).not.toContain('personal-token')
  expect(calls).not.toContain('cli_other')
  expect(calls).not.toContain('"inheritedUser":true')
  await expect(manager.configure(host, { ...request, cli: saved.config.cli })).rejects.toThrow(
    'original lark-cli'
  )
})
it('redacts failing CLI output and removes staging files', async () => {
  const { manager, host, request, save } = fixture()
  const error = await manager
    .configure(host, { ...request, appSecret: 'do-not-echo-this' })
    .catch((e: Error) => e)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('bot-info; exit=1')
  expect((error as Error).message).toContain('invalid_client; code=20048')
  expect((error as Error).message).not.toContain('do-not-echo-this')
  expect(save).not.toHaveBeenCalled()
  expect(readdirSync(join(root, 'feishu-bots'))).toEqual([])
})
it('does not activate or retain an uncommitted configuration when settings change during setup', async () => {
  const { manager, host, request, save } = fixture()
  save.mockRejectedValueOnce(new Error('Settings changed. Reload before saving.'))
  await expect(manager.configure(host, request)).rejects.toThrow('Settings changed')
  expect(readdirSync(join(root, 'feishu-bots'))).toEqual([])
})
it('serializes configuration and aborts its child process when the runtime shuts down', async () => {
  const { manager, host, request, save, controller } = fixture()
  const pending = manager.configure(host, { ...request, appSecret: 'delay' })
  const rejected = expect(pending).rejects.toThrow('Feishu CLI check failed')
  await expect(manager.configure(host, request)).rejects.toThrow('in progress')
  await new Promise((resolve) => setTimeout(resolve, 80))
  controller.abort()
  await rejected
  expect(save).not.toHaveBeenCalled()
  expect(readdirSync(join(root, 'feishu-bots'))).toEqual([])
})
it('rejects malformed requests without reflecting their contents', async () => {
  const { manager, host, request } = fixture()
  await expect(manager.configure(host, { ...request, appId: 'sensitive-invalid-value' })).rejects.toThrow(
    'Enter a valid'
  )
})
