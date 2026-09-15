import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PATH_GET_BOT_QRCODE } from "../server/constants.js";
import {
  buildGetBotQrcodeRequest,
  buildSendMessageBody,
  buildSendMessageRequest,
  createIlinkClient,
  extractFinishedUserDms,
  newClientId,
  parseQrcodeStatus,
} from "../server/ilink.js";
import { acceptInboundDms, pollInbox } from "../server/inbox.js";
import { createStore, defaultHomeDir, isInsideDir } from "../server/store.js";
import { fixture, recordingTransport } from "./helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("QR request is POST /ilink/bot/get_bot_qrcode?bot_type=3", async () => {
  const qr = fixture("get-bot-qrcode.json");
  const transport = recordingTransport(async () => ({ status: 200, json: qr, text: JSON.stringify(qr) }));
  const client = createIlinkClient({ transport });
  const result = await client.requestBotQr({ localTokenList: [] });
  const req = transport.calls[0];
  assert.equal(req.method, "POST");
  assert.equal(req.path, PATH_GET_BOT_QRCODE);
  assert.match(req.url, /\/ilink\/bot\/get_bot_qrcode\?bot_type=3$/);
  assert.equal(JSON.parse(req.body).local_token_list.length, 0);
  assert.equal(result.qrcode, qr.qrcode);
  const built = buildGetBotQrcodeRequest({ localTokenList: ["tok"] });
  assert.equal(built.method, "POST");
  assert.equal(built.path, PATH_GET_BOT_QRCODE);
});

test("QR status confirmed yields token+ids; expired is distinguishable", () => {
  const confirmed = parseQrcodeStatus(fixture("qrcode-confirmed.json"));
  const expired = parseQrcodeStatus(fixture("qrcode-expired.json"));
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.loggedIn, true);
  assert.equal(confirmed.expired, false);
  assert.equal(confirmed.credentials.botToken, "44b9b8ec@im.bot:fixture-token");
  assert.equal(confirmed.credentials.ilinkBotId, "44b9b8ec@im.bot");
  assert.equal(confirmed.credentials.ilinkUserId, "o9cq809Lfixture@im.wechat");
  assert.equal(expired.status, "expired");
  assert.equal(expired.loggedIn, false);
  assert.equal(expired.expired, true);
  assert.notEqual(confirmed.expired, expired.expired);
  assert.notEqual(confirmed.loggedIn, expired.loggedIn);

  assert.equal(parseQrcodeStatus(fixture("qrcode-wait.json")).status, "wait");
  assert.equal(parseQrcodeStatus(fixture("qrcode-scaned.json")).status, "scaned");
  assert.equal(parseQrcodeStatus(fixture("qrcode-need-verifycode.json")).needsVerifyCode, true);
  assert.equal(parseQrcodeStatus(fixture("qrcode-scaned-but-redirect.json")).status, "scaned_but_redirect");
});

test("getupdates finished USER DM yields text, context_token, from_user_id; generating and bot do not", () => {
  const finished = extractFinishedUserDms(fixture("getupdates-finished-user.json"));
  assert.equal(finished.length, 1);
  assert.equal(finished[0].from_user_id, "o9cq80xxx@im.wechat");
  assert.equal(finished[0].text, "你好");
  assert.equal(finished[0].context_token, "AARzJWAF-fixture-context");

  assert.deepEqual(extractFinishedUserDms(fixture("getupdates-generating.json")), []);
  assert.deepEqual(extractFinishedUserDms(fixture("getupdates-bot.json")), []);

  const mixed = extractFinishedUserDms(fixture("getupdates-mixed.json"));
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].text, "mixed-ok");
  assert.equal(mixed[0].context_token, "AARzJWAF-mixed-ok");

  const voice = extractFinishedUserDms(fixture("getupdates-voice.json"));
  assert.equal(voice.length, 1);
  assert.equal(voice[0].text, "这是语音转写");
});

