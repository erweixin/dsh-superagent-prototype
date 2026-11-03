/** Resolved bot identity. App Secret stays in the CLI credential store. */
export interface FeishuBot {
  cli: string
  appId: string
  brand: 'feishu' | 'lark'
  botId: string
  name: string
}
