import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { startRuntime, type Host } from './fixtures/standalone.ts'
import { panelTrigger } from '../src/sources/panel.ts'
import { workerSessionId, ticketOfSession } from '../src/app/worker-sessions.ts'
import { latestAssignment } from '../src/core/index.ts'
let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('serializes group tasks, preserves the provider thread, and never stops its owner when a queued ticket is cancelled', async () => {
  host = await startRuntime()
  const r = host.runtime, directory = realpathSync(host.directory)
  // Exercise the source-neutral workspace port without an external messaging service.
  const kind = r.sources.kind('panel')!
  kind.workspaces = () => [{key:'group-a', directory}, {key:'group-b', directory}]
  kind.workspaceKey = trigger => String(trigger.meta.group)
  const accept = (text: string, group = 'group-a') => {
    const trigger = panelTrigger(text)
    trigger.meta.group = group
    r.receive(trigger)
    const decision = r.engine.decide(trigger.id, {kind:'accept',title:text,scope:text,reason:'Explicit request',name:'group-task'})
    return r.store.tickets.get(decision.ticketId!)!
  }
  const first = accept('First KEEP_RUNNING'), second = accept('Second KEEP_RUNNING'), cancelled = accept('Cancelled'), other = accept('Other KEEP_RUNNING','group-b')
  const sessionId = workerSessionId(first)
  expect(workerSessionId(second)).toBe(sessionId)
  expect(workerSessionId(other)).not.toBe(sessionId)
  expect(first.execution!.directory).toBe(directory)
  await r.pump()
  await vi.waitFor(() => expect(r.sessions.runtime.get(sessionId)?.status).toBe('running'))
  const threadId = r.sessions.runtime.get(sessionId)!.threadId
  expect(ticketOfSession(sessionId, r.store)).toBe(first.id)
  expect(latestAssignment(r.store.tickets.get(second.id)!)?.state).toBe('pending')
  r.engine.stopTicket(cancelled.id)
  await r.pump()
  expect(r.sessions.runtime.get(sessionId)?.status).toBe('running')
  expect(ticketOfSession(sessionId,r.store)).toBe(first.id)
  r.engine.report(first.id,{state:'ready',summary:'First done'})
  await expect(r.sessions.runtime.send(sessionId,'late','Do not act')).rejects.toThrow()
  await vi.waitFor(() => expect(r.sessions.runtime.get(sessionId)?.status).toBe('interrupted'))
  r.store.db.prepare("UPDATE effect SET due=0 WHERE kind='launch'").run()
  await r.pump()
  await vi.waitFor(() => expect(ticketOfSession(sessionId,r.store)).toBe(second.id))
  await vi.waitFor(() => expect(r.sessions.runtime.get(sessionId)?.status).toBe('running'))
  expect(r.sessions.runtime.get(sessionId)!.threadId).toBe(threadId)
  expect(r.sessions.runtime.get(sessionId)!.messages.filter(m=>m.role==='user').map(m=>m.text).join('\n')).toContain('First KEEP_RUNNING')
  expect(r.sessions.runtime.get(sessionId)!.messages.filter(m=>m.role==='user').map(m=>m.text).join('\n')).toContain('Second KEEP_RUNNING')
  r.engine.stopTicket(second.id)
  await expect(r.sessions.runtime.send(sessionId,'late-again','Do not act')).rejects.toThrow()
})

