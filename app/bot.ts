import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { randomBytes } from "node:crypto";
import { Chain, FINAL, trimOldest, type JobView } from "./chain.js";
import type { TextStore } from "./store.js";

const DEMO_REVIEW = 90;
const DEMO_WINDOW = 120;

async function jobCache(chain: Chain) {
  const jobs = new Map<string, JobView | null>();
  return async (key: PublicKey) => {
    const k = key.toBase58();
    if (!jobs.has(k)) jobs.set(k, await chain.getJob(key));
    return jobs.get(k) ?? null;
  };
}

/**
 * Both payouts are permissionless, so any funded key can trigger them.
 * Only milestones created through this app are cranked: otherwise anyone
 * could make the app pay rent for fresh token accounts, without limit.
 * Also returns in how many seconds the next one falls due.
 */
export async function crank(
  chain: Chain,
  key: Keypair,
  ours: PublicKey[],
): Promise<{ done: number; nextDue: number }> {
  const now = await chain.chainNow();
  const job = await jobCache(chain);
  const payers = new Set(ours.map((k) => k.toBase58()));
  let done = 0;
  let nextDue = Infinity;
  for (const { m, job: jobKey, rentPayer } of await chain.milestonesWhere({
    statuses: ["submitted", "disputed"],
  })) {
    if (!payers.has(rentPayer.toBase58())) continue;
    const j = await job(jobKey);
    if (!j || j.mint !== chain.mint.toBase58()) continue;
    const last = j.arbiter ? m.arbiterDeadline : m.negotiateDeadline;
    const method =
      m.status === "submitted" && now > m.reviewDeadline
        ? "releaseOnSilence"
        : m.status === "disputed" && now > last
          ? "fallbackSplit"
          : null;
    if (!method) {
      const due = m.status === "submitted" ? m.reviewDeadline : last;
      nextDue = Math.min(nextDue, due + 1 - now);
      continue;
    }
    try {
      const b = await chain.buildPayout(method, key.publicKey, jobKey, m.index);
      await chain.send({ ...b, feePayer: key.publicKey, signers: [] }, [key]);
      done++;
    } catch (e) {
      console.warn(`crank ${method} ${m.address}: ${(e as Error).message}`);
    }
  }
  return { done, nextDue };
}

/** Closes milestones (and then jobs) whose rent `key` paid, once kept long enough. */
export async function reclaimRent(
  chain: Chain,
  key: Keypair,
  keepSecs: number,
): Promise<number> {
  const now = await chain.chainNow();
  const job = await jobCache(chain);
  let closed = 0;
  for (const { m, job: jobKey } of await chain.milestonesWhere({
    rentPayer: key.publicKey,
  })) {
    if (!FINAL.includes(m.status) || now < m.settledAt + keepSecs) continue;
    const j = await job(jobKey);
    if (!j) continue;
    try {
      const client = new PublicKey(j.client);
      const ixs = [
        // Closing sends stray tokens to the client, whose account may be gone.
        createAssociatedTokenAccountIdempotentInstruction(
          key.publicKey,
          chain.ata(client),
          client,
          chain.mint,
        ),
        await chain.buildCloseMilestone(j, m, key.publicKey),
      ];
      if (j.openMilestones === 1 && j.rentPayer === key.publicKey.toBase58())
        ixs.push(await chain.buildCloseJob(j));
      await chain.send({ ixs, feePayer: key.publicKey, signers: [] }, [key]);
      j.openMilestones--;
      closed++;
    } catch (e) {
      console.warn(`reclaim ${m.address}: ${(e as Error).message}`);
    }
  }
  return closed;
}

/** The other side for visitors trying the app alone (test networks only). */
export class DemoCounterpart {
  constructor(
    private readonly chain: Chain,
    readonly key: Keypair,
    private readonly mintAuthority: Keypair,
    private readonly texts: TextStore,
  ) {}

  get address() {
    return this.key.publicKey.toBase58();
  }

  async mintTest(owner: PublicKey, whole: bigint) {
    const auth = this.mintAuthority;
    const ata = this.chain.ata(owner);
    return this.chain.send(
      {
        ixs: [
          createAssociatedTokenAccountIdempotentInstruction(
            auth.publicKey,
            ata,
            owner,
            this.chain.mint,
          ),
          createMintToInstruction(
            this.chain.mint,
            ata,
            auth.publicKey,
            whole * 10n ** BigInt(this.chain.decimals),
          ),
        ],
        feePayer: auth.publicKey,
        signers: [],
      },
      [auth],
    );
  }

  private lastReason(hash: string | null) {
    const t = this.texts.get(hash);
    return t ? `"${t.slice(0, 120)}"` : "see the change request";
  }

