/** Standalone composition entry. No host application or repository is required. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath, readdir, stat } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute, extname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Runtime } from './app/runtime.ts'
import { FeishuBotSetup } from './app/feishu-setup.ts'
import { machineOf } from './deployment.ts'
import { managementHandler, sameOrigin } from './app/http.ts'
import { panelTrigger, panelReplies } from './sources/panel.ts'
import { packagePath } from './infra/paths.ts'
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
async function body(req: IncomingMessage) {
  const parts: Buffer[] = []
  let size = 0
  for await (const part of req) {
    const bytes = Buffer.from(part)
    size += bytes.length
    if (size > 131072) throw new Error('Request too large')
    parts.push(bytes)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as Record<string, unknown>
}
/** Resolves a regular artifact beneath its ticket directory, rejecting symlink escapes. */
export async function artifactPath(directory: string, path: string) {
  const base = await realpath(directory),
    file = await realpath(resolve(base, path))
  const rel = relative(base, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !(await stat(file)).isFile())
    throw new Error('Artifact is outside the task directory')
  return file
}
export async function startApplication(configPath = resolve('superagent.config.json')) {
  let input: Record<string, unknown> = {}
  try {
    input = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const machine = machineOf({ stateDir: join(homedir(), '.feishu-superagent'), ...input })
  const feishuSetup = new FeishuBotSetup()
  let runtime: Runtime
  let restarting: Promise<void> | undefined
  const restart = () => {
    if (restarting) return
    restarting = (async () => {
      await runtime.stop()
      runtime = new Runtime(machine, restart)
      await runtime.ready
    })()
      .catch((e) => console.error('Restart failed:', e))
      .finally(() => {
        restarting = undefined
      })
  }
  runtime = new Runtime(machine, restart)
  let devServer: import('vite').ViteDevServer | undefined
  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port,
      url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname.startsWith('/orchestrator/api/')) {
        if (restarting) {
          json(res, 503, { error: 'Service restarting' })
          return
        }
        if (!sameOrigin(req, port)) {
          json(res, 403, { error: 'Same-origin request required' })
          return
        }
        const path = url.pathname.slice('/orchestrator/api/'.length),
          agents = runtime.sessions.runtime
        if (path === 'setup/feishu' && req.method === 'POST') {
          let input: unknown
          try { input = await body(req) } catch { throw new Error('Invalid bot setup request body') }
          json(res, 200, await feishuSetup.configure(runtime, input))
          return
        }
        if (path === 'sessions' && req.method === 'GET') {
          json(res, 200, {
            masterId: runtime.masterId,
            sessions: agents.list(),
            approvals: agents.approvals(),
            replies: runtime.store.get(panelReplies) ?? []
          })
          return
        }
        if (path === 'session/message' && req.method === 'POST') {
          const b = await body(req)
          if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 20000)
            throw new Error('A nonempty message up to 20000 characters is required')
          const id = typeof b.sessionId === 'string' ? b.sessionId : runtime.masterId
          if (id === runtime.masterId) {
            const trigger = panelTrigger(b.text)
            runtime.receive(trigger)
          } else {
            const ticket = runtime.store.tickets.get(id.replace(/^worker-/, ''))
            if (!id.startsWith('worker-') || !ticket) throw new Error('Unknown ticket')
            if (ticket.ended?.by === 'human') throw new Error('Ticket was stopped; no further input is authorized')
            const trigger = panelTrigger(b.text, `worker-${ticket.id}`)
            runtime.store.atomic(() => {
              runtime.receive(trigger)
              runtime.engine.attach(ticket.id, trigger.id)
            })
            runtime.pump().catch(console.error)
          }
          json(res, 200, { accepted: true })
          return
        }
        if (path === 'approval' && req.method === 'POST') {
          const b = await body(req)
          if (typeof b.id !== 'string' || typeof b.accept !== 'boolean') throw new Error('Invalid approval')
          await agents.approve(b.id, b.accept)
          json(res, 200, { saved: true })
          return
        }
        if (path === 'artifacts' && req.method === 'GET') {
          const t = runtime.store.tickets.get(url.searchParams.get('ticket') ?? '')
          if (!t?.execution) throw new Error('Unknown ticket')
          const entries = await readdir(t.execution.directory, { recursive: true, withFileTypes: true })
          const files = []
          for (const e of entries) {
            if (e.isFile()) {
              const rel = relative(t.execution.directory, join(e.parentPath, e.name))
              try {
                await artifactPath(t.execution.directory, rel)
                files.push(rel)
              } catch {}
            }
          }
          json(res, 200, { files })
          return
        }
        if (path === 'artifact' && req.method === 'GET') {
          const t = runtime.store.tickets.get(url.searchParams.get('ticket') ?? '')
          if (!t?.execution) throw new Error('Unknown ticket')
          const file = await artifactPath(t.execution.directory, url.searchParams.get('path') ?? '')
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.split('/').at(-1)!)}`,
            'x-content-type-options': 'nosniff'
          })
          res.end(await readFile(file))
          return
        }
        await managementHandler(port, runtime.httpHost())(req, res)
        return
      }
      if (devServer) {
        devServer.middlewares(req, res, () => {
          res.writeHead(404)
          res.end()
        })
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      const dist = packagePath('dist'),
        requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
      let file: string
      try {
        file = await artifactPath(dist, requested)
      } catch {
        file = join(dist, 'index.html')
      }
      const data = await readFile(file).catch(() =>
        Buffer.from('Build the web panel with npm run build, then restart.')
      )
      res.writeHead(200, {
        'content-type':
          (
            { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<
              string,
              string
            >
          )[extname(file)] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff'
      })
      res.end(data)
    } catch (e) {
      if (!res.headersSent) json(res, 400, { error: e instanceof Error ? e.message : String(e) })
      else res.end()
    }
  })
  try {
    if (process.env.SUPERAGENT_DEV === '1') {
      const { createServer } = await import('vite')
      devServer = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' })
    }
    await new Promise<void>((ok, fail) => {
      server.once('error', fail)
      server.listen(machine.port, '127.0.0.1', ok)
    })
  } catch (error) {
    await devServer?.close()
    await runtime.stop()
    throw error
  }
  const port = (server.address() as { port: number }).port
  console.log(`Feishu Superagent: http://127.0.0.1:${port}`)
  runtime.ready.catch((e) => console.error('Startup failed:', String(e)))
  return {
    server,
    get runtime() {
      return runtime
    },
    async stop() {
      await devServer?.close()
      const closed = new Promise<void>((ok) => server.close(() => ok()))
      await restarting
      await runtime.stop()
      await closed
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await startApplication(process.argv[2])
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (!stopping) {
        stopping = true
        void app.stop().then(() => process.exit(0))
      }
    })
}
