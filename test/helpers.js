import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

export function recordingTransport(handler) {
  const calls = [];
  const transport = async (req) => {
    calls.push(req);
    return handler(req, calls);
  };
  transport.calls = calls;
  return transport;
}
