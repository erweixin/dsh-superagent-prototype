#!/usr/bin/env node
// No network or keychain: exercises the CLI subprocess contract with fake credentials.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2),
  directory = process.env.LARKSUITE_CLI_CONFIG_DIR
const file = join(directory, 'fixture-config.json')
let config = {}
try {
  config = JSON.parse(readFileSync(file, 'utf8'))
} catch {}
if (process.env.LARK_SETUP_TEST_LOG)
  appendFileSync(
    process.env.LARK_SETUP_TEST_LOG,
    JSON.stringify({
      args,
      directory,
      inheritedUser: !!process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN,
      appId: process.env.LARKSUITE_CLI_APP_ID,
      brand: process.env.LARKSUITE_CLI_BRAND
    }) + '\n'
  )
const save = () => writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
const print = (value) => console.log(JSON.stringify(value))
if (args[0] === 'api') {
  // Match the real token provider: environment credentials alone are insufficient.
  let account
  try {
    account = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).apps[0]
  } catch {}
  const secret = account?.appSecret ?? config.secret
  if (secret === 'delay') await new Promise((resolve) => setTimeout(resolve, 10000))
  if (secret !== 'fixture-secret') {
    console.error(
      JSON.stringify({
        ok: false,
        error: {
          type: 'config',
          subtype: 'invalid_client',
          code: 20048,
          message: `invalid secret: ${secret}`,
          hint: `secret=${secret}`
        }
      })
    )
    process.exit(1)
  }
  print({ bot: { open_id: 'ou_fixture', app_name: 'Fixture bot' } })
} else if (args[0] === 'config' && args[1] === 'init') {
  const secret = readFileSync(0, 'utf8').trim()
  if (!args.includes('--app-secret-stdin') || secret !== 'fixture-secret') process.exit(2)
  config = { appId: args[args.indexOf('--app-id') + 1], brand: args[args.indexOf('--brand') + 1], secret }
  save()
  print({ appId: config.appId, appSecret: '****', brand: config.brand })
} else if (args[0] === 'config' && args[1] === 'strict-mode') {
  if (args[2]) {
    config.mode = args[2]
    save()
  }
  console.log(`strict-mode: ${config.mode}`)
} else if (args[0] === 'auth' && args[1] === 'status') {
  print({
    appId: config.appId,
    brand: config.brand,
    identities: { bot: { status: config.secret ? 'ready' : 'missing' } }
  })
} else process.exit(2)
