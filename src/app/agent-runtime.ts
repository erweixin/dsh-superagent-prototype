/** Application-owned contracts. Provider protocol types stay in the adapter. */
import type { Tool } from './tools/tool.ts'
export interface Agent {
  id: string
}
export interface ModelCatalog {
  failures?: unknown[]
  groups: {
    id: string
    name: string
    models: { id: string; name: string; reasoning?: { efforts: { id: string; name: string }[] } }[]
  }[]
  default?: { provider: string; model: string; reasoningEffort?: string }
}
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  at: string
}
export interface AgentSession {
  id: string
  threadId: string
  cwd: string
  title: string
  role: 'orchestrator' | 'worker'
  turnId?: string
  status: 'idle' | 'running' | 'interrupted' | 'failed'
  messages: AgentMessage[]
  deliveries: Record<string, 'sending' | 'sent'>
  consumed?: string[]
  error?: string
  toolSchemaFingerprint?: string
  previousThreadIds?: string[]
}
export interface Approval {
  id: string
  sessionId: string
  turnId: string
  method: string
  detail: unknown
  elicitation?: { message: string; serverName: string; canAccept: boolean; session: boolean }
  state: 'pending' | 'accepted' | 'declined' | 'expired'
  at: string
}
export type AgentEvent = {
  sessionId: string
  type: 'changed' | 'ended' | 'failed' | 'input' | 'approval' | 'approvalResolved'
  requestId?: string
  error?: string
}
export interface SessionSpec {
  id: string
  cwd: string
  title: string
  role: 'orchestrator' | 'worker'
  instructions: string
  environment?: Record<string, string>
  model?: string
  provider?: string
  effort?: string
  tools: Tool[]
}
export interface AgentRuntime {
  ensure(spec: SessionSpec): Promise<AgentSession>
  send(id: string, requestId: string, text: string, inject?: boolean): Promise<void>
  interrupt(id: string): Promise<void>
  get(id: string): AgentSession | undefined
  list(): AgentSession[]
  approvals(): Approval[]
  approve(id: string, accept: boolean): Promise<void>
  models(): Promise<ModelCatalog>
  subscribe(listener: (event: AgentEvent) => void): () => void
  stop(): Promise<void>
}
