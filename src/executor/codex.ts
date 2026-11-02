import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { key, threadKey, latestAssignment, liveTicket, runningAssignment, waitsForPerson } from '../core/index.ts'
import type {
  Execution,
  PolicyEffect,
  AssessmentOutcome,
  Assignment,
  Executor,
  EngineForExecutor,
  Mandate,
  Ticket,
  TicketInput,
  Trigger
} from '../core/index.ts'
import type { Settings } from '../policy.ts'
import type { Store } from '../app/store.ts'
import type { Sessions } from '../app/sessions.ts'
import { Later, type Effects } from '../app/effects.ts'
import { executionRoot } from '../app/execution-environment.ts'
import { TaskNameSchema } from '../app/assessment.ts'
import { resultRelay } from '../app/notices.ts'
export const workerSessionId = (id: string) => `worker-${id}`
export const ticketOfSession = (id: string) => (id.startsWith('worker-') ? id.slice(7) : undefined)
const ticketDirectoryName = (name: string, id: string) => `${TaskNameSchema.parse(name)}-${id.slice(0, 12)}`
interface ExecutorHost {
  store: Store
  engine: EngineForExecutor
  effects: Effects
  sessions: Sessions
  machine: { stateDir: string }
  lifetime: AbortSignal
  paused(): boolean
  closing(): boolean
  environment(ticket: Ticket): { key: string; value: string }[]
  sourceLink(t: Trigger): Promise<{ source_url?: string; source_url_read?: string }>
  repliedTo(t: Trigger): Trigger | undefined
}
/** Looks up a ticket's origin trigger in Store. */
export const sourceTrigger = (host: { store: Pick<Store, 'triggers'> }, ticket: Ticket): Trigger | undefined =>
  host.store.triggers.get(ticket.origin.triggerId)

/**
 * Returns additional system-prompt mandate instructions for a worker beyond the request: for work accepted proactively under
 * rules (`strength === 'inferred'`), restricts authorization to small internal changes within the rule scope; returns `''` for explicit requests.
 */
export function mandateInstructions(mandate: Pick<Mandate, 'strength'>): string {
  return mandate.strength === 'inferred'
    ? 'This ticket has limited proactive authorization. Independently verify that the work stays ' +
        'within the accepted task scope and bounded impact. If it requires additional publication, destructive changes, external commitments, product ' +
        'decisions or clarification, stop and report dropped; do not expand scope.'
    : ''
}
/** Builds a newly accepted ticket's Execution metadata: its worktree name, workspace directory, and assignment text. */
export function ticketExecution(
  ticket: Ticket,
  outcome: Extract<AssessmentOutcome, { kind: 'accept' }>,
  settings: Settings,
  stateDir: string
): Execution {
  const name = ticketDirectoryName(outcome.name ?? '', ticket.id)
  const source = ticket.origin.triggerId
  const note = outcome.note ? `\nRouting note (not the source request): ${outcome.note}` : ''
  const ruleIds = ticket.mandate.basis.rules
  const rules = settings.policy.rules
    .filter((rule) => ruleIds?.includes(rule.id))
    .map((rule) => `\n- ${rule.name} (${rule.id}): ${rule.instruction}`)
    .join('')
  const precedence = rules
    ? `\nMatched rules; their procedure and communication instructions take precedence over the default acknowledgement and messaging policy for this ticket:${rules}`
    : ''
  // The origin trigger is delivered alongside the assignment, so `assignment` omits the trigger text.
  const assignment =
    ticket.mandate.strength === 'inferred' && ruleIds
      ? `Proactively accepted under ${ruleIds.join(', ')}. Scope: ${outcome.scope}.${precedence}${note}`
      : note.trim()
  return { name, directory: join(executionRoot(settings, stateDir), name), assignment }
}
/** Character limits for inline assignment and trigger text in worker messages; longer text is read via its resource. */
const ASSIGNMENT_CHARS = 1500,
  TRIGGER_CHARS = 600
/** Returns `text` up to `limit` characters, or a truncated preview with total character count and the resource path to read the full text. */
const capped = (text: string, limit: number, read: string) =>
  text.length <= limit ? { text } : { text: `${text.slice(0, limit)}…`, chars: text.length, read }
/**
 * Formats a Trigger for worker delivery: author, thread, timestamp, text up to `TRIGGER_CHARS`, source message link,
 * optional routing note, and a preview of the replied-to message when the worker has not yet seen it.
 */
