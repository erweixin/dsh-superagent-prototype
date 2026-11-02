/** Session policies, prompt revisions and durable main-session notices. */
import { key, liveTicket, type Ticket } from '../core/index.ts'
import { ticketOfSession, workerSessionId, mandateInstructions } from '../executor/codex.ts'
import type { Agent, AgentRuntime } from './agent-runtime.ts'
import type { Store } from './store.ts'
import type { Prompts } from './prompts.ts'
import type { Effects } from './effects.ts'
import type { Variable } from './execution-environment.ts'
import type { Tool } from './tools/tool.ts'
import { KV } from '../kv.ts'
export interface SessionsHost {
  runtime: AgentRuntime
  store: Store
  prompts: Prompts
  effects: Effects
  masterId: string
  lifetime: AbortSignal
  environment(ticket: Ticket): Variable[]
  tools(agent: Agent, ticket?: Ticket): Tool[]
}
/** Owns the application lifecycle and state for this adapter. */
export class Sessions {
  constructor(private host: SessionsHost) {
    host.effects.handle('relay', ({ text }, id) => this.prompt(host.masterId, id, text, 'steer'), { ordered: true })
    host.effects.handle(
      'notice',
      ({ value, summary }, id) =>
        this.prompt(host.masterId, `notice:${id}:${key(JSON.stringify(value))}`, JSON.stringify(value), {
          inject: summary
        }),
      { ordered: true }
    )
  }
  get runtime() {
    return this.host.runtime
  }
  async ensure(id: string, cwd: string, title: string, role: 'orchestrator' | 'worker') {
    const ticketId = ticketOfSession(id, this.host.store),
      ticket = ticketId ? this.host.store.tickets.get(ticketId) : undefined
    if (role === 'worker' && (!ticket || !liveTicket(ticket) || workerSessionId(ticket) !== id)) throw new Error('Ticket is not authorized')
    const version = this.host.prompts.current(),
      model = role === 'worker' ? this.host.store.settings().executor.model : this.host.store.settings().eval.model
    const instructions =
      this.host.prompts.compose(version.config, role, ticket ? this.host.environment(ticket) : undefined) +
      '\n' +
      (ticket ? mandateInstructions(ticket.mandate) : '') +
      '\n' +
      [...this.host.prompts.skills(version.config)].map(([name, text]) => `Skill ${name}:\n${text}`).join('\n')
    const session = await this.runtime.ensure({
      id,
      cwd,
      title,
      role,
      instructions,
      ...(ticket
        ? { environment: Object.fromEntries(this.host.environment(ticket).map((v) => [v.key, v.value])) }
        : {}),
      ...(model
        ? {
            model: model.model,
            provider: model.provider === 'codex' ? undefined : model.provider,
            effort: model.reasoningEffort
          }
        : {}),
      tools: this.host.tools({ id }, ticket)
    })
    const revisions = this.host.store.get(KV.sessions.prompts(id)) ?? []
    if (revisions.at(-1) !== version.revision)
      this.host.store.set(KV.sessions.prompts(id), [...revisions, version.revision])
    return session
  }
  async prompt(
    id: string,
    requestId: string,
    text: string,
    mode: 'queue' | 'steer' | { inject: string },
    authorize?: () => void,
    accepted?: () => void
  ) {
    this.host.lifetime.throwIfAborted()
    const session = this.runtime.get(id)
    if (session) await this.ensure(id, session.cwd, session.title, session.role)
    authorize?.()
    accepted?.()
    await this.runtime.send(id, requestId, text, typeof mode === 'object')
  }
  async holds(id: string, requestId: string) {
    return this.runtime.get(id)?.deliveries[requestId] === 'sent'
  }
  promptedId(id: string) {
    return id
  }
  relay(id: string, text: string) {
    this.host.effects.enqueue('relay', id, { text })
  }
  notify(name: string, value: Record<string, unknown>, summary: string) {
    this.host.effects.enqueue('notice', name, { value, summary })
  }
  async delivery(name: string): Promise<'pending' | 'injected'> {
    await this.host.effects.idle('notice')
    return this.host.effects.pending('notice', name) ? 'pending' : 'injected'
  }
  status() {
    return {
      revision: this.host.prompts.current().revision,
      sessions: this.runtime.list().map((s) => ({ sessionId: s.id, revision: this.promptVersion(s.id).revision })),
      notificationPending: this.host.effects.pending('notice', 'prompts')
    }
  }
  promptVersion(id: string) {
    const revision = this.host.store.get(KV.sessions.prompts(id))?.at(-1)
    return revision === undefined ? this.host.prompts.current() : this.host.prompts.version(revision)
  }
  mayRead(id: string, revision: number) {
    return (
      revision === this.promptVersion(id).revision ||
      (this.host.store.get(KV.sessions.prompts(id)) ?? []).includes(revision)
    )
  }
  modelRetry(_id: string | undefined) {
    return {}
  }
}
