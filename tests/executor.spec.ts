import { describe, it, expect } from 'vitest'
import {
  WorkerSlots,
  inputMessage,
  mandateInstructions,
  ticketExecution,
  triggerMessage
} from '../src/executor/codex.ts'
import { Later } from '../src/app/effects.ts'
import { reportRelay } from '../src/app/notices.ts'
import { SettingsSchema } from '../src/policy.ts'
import type { Ticket, Trigger } from '../src/core/index.ts'
describe("the Executor's parts", () => {
  it('holds one worker slot per ticket that runs or starts, and lets launches take the slots no worker or wake holds', () => {
    const running = ['t1']
    const slots = new WorkerSlots(
      () => running,
      () => 3
    )
    slots.reserve('t2', 'launch')
    slots.reserve('t3', 'wake')
    expect(slots.used()).toBe(3)
    // launches() excludes 'launch' reservations because the launch queue tracks active launches separately.
    expect(slots.launches()).toBe(1)
    expect(() => slots.reserve('t4', 'wake')).toThrow(Later)
    expect(() => slots.reserve('t3', 'wake')).not.toThrow()
    slots.free('t3')
    expect(slots.used()).toBe(2)
    slots.reserve('t4', 'launch')
    expect(slots.used()).toBe(3)
  })
  it("wakes a worker for a person's message in the one slot beyond the limit, and ahead of launches once a slot frees up", () => {
    const running = ['t1', 't2', 't3']
    const slots = new WorkerSlots(
      () => running,
      () => 3
    )
    expect(() => slots.reserve('t4', 'launch')).toThrow(Later)
    expect(() => slots.reserve('t4', 'wake')).toThrow(Later)
    slots.reserve('t5', 'person')
    expect(slots.used()).toBe(4)
    expect(slots.launches()).toBeLessThanOrEqual(0)
    // No second person's wake fits beyond the limit; once a worker ends, it does, while a launch still waits.
    expect(() => slots.reserve('t6', 'person')).toThrow(Later)
    running.splice(0, 1)
    expect(() => slots.reserve('t7', 'launch')).toThrow(Later)
    slots.reserve('t6', 'person')
    expect(slots.used()).toBe(4)
  })
  it('words an assignment, and the limits an inferred mandate sets, from the ticket alone', () => {
    const settings = SettingsSchema.parse({
      policy: { rules: [{ id: 'copy', name: 'Copy fixes', enabled: true, instruction: 'Fix typos only.' }] }
    })
    const ticket = {
      id: 'ticket-0123456789abcdef',
      origin: { triggerId: 'tr1', triggerIds: [] },
      mandate: {
        strength: 'inferred',
        policyVersion: 'v1',
        basis: { rules: ['copy'] },
        actor: { source: 'feishu', id: 'alice' },
        scope: ''
      }
    } as unknown as Ticket
    const execution = ticketExecution(
      ticket,
      { kind: 'accept', title: 'Fix', scope: 'the typo', reason: 'r', name: 'fix-typo' } as never,
      settings,
      '/state'
    )
    expect(execution).toEqual(expect.objectContaining({ name: 'fix-typo-ticket-01234' }))
    expect(execution).not.toHaveProperty('session')
    // The source Trigger goes with the assignment, so the text does not point at it.
    expect(execution.assignment).toContain('Scope: the typo.')
    expect(execution.assignment).not.toContain('trigger/tr1')
    expect(
      ticketExecution(
        { ...ticket, mandate: { ...ticket.mandate, strength: 'explicit' } } as Ticket,
        { kind: 'accept', title: 'Fix', scope: 'Fix', reason: 'r', name: 'fix-login', note: 'the login page' } as never,
        settings,
        '/state'
      ).assignment
    ).toBe('Routing note (not the source request): the login page')
    // The worker's system prompt holds the limits an inferred Mandate sets, so the assignment does not repeat them.
    expect(execution.assignment).not.toContain(mandateInstructions(ticket.mandate))
    expect(execution.assignment).toContain('- Copy fixes (copy): Fix typos only.')
    expect(mandateInstructions({ strength: 'explicit' })).toBe('')
  })
  it('renders each kind of Input as its worker reads it, inline, and no reopen Input', () => {
    const asked = {
      id: 'tr1',
      source: 'feishu',
      threads: [{ source: 'feishu', id: 'oc:om_1' }],
      actor: { source: 'feishu', id: 'ou_a' },
      human: true,
      at: '2026-09-01T00:00:00Z',
      text: 'Which page?',
      meta: {}
    } as Trigger
    const reply = { ...asked, id: 'tr2', text: 'The login page. '.repeat(50) }
    const card = triggerMessage(reply, { source_url: 'https://x' }, 'see the log', asked)
    expect(card).toEqual({
      trigger_id: 'tr2',
      from: 'ou_a',
      thread: 'feishu:oc:om_1',
      at: '2026-09-01T00:00:00Z',
      text: expect.stringMatching(/^The login page\./),
      chars: reply.text.length,
      read: 'trigger/tr2',
      source_url: 'https://x',
      routing_note: 'see the log',
      replies_to: { trigger_id: 'tr1', preview: 'Which page?' }
    })
    expect(card.text).toHaveLength(601)
    expect(triggerMessage(asked, {})).toEqual({
      trigger_id: 'tr1',
      from: 'ou_a',
      thread: 'feishu:oc:om_1',
      at: asked.at,
      text: 'Which page?'
    })
    expect(JSON.parse(inputMessage({ id: 'i1', kind: 'trigger', triggerId: 'tr2', at: '' }, card)!)).toEqual(card)
    expect(JSON.parse(inputMessage({ id: 'i1', kind: 'trigger', triggerId: 'gone', at: '' })!)).toEqual({
      trigger_id: 'gone',
      read: 'trigger/gone'
    })
    expect(inputMessage({ id: 'i2', kind: 'text', at: '', text: 'Please also update the docs' })).toBe(
      'Please also update the docs'
    )
    // A Policy change says what it means for the ticket, without version hashes.
    const changed = inputMessage({
      id: 'i3',
      kind: 'policy-changed',
      at: '',
      from: 'v1',
      to: 'v2',
      effect: {
        requesterAllowed: false,
        requester: { source: 'feishu', id: 'ci-bot' },
        rules: [
          { id: 'copy', name: 'Copy fixes', change: 'changed', instruction: 'Fix typos only.' },
          { id: 'visual', name: 'Visual', change: 'disabled' }
        ]
      }
    })!
    expect(changed).toContain(
      'Rule Copy fixes (copy), which this ticket was accepted under, changed. Keep the remaining work within it as it reads now: Fix typos only.'
    )
    expect(changed).toContain('Rule Visual (visual), which this ticket was accepted under, no longer applies')
    // The sender is named, a bot as a person.
    expect(changed).toContain('The sender this ticket is for, ci-bot on feishu, may no longer start work here')
    expect(changed).not.toContain('person')
    expect(changed).not.toContain('v2')
    const mode = inputMessage({
      id: 'i6',
      kind: 'policy-changed',
      at: '',
      from: 'v1',
      to: 'v2',
      effect: { proactive: false }
    })!
    expect(mode).toContain('Work inferred from a rule is no longer accepted, as the accept mode is no longer auto')
    expect(mode).not.toContain('sender')
    expect(inputMessage({ id: 'i5', kind: 'resumed', at: '', triggerId: 'tr2' })).not.toContain('tr2')
    expect(inputMessage({ id: 'i4', kind: 'reopen', at: '' } as never)).toBeUndefined()
  })
  it("relays a worker's question, result or answer to the main Session, and keeps its progress internal", () => {
    const ticket = {
      id: 't1',
      title: 'Fix',
      updatedAt: '2026-09-01T00:00:00Z',
      attention: { id: 'a1', question: 'Which color?' },
      assignments: [],
      mandate: { strength: 'explicit' },
      origin: { triggerId: 'tr1' }
    } as unknown as Ticket
    expect(reportRelay(ticket, { state: 'progress', summary: 'halfway' })).toBeUndefined()
    expect(reportRelay(ticket, { state: 'blocked', summary: 'need input', question: 'Which color?' })).toMatchObject({
      id: 'attention:t1:a1',
      text: expect.stringContaining('"kind":"worker_attention"')
    })
    const ready = reportRelay({ ...ticket, attention: undefined } as unknown as Ticket, {
      state: 'ready',
      summary: 'Done',
      answers: 'tr9'
    })!
    expect(ready.id).toMatch(/^report:/)
    expect(JSON.parse(ready.text)).toMatchObject({
      kind: 'worker_report',
      ticket: { ticket_id: 't1' },
      trigger_id: 'tr1',
      state: 'ready',
      answer_to: 'tr9',
      summary: 'Done'
    })
    const illustrated = { ...ticket, attention: undefined, assignments: [{ report: { state: 'ready', summary: 'Done', at: ticket.updatedAt,
      images: [{ imageKey: 'img_screenshot', alt: '登录页' }] } }] } as unknown as Ticket
    const withImage = reportRelay(illustrated, { state: 'ready', summary: 'Done' })!
    expect(JSON.parse(withImage.text).images).toEqual([{ image_key: 'img_screenshot', alt: '登录页' }])
    expect(withImage.id).not.toBe(ready.id)
  })
})
