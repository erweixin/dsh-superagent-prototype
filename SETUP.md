# Standalone setup

1. Install Node.js 22.19 or newer and Codex CLI 0.153.4. Run `codex login`, then `codex login status` under the account that will run the service.
2. Install dependencies and build with `npm install` and `npm run build`.
3. Choose a new absolute state directory and optionally write `superagent.config.json` as shown in README. Do not point the application at an old DSH state directory.
4. Install the official `lark-cli` on the service computer: `npx @larksuite/cli@latest install`. Create a Feishu internal app with bot capability (details below).
5. Run `npm start` and open the printed local address. In Settings → Sources, enter the original CLI executable path, App ID and App Secret in “Connect a Feishu bot”. Check the connection, then save and enable. Saving reloads Runtime and interrupts active workers. You can also supply an existing strict-bot CLI wrapper in the source card.
6. Invite the bot into the intended chats. Configure receiving scopes and the allowed-user list. Start with a small list and observe mode for proactive rules.
7. Send an allowed user’s @ mention or direct message. Verify one acknowledgement, a task with an independent directory, and a result in the same conversation. Permission requests appear in the local panel.
8. Use Ctrl-C or SIGTERM for graceful shutdown. Restart with the same state directory to keep task records and Codex thread mappings.

Do not expose the management listener through a public proxy. First-version operation assumes one local trusted operator. Any service manager should use the same OS account and PATH as the working manual setup.

Validation without real accounts uses the simulated app-server fixture in the tests. Real Feishu smoke tests require a dedicated test chat and bot; never send test messages to production conversations by default.

For a Linux user service, adapt `examples/feishu-superagent.service` with absolute paths and the PATH used by your working Codex and bot CLI installations. Use the same OS user that ran `codex login`. On macOS, a launchd job should similarly invoke the absolute Node executable, built `lib/index.js`, and configuration path; keep credentials in the logged-in account’s existing CLI stores.

`npm run smoke:codex` runs the real local Codex account through a complete panel-source task: accept, create an isolated directory, write and verify one test file, report ready, and deliver acknowledgement/result through the local Outbox. It prints the temporary state directory for inspection and does not contact Feishu. This is separate from `npm run check`, which uses simulated provider processes.

## 在 Web 面板配置飞书机器人

这里使用的是企业自建应用的机器人，需要 **App ID 和 App Secret**；群聊“自定义机器人”的 webhook 地址不能用于本项目。

1. 在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，在应用能力中添加机器人。复制“凭证与基础信息”里的 App ID 和 App Secret。
2. 在运行 Superagent 的电脑安装 [官方 lark-cli](https://github.com/larksuite/cli)：`npx @larksuite/cli@latest install`。面板需要服务进程能找到这个命令；找不到时填写安装后的绝对路径。
3. 打开 **设置 → 来源 → 连接飞书机器人**。填写 CLI 路径、平台（飞书或 Lark）、App ID 和 App Secret，点击“检测连接”。检测会查询机器人身份，显示名称；它不启用或保存来源配置，也不发送聊天消息。检测期间会在独立的临时目录中创建仅当前账户可读的 CLI 配置（含凭据），完成或失败后删除。
4. 点击“保存并启用”。服务通过 stdin 把 Secret 交给 CLI 的 `config init --app-secret-stdin`，并设置 `config strict-mode bot`；保存成功后输入框清空。配置保存在状态目录下的独立 `feishu-bots/bot-*` 目录，Secret 由 CLI 自己的凭据存储管理。业务设置及其历史只记录生成的 CLI 包装脚本路径。不要手动移动正在使用的目录。
5. 在飞书开发者后台申请消息接收、回复，以及所需的历史消息、图片资源、群列表和成员读取权限。权限范围由实际启用功能决定；接收群内所有消息需要额外的数据权限。发布应用版本并确保测试用户在应用可用范围内，将机器人加入测试群。
6. 在事件订阅里选择**长连接**，订阅 **`im.message.receive_v1`**。服务启用来源后会启动 `lark-cli event consume` 建立连接；若后台要求先建立连接，可先保存面板配置，再返回后台完成订阅和发布。无需公网回调 URL。
7. 在 **设置 → 来源** 选择群聊接收范围及私聊开关；在 **设置 → 评估** 的飞书策略中添加允许发起任务的用户（或同步指定群成员）。机器人身份检测成功不代表权限、订阅和准入已经配置完成。
8. 用允许的用户在测试群 @ 机器人或私聊，确认来源健康、任务创建及原会话回复。

机器人身份通过应用凭据自动认证，**不需要 `lark-cli auth login`**。该命令用于个人用户 OAuth；缺少机器人权限时应到开发者后台开通并发布，而不是登录个人账号。参见 [官方身份与权限说明](https://github.com/larksuite/cli/blob/main/skills/lark-shared/references/lark-shared-identity-and-permissions.md)。

如果偏好终端，可对专用 CLI 配置运行 `lark-cli config init`（交互填写凭证），再运行 `lark-cli config strict-mode bot` 和 `lark-cli auth status`，最后将对应的 CLI 或包装脚本路径填入来源卡片。使用已有个人 CLI 时，建议采用上面的 Web 流程，避免切换个人 CLI 的默认配置。Web 配置目录独立；同一 App ID 的 Secret 仍由 CLI 的系统凭据存储共享管理。更新 Secret 前会先验证身份，避免无效凭据覆盖现有配置。

常见问题：找不到 CLI 时检查服务账户的 PATH；检测失败时检查 App ID/Secret、平台和机器人能力，并确认 CLI 支持 `--app-secret-stdin`；机器人在线但不接单时检查应用发布、可用范围、事件订阅、消息权限、群接收范围和允许用户。检测成功只说明可以查询机器人身份，完整联调仍需真实测试群。
