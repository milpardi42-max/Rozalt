#!/usr/bin/env node
/** Extract sigOk / sigNok from cashier HTML (handles RSC-escaped payloads). */
import fs from "node:fs";

const file = process.argv[2];
const which = process.argv[3] || "sigOk";
const html = fs.readFileSync(file, "utf8");
const key = which === "sigNok" ? "sigNok" : "sigOk";
const pats = [
  new RegExp(key + '\\\\":\\\\"([A-Za-z0-9_-]+)'),
  new RegExp(key + '\\":\\"([A-Za-z0-9_-]+)'),
  new RegExp('"' + key + '":"([A-Za-z0-9_-]+)'),
  new RegExp(key + "=([A-Za-z0-9_-]+)"),
];
for (const p of pats) {
  const m = html.match(p);
  if (m && m[1]) {
    process.stdout.write(m[1]);
    process.exit(0);
  }
}
process.stdout.write("");