  async hire(freelancer: PublicKey) {
    const amount = 25n * 10n ** BigInt(this.chain.decimals);
    await this.mintTest(this.key.publicKey, 25n);
    const now = await this.chain.chainNow();
    const terms = [
      "Demo job by Stillpaid Demo Studio.",
      "Scope: write a two-line tagline for a bakery's website.",
      `Payment: 25 test ${this.chain.symbol} into escrow before work starts.`,
      "Review: 90 seconds. If the client says nothing, the delivery counts as accepted.",
      "If a dispute is not settled in time, it is split 50/50.",
    ].join("\n");
    const termsHash = this.texts.put(terms);
    const b = await this.chain.buildCreate(this.key.publicKey, {
      jobId: randomBytes(8).readBigUInt64LE(),
      freelancer,
      arbiter: null,
      windows: {
        review: DEMO_REVIEW,
        fix: DEMO_WINDOW,
        negotiate: DEMO_WINDOW,
        arbiter: DEMO_WINDOW,
      },
      maxRevisions: 1,
      fallbackBps: 5000,
      termsHash: [...Buffer.from(termsHash, "hex")],
      title: "Bakery tagline (demo)",
      milestones: [{ title: "Tagline", amount, deadline: now + 3600 }],
    });
    await this.chain.send(b, [this.key]);
    this.texts.confirm(termsHash);
    return b.job;
  }

  private watched = new Map<string, number>();
  private discoveredAt = 0;

  watch(job: PublicKey) {
    if (this.watched.has(job.toBase58())) return;
    this.watched.set(job.toBase58(), Date.now());
    trimOldest(this.watched, 200);
  }

  /** Full scans are expensive on public RPCs: only once a minute, else the watched jobs. */
  private async discover() {
    if (Date.now() - this.discoveredAt < 60_000) return;
    this.discoveredAt = Date.now();
    // Only jobs created through this app: others could flood the watch list.
    for (const j of await this.chain.jobsOf(this.key.publicKey))
      if (
        j.freelancer === this.address &&
        this.chain.isServerKey(new PublicKey(j.rentPayer))
      )
        this.watch(new PublicKey(j.address));
  }

  async tick(): Promise<void> {
    await this.discover();
    const now = await this.chain.chainNow();
    const addresses = [...this.watched.keys()];
    const jobs = await this.chain.getJobs(addresses.map((a) => new PublicKey(a)));
    for (const [i, address] of addresses.entries()) {
      const jobKey = new PublicKey(address);
      const job = jobs[i];
      if (!job) {
        if (Date.now() - (this.watched.get(address) ?? 0) > 120_000)
          this.watched.delete(address);
        continue;
      }
      if (!job.accepted) {
        await this.try(address, async () =>
          this.chain.send(
            await this.chain.buildAccept(this.key.publicKey, jobKey),
            [this.key],
          ),
        );
        continue;
      }
      const milestones = await this.chain.milestones(job);
      if (milestones.every((m) => FINAL.includes(m.status))) {
        this.watched.delete(address);
        continue;
      }
      for (const m of milestones) {
        await this.try(m.address, async () => {
          if (m.status === "funded" && now <= m.deliveryDeadline) {
            const v = m.submissions + 1;
            const hash = this.texts.put(
              v === 1
                ? `Delivery for "${m.title}", version 1.\nPreview: https://example.com/bakery/preview-1 (demo link)\nHeadline: "Fresh from the oven, every morning."`
                : `Delivery for "${m.title}", version ${v}.\nChanged as requested: ${this.lastReason(m.reasonHash)}\nPreview: https://example.com/bakery/preview-${v} (demo link)`,
            );
            await this.chain.send(
              await this.chain.buildAct(
                "submit",
                this.key.publicKey,
                jobKey,
                m.index,
                [...Buffer.from(hash, "hex")],
              ),
              [this.key],
            );
            this.texts.confirm(hash);
          } else if (m.status === "disputed") {
            if (m.proposalBy === "client" && m.proposalBps >= 5000)
              await this.chain.send(
                await this.chain.buildPayout(
                  "acceptSplit",
                  this.key.publicKey,
                  jobKey,
                  m.index,
                  m.proposalBps,
                ),
                [this.key],
              );
            else if (m.proposalBy !== "freelancer")
              await this.chain.send(
                await this.chain.buildAct(
                  "proposeSplit",
                  this.key.publicKey,
                  jobKey,
                  m.index,
                  6000,
                ),
                [this.key],
              );
          }
        });
      }
    }
  }

  private async try(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      console.warn(`demo ${what}: ${(e as Error).message}`);
    }
  }
}
