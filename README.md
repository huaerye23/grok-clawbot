# grok-clawbot

**Grok Bot 插件**：把**个人微信**接到 Grok Bot，走腾讯官方 **ClawBot** / **iLink**（`ilinkai.weixin.qq.com`）。

不是逆向微信（itchat / wechaty web / pad），不是公众号，不是企业微信，也不是 OpenClaw Gateway 频道包。

设计说明与开源对照见 [`docs/design.md`](docs/design.md)。协议来自 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT）。包装参考 [little-thing/grok-wechat-plugin](https://github.com/little-thing/grok-wechat-plugin)。独立 iLink 客户端对照 [SiverKing/weixin-ClawBot-API](https://github.com/SiverKing/weixin-ClawBot-API) 与 [ikrong/wx-clawbot](https://github.com/ikrong/wx-clawbot)。

## Install

在 Grok Bot 里安装本仓库（连接器 `grok-clawbot`，入口 `server/index.js`，技能 `skills/wechat-channel/SKILL.md`）。

需要 Node.js ≥ 18。凭证写在 `GROK_CLAWBOT_HOME` 或 `~/.grok-clawbot`，不进 git。

## Tools

`wechat_login_start` → `wechat_login_wait` → `wechat_inbox` / `wechat_send` / `wechat_status` / `wechat_logout`

Grok Bot 会休眠：绑定后 `wechat_start_monitor`，并把 webhook 交给 `wechat_set_wake`。

## Test

```bash
npm test
```

测试只用录制的 iLink JSON fixture 和假 HTTP，不连真实微信。
