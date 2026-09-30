import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_TEXT_BYTES = 4000;

export const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Terms, deliveries and reasons live here; only their SHA-256 goes on-chain.
 * A text is kept for good only once a transaction references its hash, so
 * nobody can flood the store or push out texts that are on record.
 */
export class TextStore {
  private kept = new Map<string, string>();
  private pending = new Map<string, { text: string; at: number }>();

  constructor(
    private readonly file: string,
    private readonly maxPending = 5000,
    private readonly pendingMs = 2 * 3_600_000,
  ) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        const { h, t } = JSON.parse(line) as { h: string; t: string };
        if (sha256(t) === h) this.kept.set(h, t);
      }
    } catch {
      /* first start */
    }
  }

  put(text: string): string {
    const hash = sha256(text);
    if (this.kept.has(hash)) return hash;
    const now = Date.now();
    for (const [h, p] of this.pending)
      if (now - p.at > this.pendingMs || this.pending.size >= this.maxPending)
        this.pending.delete(h);
      else break;
    this.pending.set(hash, { text, at: now });
    return hash;
  }

  /** Call with hashes read from the chain. */
  confirm(hash: string | null) {
    if (!hash || this.kept.has(hash)) return;
    const p = this.pending.get(hash);
    if (!p) return;
    this.pending.delete(hash);
    this.kept.set(hash, p.text);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify({ h: hash, t: p.text }) + "\n");
    } catch {
      /* kept in memory until restart */
    }
  }

  get(hash: string | null): string | null {
    if (!hash) return null;
    return this.kept.get(hash) ?? this.pending.get(hash)?.text ?? null;
  }
}
