import anchor from "@coral-xyz/anchor";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Chain, PROGRAM_ID, isRateLimited } from "./chain.js";

const { EventParser } = anchor;

export interface Stats {
  jobs: number;
  wallets: number;
  funded: string;
  payouts: number;
  silentYes: number;
  paidOnSilence: string;
  updatedAt: number;
}

interface State {
  newest: string | null;
  /** Set once the whole history has been read at least once. */
  complete?: boolean;
  jobs: number;
  wallets: string[];
  funded: string;
  payouts: number;
  silentYes: number;
  paidOnSilence: string;
}

/**
 * Counts what happened on-chain, read from the program's own events, so the
 * numbers on the landing page can be checked by anyone. Reads each
 * transaction once and remembers where it stopped.
 */
export class StatsIndexer {
  private state: State = {
    newest: null,
    jobs: 0,
    wallets: [],
    funded: "0",
    payouts: 0,
    silentYes: 0,
    paidOnSilence: "0",
  };
  private updatedAt = 0;

  constructor(
    private readonly chain: Chain,
    private readonly file: string,
  ) {
    try {
      this.state = { ...this.state, ...JSON.parse(readFileSync(file, "utf8")) };
      if (this.state.complete) this.updatedAt = Date.now();
    } catch {
      /* first run */
    }
  }

  get(): Stats {
    const s = this.state;
    return {
      jobs: s.jobs,
      wallets: s.wallets.length,
      funded: this.chain.fmt(BigInt(s.funded)),
      payouts: s.payouts,
      silentYes: s.silentYes,
      paidOnSilence: this.chain.fmt(BigInt(s.paidOnSilence)),
      updatedAt: this.updatedAt,
    };
  }

  /** Reads new program transactions, oldest first, at a pace public RPCs accept. */
  async update(): Promise<number> {
    const conn = this.chain.connection;
    const fresh: string[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await conn.getSignaturesForAddress(PROGRAM_ID, {
        before,
        until: this.state.newest ?? undefined,
        limit: 1000,
      });
      fresh.push(...page.filter((p) => !p.err).map((p) => p.signature));
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    const parser = new EventParser(PROGRAM_ID, this.chain.program.coder);
    const wallets = new Set(this.state.wallets);
    let done = 0;
    for (const sig of fresh.reverse()) {
      let tx;
      for (let i = 0; ; i++) {
        try {
          tx = await conn.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          break;
        } catch (e) {
          if (i >= 4 || !isRateLimited(e)) throw e;
          await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
        }
      }
      for (const e of parser.parseLogs(tx?.meta?.logMessages ?? [])) {
        const d = e.data as any;
        if (e.name === "jobCreated") {
          this.state.jobs++;
          wallets.add(d.client.toBase58());
          wallets.add(d.freelancer.toBase58());
        } else if (e.name === "milestoneFunded") {
          this.state.funded = (
            BigInt(this.state.funded) + BigInt(d.amount.toString())
          ).toString();
        } else if (e.name === "paid") {
          this.state.payouts++;
          if (d.outcome && "silence" in d.outcome) {
            this.state.silentYes++;
            this.state.paidOnSilence = (
              BigInt(this.state.paidOnSilence) +
              BigInt(d.toFreelancer.toString())
            ).toString();
          }
        }
      }
      this.state.newest = sig;
      this.state.wallets = [...wallets];
      if (++done % 50 === 0) this.save();
      await new Promise((r) => setTimeout(r, 700));
    }
    this.state.complete = true;
    this.save();
    this.updatedAt = Date.now();
    return done;
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state));
    } catch {
      /* counted again after a restart */
    }
  }
}
