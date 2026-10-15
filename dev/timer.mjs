#!/usr/bin/env node
// 세션 타이머. start 로 시작 시각을 기록하고 check 로 남은 시간을 확인한다.
// 사용법: node dev/timer.mjs start [--minutes 60] | check | reset
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".session",
);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    minutes: { type: "string", default: "40" },
    json: { type: "boolean", default: false },
  },
});
const [cmd] = positionals;
const out = (json, text) =>
  console.log(values.json ? JSON.stringify(json) : text);

switch (cmd) {
  case "start": {
    const s = {
      startedAt: new Date().toISOString(),
      minutes: Number(values.minutes),
    };
    fs.writeFileSync(file, JSON.stringify(s) + "\n");
    out(s, `timer started: ${s.minutes}min from ${s.startedAt}`);
    break;
  }
  case "check": {
    if (!fs.existsSync(file)) {
      out({ started: false }, "timer not started (node dev/timer.mjs start)");
      process.exit(2);
    }
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    const elapsed = (Date.now() - Date.parse(s.startedAt)) / 60000;
    const left = s.minutes - elapsed;
    const expired = left <= 0;
    out(
      {
        started: true,
        ...s,
        elapsedMinutes: Math.floor(elapsed),
        leftMinutes: Math.max(0, Math.ceil(left)),
        expired,
      },
      expired
        ? `EXPIRED (${Math.floor(elapsed)}min elapsed). 새 작업을 시작하지 말고 진행 중인 작업만 마무리하라`
        : `${Math.ceil(left)}min left (${Math.floor(elapsed)}min elapsed)`,
    );
    process.exit(expired ? 1 : 0);
  }
  case "reset":
    fs.rmSync(file, { force: true });
    out({ reset: true }, "timer reset");
    break;
  default:
    console.log(
      "사용법: node dev/timer.mjs start [--minutes 60] | check | reset",
    );
    process.exit(cmd ? 2 : 0);
}
