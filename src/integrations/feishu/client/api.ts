/** Typed onboarding client; the host transport retains same-origin headers and error handling. */
import type { Call } from '../../../client/api.ts'
import type { FeishuBotSetupRequest } from '../shared/contracts.ts'
export const feishuSetupClient = (call: Call) => ({
  configure: (body: FeishuBotSetupRequest) => call('POST setup/feishu', { body }),
})
