/** Browser plugin contracts and registry. The application composition chooses installed plugins. */
import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import type { SourceSettingsView, FieldSpec } from '../contracts/source-settings.ts'
import type { Call } from './api.ts'
import type { T } from './text.ts'

export interface SourceClientServices {
  t: T
  call: Call
  notify(message: string): void
}
export interface ConnectionPanelProps {
  source: SourceSettingsView
  services: SourceClientServices
  runningCount: number
  problem: ReactNode
  onChanged(): Promise<void>
  onRestartRequired(): void
  onOpenPolicy(): void
}
export interface PolicyFieldProps {
  source: SourceSettingsView
  field: FieldSpec
  part: Record<string, unknown>
  services: SourceClientServices
  onChange(part: Record<string, unknown>): void
  reload(): Promise<void>
}
export interface SourceClientPlugin {
  kind: string
  ConnectionPanel?: ComponentType<ConnectionPanelProps>
  /** Editors only change the parent policy draft; the host owns saving and policy revisions. */
  policyFields?: Readonly<Record<string, ComponentType<PolicyFieldProps>>>
}
const Registry = createContext<ReadonlyMap<string, SourceClientPlugin>>(new Map())
export function SourceClientsProvider({ plugins, children }: { plugins: readonly SourceClientPlugin[]; children: ReactNode }) {
  const registry = new Map<string, SourceClientPlugin>()
  for (const plugin of plugins) {
    if (registry.has(plugin.kind)) throw new Error(`Duplicate source client plugin: ${plugin.kind}`)
    registry.set(plugin.kind, plugin)
  }
  return <Registry.Provider value={registry}>{children}</Registry.Provider>
}
export const useSourceClients = () => useContext(Registry)
