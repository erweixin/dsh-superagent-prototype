import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { FeishuBot } from './integrations/feishu/shared/account.ts'
export const Config = z
  .object({
    stateDir: z.string().refine(isAbsolute),
    port: z.number().int().min(0).max(65535).default(4317),
    codexPath: z.string().default('codex'),
    promptMaxChars: z.number().int().min(1000).default(100000),
    admissionContextMaxPages: z.number().int().min(1).default(10),
    admissionContextTimeoutMs: z.number().int().min(1).default(15000)
  })
  .strict()
export type DeploymentConfig = z.infer<typeof Config>
export interface Machine {
  stateDir: string
  port: number
  codexPath: string
  promptMaxChars: { get(): number }
  admissionContextMaxPages: { get(): number }
  admissionContextTimeoutMs: { get(): number }
}
export function machineOf(input: unknown): Machine {
  const c = Config.parse(input)
  return {
    ...c,
    ...Object.fromEntries(
      ['promptMaxChars', 'admissionContextMaxPages', 'admissionContextTimeoutMs'].map((k) => [
        k,
        { get: () => c[k as keyof typeof c] }
      ])
    )
  } as unknown as Machine
}
/** Deployment facts published by source account resolvers. */
export interface Deployment extends Machine {
  accounts?: Record<string, unknown>
  /** Legacy alias retained for existing consumers. */
  feishu?: FeishuBot
}
/** Compatibility exports; new source adapters own their account validation. */
export { executable } from './infra/executable.ts'
export { resolveFeishuBot, FeishuBotSchema } from './integrations/feishu/server/account.ts'
export type { FeishuBot } from './integrations/feishu/shared/account.ts'
export type Probe = (argv: string[]) => Promise<string>
export const SETUP_FIELDS: Readonly<Record<string, readonly string[]>> = { feishu: ['cli'] }
