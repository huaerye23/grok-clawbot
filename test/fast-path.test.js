import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PATH_GET_CONFIG, PATH_SEND_TYPING, TYPING } from "../server/constants.js";
import { buildGetConfigRequest, buildSendTypingRequest, extractFinishedUserDms } from "../server/ilink.js";
import { buildWakePost, pollInbox } from "../server/inbox.js";
import { createIlinkClient } from "../server/ilink.js";
import { createMcpHost } from "../server/mcp.js";
import { createRuntime } from "../server/runtime.js";
import { createStore } from "../server/store.js";
import { fixture, recordingTransport } from "./helpers.js";

function parseTool(result) {
  return JSON.parse(result.content[0].text);
}

test("wake POST carries DM so the woken assistant can send without inbox", async () => {
  const finished = fixture("getupdates-finished-user.json");
  const expected = extractFinishedUserDms(finished)[0];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-wake-"));
  const store = createStore(tmp);
  store.save({
    ...store.load(),
    bot_token: "tok",
    ilink_bot_id: "44b9b8ec@im.bot",
    ilink_user_id: "me@im.wechat",
  });
  store.saveWake("https://wake.example.invalid/hook", "secret");
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("/ilink/bot/getupdates")) {
      return { status: 200, json: finished, text: JSON.stringify(finished) };
    }
    if (String(req.url).includes("wake.example.invalid")) {
      return { status: 200, json: { ok: true }, text: "{\"ok\":true}" };
    }
    throw new Error(`unexpected ${req.url}`);
  });
  await pollInbox({ client: createIlinkClient({ transport, token: "tok" }), store });
  const wakeReq = transport.calls.find((c) => String(c.url).includes("wake.example.invalid"));
  const body = JSON.parse(wakeReq.body);
  assert.equal(body.reply_now, true);
  assert.equal(body.from_user_id, expected.from_user_id);
  assert.equal(body.to_user_id, expected.from_user_id);
  assert.equal(body.text, expected.text);
  assert.equal(body.context_token, expected.context_token);
  assert.ok(body.instruction);
  assert.match(body.instruction, /0 model tokens/);

  const built = buildWakePost({ url: "https://wake.example.invalid/hook", key: "k" }, expected);
  assert.equal(JSON.parse(built.body).reply_now, true);
});

test("typing builders hit getconfig and sendtyping; runtime caches ticket", async () => {
  const cfg = buildGetConfigRequest({
    ilinkUserId: "o9cq80xxx@im.wechat",
    contextToken: "tok",
    token: "bot",
  });
  assert.equal(cfg.method, "POST");
  assert.equal(cfg.path, PATH_GET_CONFIG);
  const typing = buildSendTypingRequest({
    ilinkUserId: "o9cq80xxx@im.wechat",
    typingTicket: "ticket-1",
    on: true,
    token: "bot",
  });
  assert.equal(typing.path, PATH_SEND_TYPING);
  assert.equal(JSON.parse(typing.body).status, TYPING.ON);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-typ-"));
  const store = createStore(tmp);
  store.save({
    ...store.load(),
    bot_token: "bot",
    context_tokens: { "o9cq80xxx@im.wechat": "ctx" },
  });
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("getconfig")) {
      return { status: 200, json: { ret: 0, typing_ticket: "ticket-1" }, text: "{\"typing_ticket\":\"ticket-1\"}" };
    }
    if (String(req.url).includes("sendtyping")) {
      return { status: 200, json: { ret: 0 }, text: "{\"ret\":0}" };
    }
    throw new Error(`unexpected ${req.url}`);
  });
  const rt = createRuntime({ store, transport });
  const on = await rt.setTyping({ to_user_id: "o9cq80xxx@im.wechat", on: true });
  assert.equal(on.typing, true);
  await rt.setTyping({ to_user_id: "o9cq80xxx@im.wechat", on: false });
  const configs = transport.calls.filter((c) => String(c.url).includes("getconfig"));
  const typings = transport.calls.filter((c) => String(c.url).includes("sendtyping"));
  assert.equal(configs.length, 1);
  assert.equal(typings.length, 2);
  assert.equal(JSON.parse(typings[1].body).status, TYPING.OFF);
});

test("MCP tool list includes typing for the Grok Bot latency path", () => {
  const names = createMcpHost({
    store: createStore(fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-tools-"))),
  }).toolList().map((t) => t.name);
  assert.ok(names.includes("wechat_typing"));
  assert.ok(names.includes("wechat_start_monitor"));
});
