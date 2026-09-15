import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PATH_GET_BOT_QRCODE } from "../server/constants.js";
import { createRuntime } from "../server/runtime.js";
import { createStore } from "../server/store.js";
import { fixture, recordingTransport } from "./helpers.js";

test("runtime loginStart hits shipped QR path; loginWait confirmed persists token outside git", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-rt-"));
  const store = createStore(tmp);
  const qr = fixture("get-bot-qrcode.json");
  const confirmed = fixture("qrcode-confirmed.json");
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("get_bot_qrcode")) {
      return { status: 200, json: qr, text: JSON.stringify(qr) };
    }
    if (String(req.url).includes("get_qrcode_status")) {
      return { status: 200, json: confirmed, text: JSON.stringify(confirmed) };
    }
    throw new Error(`unexpected ${req.url}`);
  });
  const rt = createRuntime({ store, transport });
  const started = await rt.loginStart();
  assert.equal(started.qrcode, qr.qrcode);
  assert.equal(transport.calls[0].method, "POST");
  assert.equal(transport.calls[0].path, PATH_GET_BOT_QRCODE);
  const waited = await rt.loginWait({ timeout_ms: 0 });
  assert.equal(waited.logged_in, true);
  assert.equal(waited.ilink_bot_id, confirmed.ilink_bot_id);
  const state = store.load();
  assert.equal(state.bot_token, confirmed.bot_token);
  assert.equal(state.ilink_bot_id, confirmed.ilink_bot_id);
  assert.ok(store.home.startsWith(os.tmpdir()) || store.home.includes("grok-clawbot-rt"));
  assert.equal(path.basename(store.home).startsWith("grok-clawbot-rt"), true);
});

test("runtime send uses inbound context_token; expired loginWait is not confirmed", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-rt2-"));
  const store = createStore(tmp);
  const finished = fixture("getupdates-finished-user.json");
  const inbound = finished.msgs[0];
  store.save({
    ...store.load(),
    bot_token: "tok",
    ilink_bot_id: "bot",
    context_tokens: { [inbound.from_user_id]: inbound.context_token },
  });
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("sendmessage")) {
      return { status: 200, json: { ret: 0 }, text: "{\"ret\":0}" };
    }
    if (String(req.url).includes("get_qrcode_status")) {
      return { status: 200, json: fixture("qrcode-expired.json"), text: "{\"status\":\"expired\"}" };
    }
    throw new Error(`unexpected ${req.url}`);
  });
  const rt = createRuntime({ store, transport });
  const sent = await rt.send({ text: "hi", to_user_id: inbound.from_user_id });
  assert.equal(sent.context_token, inbound.context_token);
  const body = JSON.parse(transport.calls[0].body);
  assert.equal(body.msg.context_token, inbound.context_token);
  assert.ok(body.msg.client_id);

  store.update((s) => {
    s.pending_qr = { qrcode: "x", image: "", at: Date.now() };
    return s;
  });
  const expired = await rt.loginWait({ timeout_ms: 0 });
  assert.equal(expired.expired, true);
  assert.equal(expired.logged_in, false);
});

test("pollInbox drops allowlisted-out senders and does not wake", async () => {
  const { pollInbox } = await import("../server/inbox.js");
  const { createIlinkClient } = await import("../server/ilink.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-al-"));
  const store = createStore(tmp);
  store.save({
    ...store.load(),
    bot_token: "tok",
    allow_from: ["nobody@im.wechat"],
  });
  store.saveWake("https://wake.example.invalid/hook", "k");
  const finished = fixture("getupdates-finished-user.json");
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("getupdates")) {
      return { status: 200, json: finished, text: JSON.stringify(finished) };
    }
    throw new Error(`wake should not fire: ${req.url}`);
  });
  const result = await pollInbox({
    client: createIlinkClient({ transport, token: "tok" }),
    store,
  });
  assert.equal(result.messages.length, 0);
  assert.equal(result.wake_posts.length, 0);
});
