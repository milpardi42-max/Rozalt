import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { EMPTY_DB, type CommerceDB } from "./types";

/**
 * Commerce store — same dual-backend pattern as orders/users:
 *   1. Upstash Redis  (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 *   2. Local file     data/commerce.json   (git-ignored via /data/*.json)
 *
 * Read-modify-write with a module-level mutex so concurrent API routes
 * (payment callback ⇄ admin review) never interleave partial writes.
 */

const KEY = "rosie-atelier:commerce";
const FILE = path.join(process.cwd(), "data", "commerce.json");

let queue: Promise<unknown> = Promise.resolve();

/** Serialize all mutations through a single chain. */
export function withDb<T>(fn: (db: CommerceDB) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Read-only access (no write, no mutex needed). */
export async function readDb(): Promise<CommerceDB> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(json) as Partial<CommerceDB>;
    return { ...EMPTY_DB, ...parsed };
  } catch {
    return { ...EMPTY_DB, masters: [], payments: [], purchases: [], licenses: [], royalties: [], settlements: [], discounts: [], subscribers: [], uploads: [], outbox: [] };
  }
}

async function writeDb(db: CommerceDB): Promise<void> {
  if (process.env.NODE_ENV === "production" && redisEnabled()) {
    await redisCmd(["SET", KEY, JSON.stringify(db)]);
    return;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf8");
}

async function readDbWithRedis(): Promise<CommerceDB> {
  if (process.env.NODE_ENV === "production" && redisEnabled()) {
    try {
      const { result } = await redisCmd(["GET", KEY]);
      if (typeof result === "string") {
        const parsed = JSON.parse(result) as Partial<CommerceDB>;
        return { ...EMPTY_DB, ...parsed };
      }
    } catch { /* fall through to file */ }
  }
  return readDb();
}

function redisEnabled() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisCmd(args: string[]) {
  const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()) as { result: unknown };
}

/** Use redis-aware read inside withDb when in production. */
export async function loadDb(): Promise<CommerceDB> {
  return readDbWithRedis();
}

/* ── id helpers ─────────────────────────────────────────────────── */

export const newId = (prefix: string) =>
  `${prefix}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

export const nowIso = () => new Date().toISOString();
