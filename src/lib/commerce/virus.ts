import "server-only";
import net from "net";
import crypto from "crypto";
import type { VirusScanResult } from "./types";

/**
 * Virus scanning (فاز ۴).
 *
 * 1. If CLAMAV_HOST is configured → real clamd INSTREAM scan over TCP.
 * 2. Otherwise → built-in heuristics: known-bad signatures (EICAR, common
 *    exploit markers) + extension/magic sanity. Result engine is labelled
 *    honestly ("clamd" vs "builtin") so the admin panel never lies.
 */

const CLAM_TIMEOUT_MS = 8000;

const BAD_SIGNATURES: Array<{ name: string; pattern: Buffer | RegExp }> = [
  { name: "EICAR-Test", pattern: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*") },
  { name: "PHP-WebShell", pattern: /<\?php\s+(?:eval|assert|system|exec|passthru)\s*\(/i },
  { name: "JS-Dropper", pattern: /new\s+Function\s*\(\s*['"]return\s+eval/ },
  { name: "Shell-Script", pattern: /^#!\/bin\/(?:ba)?sh\s*\n(?:curl|wget|chmod\s\+777)/ },
];

function clamdScan(buf: Buffer, host: string, port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.setTimeout(CLAM_TIMEOUT_MS, () => done(false, "timeout"));
    socket.once("error", (e) => done(false, `socket: ${e.message}`));

    socket.connect(port, host, () => {
      // INSTREAM protocol: zINSTREAM\\0 then [4-byte BE length][chunk]… [0]
      const chunks: Buffer[] = [];
      chunks.push(Buffer.from("zINSTREAM\0", "ascii"));
      const CHUNK = 64 * 1024;
      for (let off = 0; off < buf.length; off += CHUNK) {
        const part = buf.subarray(off, off + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        chunks.push(len, part);
      }
      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      chunks.push(end);
      socket.write(Buffer.concat(chunks));
    });

    let acc = "";
    socket.on("data", (d) => {
      acc += d.toString("utf8");
      if (acc.includes("OK")) done(true, "clamd: OK");
      else if (acc.includes("FOUND")) done(false, `clamd: ${acc.trim()}`);
      else if (acc.includes("ERROR")) done(false, `clamd: ${acc.trim()}`);
    });
    socket.once("close", () => done(false, acc.trim() || "closed"));
  });
}

function builtinScan(buf: Buffer, filename: string): { ok: boolean; detail: string } {
  const head = buf.subarray(0, Math.min(buf.length, 512 * 1024));
  for (const sig of BAD_SIGNATURES) {
    const p: Buffer | RegExp = sig.pattern;
    const hit =
      p instanceof RegExp
        ? p.test(head.toString("latin1"))
        : head.includes(p) || buf.includes(p);
    if (hit) return { ok: false, detail: `signature: ${sig.name}` };
  }
  // .exe / .dll masquerading under an image extension
  if (/^MZ/.test(head.toString("latin1")) && /\.(jpg|png|webp|pdf)$/i.test(filename)) {
    return { ok: false, detail: "pe-binary with document extension" };
  }
  return { ok: true, detail: "builtin heuristics: clean" };
}

export async function scanBuffer(buf: Buffer, filename: string): Promise<VirusScanResult> {
  const at = new Date().toISOString();
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT ?? 3310);

  if (host) {
    try {
      const r = await clamdScan(buf, host, port);
      return { status: r.ok ? "clean" : "infected", engine: "clamd", detail: r.detail, at };
    } catch (e) {
      // clamd unreachable — degrade to builtin but say so
      const fallback = builtinScan(buf, filename);
      return {
        status: fallback.ok ? "clean" : "infected",
        engine: "builtin",
        detail: `clamd unreachable (${(e as Error).message}); ${fallback.detail}`,
        at,
      };
    }
  }

  const r = builtinScan(buf, filename);
  return { status: r.ok ? "clean" : "infected", engine: "builtin", detail: r.detail, at };
}

/** Random multipart upload id. */
export const newUploadId = () => `upl_${crypto.randomBytes(10).toString("hex")}`;
