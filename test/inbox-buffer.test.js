import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractFinishedUserDms } from "../server/ilink.js";
import { createMcpHost } from "../server/mcp.js";
import { createStore } from "../server/store.js";
import { fixture, recordingTransport } from "./helpers.js";

function parseTool(result) {
  return JSON.parse(result.content[0].text);
}

test("cursor-once: first poll consumes getupdates; subsequent wechat_inbox still returns the DM", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-buf-"));
  const store = createStore(tmp);
  const finished = fixture("getupdates-finished-user.json");
  const expected = extractFinishedUserDms(finished)[0];
  store.save({
    ...store.load(),
    bot_token: "tok",
    ilink_bot_id: "44b9b8ec@im.bot",
    ilink_user_id: "me@im.wechat",
  });

  const empty = { ret: 0, msgs: [], get_updates_buf: finished.get_updates_buf };
  const transport = recordingTransport(async (req) => {
    if (String(req.url).includes("/ilink/bot/getupdates")) {
      const body = JSON.parse(req.body || "{}");
      if (!body.get_updates_buf) {
        return { status: 200, json: finished, text: JSON.stringify(finished) };
      }
      return { status: 200, json: empty, text: JSON.stringify(empty) };
    }
    throw new Error(`unexpected url ${req.url}`);
  });

  const host = createMcpHost({ store, transport });
  const polled = await host.runtime.poll();
  assert.equal(polled.messages.length, 1);
  assert.equal(polled.messages[0].text, expected.text);
  assert.equal(polled.messages[0].context_token, expected.context_token);
  assert.equal(store.load().get_updates_buf, finished.get_updates_buf);
  assert.equal(store.peekInboxCount(), 1);

  const getupdatesAfterPoll = transport.calls.filter((c) => String(c.url).includes("/ilink/bot/getupdates")).length;
  assert.equal(getupdatesAfterPoll, 1);

  const inbox = parseTool(await host.dispatch("wechat_inbox", {}));
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].from_user_id, expected.from_user_id);
  assert.equal(inbox.messages[0].text, expected.text);
  assert.equal(inbox.messages[0].context_token, expected.context_token);
  assert.equal(inbox.from_monitor, true);

  const getupdatesAfterInbox = transport.calls.filter((c) => String(c.url).includes("/ilink/bot/getupdates")).length;
  assert.equal(getupdatesAfterInbox, 1);
  assert.equal(store.peekInboxCount(), 0);

  const second = parseTool(await host.dispatch("wechat_inbox", {}));
  assert.equal(second.messages.length, 0);
  assert.equal(second.polled, false);
  const getupdatesAfterSecond = transport.calls.filter((c) => String(c.url).includes("/ilink/bot/getupdates")).length;
  assert.equal(getupdatesAfterSecond, 1);
});

test("empty wechat_inbox does not call getupdates", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-empty-"));
  const store = createStore(tmp);
  store.save({ ...store.load(), bot_token: "tok" });
  const transport = recordingTransport(async (req) => {
    throw new Error(`assistant turn must not hit iLink: ${req.url}`);
  });
  const host = createMcpHost({ store, transport });
  const inbox = parseTool(await host.dispatch("wechat_inbox", {}));
  assert.equal(inbox.messages.length, 0);
  assert.equal(inbox.polled, false);
  assert.equal(transport.calls.length, 0);
});