export function triggerMessage(
  trigger: Trigger,
  link: { source_url?: string; source_url_read?: string },
  note?: string,
  repliesTo?: Trigger
) {
  return {
    trigger_id: trigger.id,
    from: trigger.actor.id,
    thread: threadKey(trigger.threads[0]!),
    at: trigger.at,
    ...capped(trigger.text, TRIGGER_CHARS, `trigger/${trigger.id}`),
    ...link,
    ...(note ? { routing_note: note } : {}),
    ...(repliesTo
      ? { replies_to: { trigger_id: repliesTo.id, preview: repliesTo.text.replace(/\s+/g, ' ').slice(0, 160) } }
      : {})
  }
}
/** Formats a peer trigger from the ticket's acceptance batch with author, timestamp, 160-character preview, and read resource path. */
export const batchLine = (trigger: Trigger) => ({
  trigger_id: trigger.id,
  from: trigger.actor.id,
  at: trigger.at,
  preview: trigger.text.replace(/\s+/g, ' ').slice(0, 160),
  read: `trigger/${trigger.id}`
})
/** Returns the other triggers in a ticket's origin batch (excluding the primary `origin.triggerId`), oldest first. */
export const batchOf = (host: { store: Pick<Store, 'triggers'> }, ticket: Ticket): Trigger[] =>
  ticket.origin.triggerIds
    .filter((id) => id !== ticket.origin.triggerId)
    .flatMap((id) => host.store.triggers.get(id) ?? [])
const RESUMED =
  'This ticket ended earlier and the message that follows, on its thread, resumed it under the same mandate. If it asks for ' +
  'more within the original scope, inspect the task directory and saved execution history and continue; if it asks for work beyond that scope or ' +
  'for another ticket, hand it back with orchestrator_trigger_handback and report dropped; if it needs nothing, such as thanks, ' +
  'report dropped without a message. Report ready when the follow-up is done. Do not repeat completed work.'
const RETRIED =
  'A person retried this ticket. Continue the assignment from the current task directory and saved execution history.'
/** Formats a policy-change input for the worker; inputs recorded before `effect` existed fall back to a general notice. */
function policyMessage(effect?: PolicyEffect): string {
  if (!effect)
    return 'Policy change: the access or admission rules changed. Check that the remaining work stays within the assignment.'
  return [
    'Policy change:',
    ...(effect.rules ?? []).map((rule) =>
      rule.change === 'disabled'
        ? `Rule ${rule.name} (${rule.id}), which this ticket was accepted under, no longer applies: finish only a change within it, or report dropped.`
        : `Rule ${rule.name} (${rule.id}), which this ticket was accepted under, changed. Keep the remaining work within it as it reads now: ${rule.instruction}`
    ),
    ...(effect.proactive === false
      ? [
          'Work inferred from a rule is no longer accepted, as the accept mode is no longer auto: finish only ' +
            'what is in progress within the assignment, or report dropped, and take on nothing new.'
        ]
      : []),
    ...(effect.requesterAllowed === false
      ? [
          `The sender this ticket is for, ${
            effect.requester ? `${effect.requester.id} on ${effect.requester.source}` : 'who ' + 'asked for it'
          }, may no longer start work here: finish the assignment within its scope, and take no new requests from them on it.`
        ]
      : [])
  ].join('\n')
}
/** Resource path under which a worker session reads the full text of a ticket input. */
export const inputResource = (ticketId: string, inputId: string): string => `ticket/${ticketId}/input/${key(inputId)}`
/**
 * Formats a ticket input for worker delivery: a `trigger` rendered via `trigger` (or by its ID and read path when absent),
 * a `policy-changed` notice, a `resumed` notice, an orchestrator `note`, or a `text` input as written.
 * Returns `undefined` for legacy `reopen` inputs, which are historical only because the schema 11 migration converted pending reopen inputs into text inputs.
 */
export function inputMessage(input: TicketInput, trigger?: object): string | undefined {
  // Mark triggers arriving on context-only subscriptions so the worker knows they are not addressed to the ticket.
  if (input.kind === 'trigger')
    return JSON.stringify({
      ...(trigger ?? { trigger_id: input.triggerId, read: `trigger/${input.triggerId}` }),
      ...(input.context ? { context: true } : {})
    })
  if (input.kind === 'policy-changed') return policyMessage(input.effect)
  if (input.kind === 'resumed') return RESUMED
  if (input.kind === 'note') return `Note from the orchestrator, for context only: ${input.text}`
  return input.kind === 'text' ? input.text : undefined
}
/**
 * Tracks active and starting worker sessions against the configured concurrency limit: a ticket holds a slot while its
 * worker's turn runs, while its shell jobs or subagents run after that turn ended, and while a launch or wake starts that worker.
 * CodexExecutor reserves slots synchronously before awaiting launch or wake work so two starts cannot take the last slot,
 * and allows one extra slot beyond the limit for human follow-ups (`by === 'person'`) so they never wait behind new launches.
 */
