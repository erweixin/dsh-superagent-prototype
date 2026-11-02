import type { AgentRuntime } from './agent-runtime.ts'
import type { RoleModel } from '../policy.ts'
export async function resolveRoleModel(runtime: AgentRuntime, model: RoleModel) {
  const catalog = await runtime.models()
  if (!catalog.groups.some((g) => g.id === model.provider && g.models.some((m) => m.id === model.model)))
    throw new Error('Model is not in the available Codex catalog')
  return model
}