it('validates panel-only Feishu bindings and keeps old tickets on their original project', async () => {
  host = await startRuntime()
  const r=host.runtime, directory=realpathSync(host.directory), other=join(directory,'project-b')
  mkdirSync(other)
  const block=r.settings.block('source:feishu'), value=block.value as {enabled:boolean;config:Record<string,unknown>}
  const binding={...value,config:{...value.config,chats:[{chatId:'oc_group',listen:'all',projectDirectory:directory}]}}
  await expect(r.settings.save('source:feishu',binding,block.revision,'tool')).rejects.toThrow('panel')
  await r.settings.save('source:feishu',binding,block.revision,'panel')
  expect(r.sources.workspace({...panelTrigger('x'),source:'feishu',meta:{chatId:'oc_group',direct:false}})?.directory).toBe(directory)
  expect(r.sources.workspace({...panelTrigger('x'),source:'feishu',meta:{chatId:'oc_group',direct:true}})).toBeUndefined()
  const current=r.settings.block('source:feishu')
  await expect(r.settings.save('source:feishu',{...binding,config:{...binding.config,chats:[{chatId:'oc_group',listen:'all',projectDirectory:join(directory,'absent')}]}},current.revision,'panel')).rejects.toThrow()
  expect(r.settings.block('source:feishu').revision).toBe(current.revision)
  const kind=r.sources.kind('panel')!
  let project=directory
  kind.workspaces=()=>[{key:'group',directory:project}]
  kind.workspaceKey=()=> 'group'
  const accept=()=>{
    const trigger=panelTrigger('Project work')
    r.receive(trigger)
    return r.store.tickets.get(r.engine.decide(trigger.id,{kind:'accept',title:'Project',scope:'Project',reason:'Requested',name:'project'}).ticketId!)!
  }
  const old=accept();project=other;const next=accept()
  expect(old.execution!.directory).toBe(directory)
  expect(next.execution!.directory).toBe(other)
  expect(workerSessionId(old)).not.toBe(workerSessionId(next))
})

it('expires old approvals before changing owners and restores group ownership after restart without replay', async () => {
  const { Runtime } = await import('../src/app/runtime.ts')
  const { machineOf } = await import('../src/deployment.ts')
  const { resolve } = await import('node:path')
  host=await startRuntime()
  let r=host.runtime
  const directory=realpathSync(host.directory), kind=r.sources.kind('panel')!
  kind.workspaces=()=>[{key:'group',directory}]
  kind.workspaceKey=()=> 'group'
  const accept=(text:string)=>{
    const trigger=panelTrigger(text);r.receive(trigger)
    return r.store.tickets.get(r.engine.decide(trigger.id,{kind:'accept',title:text,scope:text,reason:'Requested',name:'group-task'}).ticketId!)!
  }
  const first=accept('REQUEST_APPROVAL'), second=accept('Second KEEP_RUNNING'), sid=workerSessionId(first)
  await r.pump()
  await vi.waitFor(()=>expect(r.sessions.runtime.approvals().some(a=>a.sessionId===sid&&a.state==='pending')).toBe(true))
  const approval=r.sessions.runtime.approvals().find(a=>a.sessionId===sid&&a.state==='pending')!
  const threadId=r.sessions.runtime.get(sid)!.threadId
  await r.stop()
  r=new Runtime(machineOf({stateDir:directory,codexPath:resolve('tests/fixtures/codex.mjs')}),()=>{})
  try {
    await r.ready
    await r.pump()
    expect(ticketOfSession(sid,r.store)).toBe(first.id)
    expect(r.sessions.runtime.approvals().find(a=>a.id===approval.id)?.state).toBe('expired')
    await expect(r.sessions.runtime.approve(approval.id,true)).rejects.toThrow()
    expect(latestAssignment(r.store.tickets.get(second.id)!)?.state).toBe('pending')
    expect(r.sessions.runtime.get(sid)!.messages.filter(m=>m.role==='user')).toHaveLength(1)
    r.engine.stopTicket(first.id)
    r.store.db.prepare("UPDATE effect SET due=0 WHERE kind='launch'").run()
    await r.pump()
    await vi.waitFor(()=>expect(ticketOfSession(sid,r.store)).toBe(second.id))
    await vi.waitFor(()=>expect(r.sessions.runtime.get(sid)?.status).toBe('running'))
    expect(r.sessions.runtime.get(sid)!.threadId).toBe(threadId)
    await expect(r.sessions.runtime.approve(approval.id,true)).rejects.toThrow()
  } finally { await r.stop() }
})