/** Owns the application lifecycle and state for this adapter. */
export class WorkerSlots {
  /** Tickets currently holding a startup slot, mapped to whether the start is a launch, a wake, or a wake for a person's message. */
  private readonly starting = new Map<string, 'launch' | 'wake' | 'person'>()
  /**
   * @param running - Returns the ticket IDs whose worker holds a slot (see `CodexExecutor.running`).
   * @param max - Returns the configured maximum number of concurrent worker slots.
   */
  constructor(
    private readonly running: () => string[],
    private readonly max: () => number
  ) {}
  /** Number of slots currently in use across running workers and starting reservations. */
  used(): number {
    return new Set([...this.running(), ...this.starting.keys()]).size
  }
  /** How many launches may run concurrently: the slots not held by a running worker or a wake reservation. */
  launches(): number {
    const wakes = [...this.starting].flatMap(([ticketId, by]) => (by !== 'launch' ? [ticketId] : []))
    return this.max() - new Set([...this.running(), ...wakes]).size
  }
  /**
   * Reserves a startup slot for `ticketId`; idempotent if `ticketId` already holds a starting slot.
   * A wake for a person's message (`by === 'person'`) may use one extra slot beyond `max()`.
   * Call `free(ticketId)` once the worker turn is running or the launch/wake attempt ends.
   * @throws Later when no slot is free.
   */
  reserve(ticketId: string, by: 'launch' | 'wake' | 'person'): void {
    if (this.starting.has(ticketId)) return
    if (this.used() >= this.max() + (by === 'person' ? 1 : 0)) throw new Later('No worker slot is free')
    this.starting.set(ticketId, by)
  }
  /** Releases `ticketId`'s starting slot once its worker session is running or the launch/wake attempt has ended. */
  free(ticketId: string): void {
    this.starting.delete(ticketId)
  }
}

/** Owns the application lifecycle and state for this adapter. */
export class CodexExecutor implements Executor {
  private slots: WorkerSlots
  private disposeEvents?: () => void
  private launching = new Set<string>()
  private stopping = new Map<string, Promise<void>>()
  constructor(private host: ExecutorHost) {
    this.slots = new WorkerSlots(
      () =>
        host.sessions.runtime
          .list()
          .filter((s) => s.role === 'worker' && s.status === 'running')
          .map((s) => ticketOfSession(s.id)!),
      () => host.store.settings().executor.maxWorkers
    )
    host.effects.handle('launch', (p) => this.launch(p.ticketId, p.assignmentId), {
      limit: () => (host.paused() ? 0 : this.slots.launches())
    })
    host.effects.handle('delivery', (p) => this.deliverQueued(p.ticketId), {
      limit: () => (host.paused() ? 0 : 4),
      quiet: true
    })
  }
  prepare(ticket: Ticket, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>) {
    return {
      ...ticket,
      execution: ticketExecution(ticket, outcome, this.host.store.settings(), this.host.machine.stateDir)
    }
  }
  start(ticket: Ticket, a: Assignment) {
    this.host.effects.enqueue('launch', a.id, { ticketId: ticket.id, assignmentId: a.id })
  }
  deliver(ticket: Ticket, _a: Assignment) {
    this.host.effects.enqueue('delivery', ticket.id, { ticketId: ticket.id })
  }
  stop(ticket: Ticket, _a: Assignment, _reason: string) {
    this.host.store.afterCommit(() => {
      const previous = this.stopping.get(ticket.id)
      const pending = new Promise<void>((resolve) => setTimeout(resolve, 0))
        .then(() => previous)
        .then(() => this.host.sessions.runtime.interrupt(workerSessionId(ticket.id)))
        .catch((error) => {
          if (!this.host.closing()) this.failed(ticket.id, error)
        })
        .finally(() => {
          if (this.stopping.get(ticket.id) === pending) this.stopping.delete(ticket.id)
        })
      this.stopping.set(ticket.id, pending)
    })
  }

