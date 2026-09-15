# grok-clawbot

**Grok Bot 插件**：把**个人微信**接到 Grok Bot，走腾讯官方 **ClawBot** / **iLink**（`ilinkai.weixin.qq.com`）。

不是逆向微信（itchat / wechaty web / pad），不是公众号，不是企业微信，也不是 OpenClaw Gateway 频道包。

微信私信可以**像应用内 Bot 一样自动用模型回复**（独立 monitor 长轮询 + webhook 唤醒 + 模型 + `wechat_send`）。助手回合里**禁止**再 `getupdates`。

设计说明与开源对照见 [`docs/design.md`](docs/design.md)。协议来自 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT）。包装参考 [little-thing/grok-wechat-plugin](https://github.com/little-thing/grok-wechat-plugin)。独立 iLink 客户端对照 [SiverKing/weixin-ClawBot-API](https://github.com/SiverKing/weixin-ClawBot-API) 与 [ikrong/wx-clawbot](https://github.com/ikrong/wx-clawbot)。

## Install

在 Grok Bot 里安装本仓库（连接器 `grok-clawbot`，入口 `server/index.js`，技能 `skills/wechat-channel/SKILL.md`）。

需要 Node.js ≥ 18。凭证写在 `GROK_CLAWBOT_HOME` 或 `~/.grok-clawbot`，不进 git。

## Auto-reply setup

绑定成功后三件事（细节见 [`skills/wechat-channel/SKILL.md`](skills/wechat-channel/SKILL.md)）：

1. **Webhook Routine**（例：「微信入站唤醒」）— 唤醒后若 webhook 已有正文：`wechat_typing on` → 模型回复 → `wechat_send` → typing off；没有正文才 `wechat_inbox` drain
2. 从 Routine 面板复制 **URL + sender key**，一次性交给 `wechat_set_wake`
3. **保活 Routine**（`@every 5m`）只调 `wechat_start_monitor`；绑定后也立刻手动开一次。独立进程 `node server/index.js --monitor` 负责长轮询，Grok Bot 睡着也在跑

## Tools

`wechat_login_start` → `wechat_login_wait` → `wechat_start_monitor` + `wechat_set_wake`

被叫醒后：**不要**在助手回合里 `getupdates`。webhook 已带正文时：`wechat_typing on` → 想一句 → `wechat_send` → `wechat_typing off`。`wechat_inbox` 只取本地缓冲。

## Test

```bash
npm test
```

测试只用录制的 iLink JSON fixture 和假 HTTP，不连真实微信。
