/** Browser-safe Feishu onboarding request and response contracts. Secrets are write-only. */
export interface FeishuBotSetupRequest {
  action: 'check' | 'save'
  cli: string
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
}
export interface FeishuBotSetupResult {
  bot: { appId: string; brand: 'feishu' | 'lark'; botId: string; name: string }
  saved: boolean
  restarting: boolean
}
export interface FeishuSetupApi {
  'POST setup/feishu': { body: FeishuBotSetupRequest; response: FeishuBotSetupResult }
}
