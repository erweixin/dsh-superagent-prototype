import type { Approval } from '../app/agent-runtime.ts'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Only confirmation-only forms can be answered by the panel's two decision buttons.
 * URL authentication, device proofs and forms with fields need a dedicated UI. */
export function elicitationPrompt(params: Record<string, unknown>): NonNullable<Approval['elicitation']> {
  const schema = params.requestedSchema
  const emptyForm = object(schema) && schema.type === 'object'
    && object(schema.properties) && Object.keys(schema.properties).length === 0
    && (schema.required == null || (Array.isArray(schema.required) && schema.required.length === 0))
    && Object.keys(schema).every(key => ['$schema', 'type', 'properties', 'required', 'additionalProperties', 'title', 'description'].includes(key))
  const meta = object(params._meta) ? params._meta : {}
  return {
    message: typeof params.message === 'string' ? params.message : String(params.title ?? 'MCP authorization request'),
    serverName: String(params.serverName ?? ''),
    canAccept: ['form', 'openai/form', 'openaiForm'].includes(String(params.mode)) && emptyForm,
    session: meta.connector_id === 'computer-use' && Array.isArray(meta.persist) && meta.persist.includes('session')
  }
}

export function elicitationResponse(params: Record<string, unknown>, accept: boolean) {
  const prompt = elicitationPrompt(params)
  if (accept && !prompt.canAccept) throw new Error('This MCP request requires a form, authentication, or device verification that this panel does not support')
  return {
    action: accept ? 'accept' : 'decline',
    content: accept ? {} : null,
    ...(accept && prompt.session ? { _meta: { persist: 'session' } } : {})
  }
}