  activeCount() {
    return this.slots.used()
  }
  private failed(id: string, error: unknown) {
    const t = this.host.store.tickets.get(id)
    if (!t || !liveTicket(t)) return
    this.host.store.atomic(() => {
      const updated = this.host.engine.report(id, { state: 'failed', summary: String(error) })
      const r = resultRelay(updated, 'failed', String(error))
      this.host.sessions.relay(r.id, r.text)
    })
  }
  private async launch(id: string, assignmentId: string) {
    await this.stopping.get(id)
    const h = this.host,
      t = h.store.tickets.get(id)
    if (!t || !liveTicket(t) || latestAssignment(t)?.id !== assignmentId) return
    this.slots.reserve(id, 'launch')
    this.launching.add(id)
    try {
      const cwd = t.execution!.directory
      const exists = await stat(cwd).then(
        () => true,
        () => false
      )
      if (!exists) {
        await mkdir(dirname(cwd), { recursive: true })
        const command = h.store.settings().executor.prepare
        if (command)
          await promisify(execFile)('sh', ['-c', command], {
            cwd: dirname(cwd),
            env: { ...process.env, ...Object.fromEntries(h.environment(t).map((v) => [v.key, v.value])) },
            signal: h.lifetime,
            timeout: 600000
          })
        await mkdir(cwd, { recursive: true })
      }
      await h.sessions.ensure(workerSessionId(id), cwd, t.title, 'worker')
      const current = h.store.tickets.get(id)
      if (!current || !liveTicket(current) || latestAssignment(current)?.id !== assignmentId) return
      const trigger = sourceTrigger(h, t)
      h.engine.assignmentStarted(id, assignmentId)
      await h.sessions.prompt(
        workerSessionId(id),
        `assignment:${assignmentId}`,
        JSON.stringify({
          ticket_id: id,
          title: t.title,
          assignment: t.execution!.assignment,
          trigger: trigger ? triggerMessage(trigger, await h.sourceLink(trigger)) : undefined,
          batch: batchOf(h, t).map(batchLine)
        }),
        'queue'
      )
    } catch (e) {
      if (h.closing() || e instanceof Later) throw e
      this.failed(id, e)
    } finally {
      this.launching.delete(id)
      this.slots.free(id)
    }
  }
  private async deliverQueued(id: string) {
    await this.stopping.get(id)
    if (this.launching.has(id)) throw new Later('Initial assignment delivery is still in progress')
    const h = this.host
    let t = h.store.tickets.get(id)
    if (!t || !liveTicket(t) || !runningAssignment(t)) return
    if (waitsForPerson(t)) return
    const person = t.inputs.some(
      (input) => t!.undelivered.includes(input.id) && input.kind === 'trigger' && input.human && !input.context
    )
    if (h.sessions.runtime.get(workerSessionId(id))?.status !== 'running')
      this.slots.reserve(id, person ? 'person' : 'wake')
    try {
      await h.sessions.ensure(workerSessionId(id), t.execution!.directory, t.title, 'worker')
      while ((t = h.store.tickets.get(id)) && liveTicket(t) && t.undelivered.length) {
        const a = runningAssignment(t)
        if (!a) return
        const input = t.inputs.find((i) => i.id === t!.undelivered[0])
        if (!input) return
        const trigger = input.kind === 'trigger' ? h.store.triggers.get(input.triggerId) : undefined
        const text = inputMessage(input, trigger ? triggerMessage(trigger, await h.sourceLink(trigger)) : undefined)
        if (text)
          await h.sessions.prompt(workerSessionId(id), input.id, text, 'steer', () => {
            const current = h.store.tickets.get(id)
            if (!current || !liveTicket(current) || runningAssignment(current)?.id !== a.id)
              throw new Error('Assignment changed')
          })
        h.engine.inputsDelivered(id, a.id, [input.id])
        if (h.sessions.runtime.get(workerSessionId(id))?.consumed?.includes(input.id))
          h.engine.inputsRead(id, [input.id])
      }
    } catch (e) {
      const a = t && runningAssignment(t)
      if (a) h.engine.deliveryFailed(id, a.id, String(e))
      throw e
    } finally {
      this.slots.free(id)
    }
  }
  install() {
    this.disposeEvents = this.host.sessions.runtime.subscribe((e) => {
      const id = ticketOfSession(e.sessionId),
        t = id ? this.host.store.tickets.get(id) : undefined,
        a = t && runningAssignment(t)
      if (!id || !t || !a || !liveTicket(t)) return
      if (e.type === 'input' && e.requestId) this.host.engine.inputsRead(id, [e.requestId])
      if (e.type === 'failed') this.failed(id, e.error ?? 'Codex failed')
      if (e.type === 'ended') this.host.engine.turnEnded(id, a.id)
    })
  }
  resume() {
    for (const t of this.host.store.tickets.open()) {
      const a = latestAssignment(t)
      if (a?.state === 'pending') this.start(t, a)
      else if (a?.state === 'running')
        this.failed(
          t.id,
          'Service restarted during execution. Inspect the saved session and explicitly retry; no external work was replayed.'
        )
    }
  }
  async shutdown() {
    await Promise.allSettled(this.stopping.values())
    await this.host.sessions.runtime.stop()
  }
  dispose() {
    this.disposeEvents?.()
  }
}