test("sendmessage JSON reuses inbound context_token and unique client_id", async () => {
  const inbound = extractFinishedUserDms(fixture("getupdates-finished-user.json"))[0];
  const a = buildSendMessageBody({
    toUserId: inbound.from_user_id,
    text: "pong",
    contextToken: inbound.context_token,
    clientId: newClientId(),
  });
  const b = buildSendMessageBody({
    toUserId: inbound.from_user_id,
    text: "pong",
    contextToken: inbound.context_token,
    clientId: newClientId(),
  });
  assert.equal(a.msg.context_token, inbound.context_token);
  assert.equal(b.msg.context_token, inbound.context_token);
  assert.notEqual(a.msg.client_id, b.msg.client_id);
  assert.match(a.msg.client_id, /^grok-clawbot-/);

  const transport = recordingTransport(async () => ({ status: 200, json: { ret: 0 }, text: "{\"ret\":0}" }));
  const client = createIlinkClient({ transport, token: "tok" });
  const sent = await client.sendText({
    toUserId: inbound.from_user_id,
    text: "pong",
    contextToken: inbound.context_token,
  });
  const body = JSON.parse(transport.calls[0].body);
  assert.equal(body.msg.context_token, inbound.context_token);
  assert.equal(body.msg.client_id, sent.client_id);
  assert.equal(transport.calls[0].url.endsWith("/ilink/bot/sendmessage"), true);

  const req = buildSendMessageRequest({
    toUserId: inbound.from_user_id,
    text: "pong",
    contextToken: inbound.context_token,
    clientId: "grok-clawbot-fixed",
    token: "tok",
  });
  assert.equal(JSON.parse(req.body).msg.context_token, inbound.context_token);
});

test("allowlist empty accepts; nonempty drops others", () => {
  const dms = extractFinishedUserDms(fixture("getupdates-finished-user.json"));
  const peer = dms[0].from_user_id;
  assert.equal(acceptInboundDms(dms, { allowFrom: [] }).length, 1);
  assert.equal(acceptInboundDms(dms, { allowFrom: [peer] }).length, 1);
  assert.equal(acceptInboundDms(dms, { allowFrom: ["someone-else@im.wechat"] }).length, 0);
});

test("credentials directory is not a tracked repo path", () => {
  const prev = process.env.GROK_CLAWBOT_HOME;
  delete process.env.GROK_CLAWBOT_HOME;
  try {
    const home = defaultHomeDir();
    assert.equal(isInsideDir(home, repoRoot), false);
    const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /\.grok-clawbot/);
  } finally {
    if (prev === undefined) delete process.env.GROK_CLAWBOT_HOME;
    else process.env.GROK_CLAWBOT_HOME = prev;
  }
});

test("pollInbox drives shipped extract+accept and POSTs wake once per accepted DM", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-"));
  const store = createStore(tmp);
  store.save({
    ...store.load(),
    bot_token: "tok",
    ilink_bot_id: "44b9b8ec@im.bot",
    ilink_user_id: "me@im.wechat",
  });
  store.saveWake("https://wake.example.invalid/hook", "secret");
  const finished = fixture("getupdates-finished-user.json");
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("/ilink/bot/getupdates")) {
      return { status: 200, json: finished, text: JSON.stringify(finished) };
    }
    if (String(req.url).includes("wake.example.invalid")) {
      return { status: 200, json: { ok: true }, text: "{\"ok\":true}" };
    }
    throw new Error(`unexpected url ${req.url}`);
  });
  const client = createIlinkClient({ transport, token: "tok" });
  const result = await pollInbox({ client, store });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, "你好");
  assert.equal(result.messages[0].context_token, "AARzJWAF-fixture-context");
  assert.equal(result.wake_posts.length, 1);
  assert.equal(result.wake_posts[0].request.method, "POST");
  assert.equal(result.wake_posts[0].request.url, "https://wake.example.invalid/hook");
  const wakeCalls = transport.calls.filter((c) => String(c.url).includes("wake.example.invalid"));
  assert.equal(wakeCalls.length, 1);
  assert.equal(store.load().context_tokens["o9cq80xxx@im.wechat"], "AARzJWAF-fixture-context");
});
