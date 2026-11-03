/** Server extension ports. Source adapters own account setup and long-running consumers. */
import type { Deployment, Machine, Probe } from '../deployment.ts'
import type { SourceContext } from './host.ts'

export interface SourceSetupHost {
  machine: Machine
  lifetime: AbortSignal
  settings: {
    block(name: `source:${string}`): { value: unknown; revision: number }
    save(name: `source:${string}`, value: unknown, revision: number, origin: 'panel'): Promise<{ revision: number; restarting: boolean }>
  }
}
export interface SourceSetup<C> {
  fields: readonly string[]
  resolve(machine: Machine, config: C | undefined, probe: Probe): Promise<unknown>
  /** Optional alias for consumers of the original Deployment shape. */
  legacyAccountKey?: string
  shims?(deployment: Deployment): Record<string, string>
  onboarding?: {
    path: string
    /** Created once per HTTP server, so concurrent onboarding stays serialized across Runtime reloads. */
    create(): (host: SourceSetupHost, input: unknown) => Promise<unknown>
  }
}
export type SourceRun = (context: SourceContext, signal: AbortSignal) => Promise<unknown>
