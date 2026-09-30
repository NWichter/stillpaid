import anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { AnchorProvider, EventParser, Program, Wallet, BN } = anchor;
const bs58 = anchor.utils.bytes.bs58;

export const PROGRAM_ID = new PublicKey(
  "2gbyeNrQm2869HMK2mnSJyHc4cQfDrAGh6dk5ccoVyg4",
);
const IDL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../anchor/target/idl/stillpaid.json",
);

export const MIN_WINDOW_SECS = 60;
export const MAX_WINDOW_SECS = 90 * 24 * 60 * 60;
export const MAX_DELIVERY_SECS = 365 * 24 * 60 * 60;
export const MAX_REVISIONS = 10;
export const MAX_MILESTONES = 20;
/** More add_milestone instructions do not fit into one transaction. */
export const MILESTONES_PER_TX = 3;
export const U64_MAX = 2n ** 64n - 1n;
const NO_KEY = PublicKey.default.toBase58();

export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type Status =
  | "funded"
  | "submitted"
  | "disputed"
  | "released"
  | "settled"
  | "resolved"
  | "refunded";
export type Role = "client" | "freelancer" | "arbiter";
export const FINAL: Status[] = ["released", "settled", "resolved", "refunded"];

export interface Windows {
  review: number;
  fix: number;
  negotiate: number;
  arbiter: number;
}

export interface MilestoneView {
  address: string;
  index: number;
  title: string;
  amount: string;
  status: Status;
  deliveryDeadline: number;
  reviewDeadline: number;
  negotiateDeadline: number;
  arbiterDeadline: number;
  revisions: number;
  submissions: number;
  deliverableHash: string | null;
  reasonHash: string | null;
  disputedBy: "client" | "freelancer" | null;
  proposalBy: "client" | "freelancer" | null;
  proposalBps: number;
  paidFreelancer: string;
  paidClient: string;
  settledAt: number;
}

export interface JobView {
  address: string;
  client: string;
  freelancer: string;
  arbiter: string | null;
  mint: string;
  jobId: string;
  windows: Windows;
  maxRevisions: number;
  accepted: boolean;
  milestoneCount: number;
  openMilestones: number;
  fallbackBps: number;
  rentPayer: string;
  termsHash: string;
  title: string;
}

export interface HistoryEntry {
  signature: string;
  slot: number;
  time: number | null;
  event: string;
  outcome?: string;
}

export interface Built {
  ixs: TransactionInstruction[];
  feePayer: PublicKey;
  signers: Keypair[];
}

const u64 = (v: unknown) => BigInt(String(v)).toString();
const num = (v: unknown) => Number(String(v));
const hex = (a: number[] | Uint8Array) => Buffer.from(a).toString("hex");
const hashOrNull = (a: number[]) => (a.every((b) => b === 0) ? null : hex(a));
const roleName = (r: object) => {
  const k = Object.keys(r)[0];
  return k === "client" || k === "freelancer" ? k : null;
};

/** Drops the least recently set entries, so a flood never wipes everyone's state. */
export function trimOldest<K, V>(map: Map<K, V>, max: number) {
  for (const k of map.keys()) {
    if (map.size <= max) break;
    map.delete(k);
  }
}

/** Public RPCs answer 429 under load; such errors are worth a retry. */
export const isRateLimited = (e: unknown) =>
  /429|Too Many Requests|rate limit/i.test(
    String((e as Error)?.message ?? e),
  );

export function parsePubkey(value: unknown, what = "account"): PublicKey {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    throw new UserError(`Invalid ${what}: expected a Solana address.`);
  try {
    return new PublicKey(value);
  } catch {
    throw new UserError(`Invalid ${what}: expected a Solana address.`);
  }
}

export function parseSecretKey(value: string): Keypair {
  const v = value.trim();
  return Keypair.fromSecretKey(
    v.startsWith("[") ? Uint8Array.from(JSON.parse(v)) : bs58.decode(v),
  );
}

export function parseHash(value: unknown): number[] {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new UserError("Invalid fingerprint.");
  return [...Buffer.from(value, "hex")];
}

export function formatUnits(amount: bigint | string, decimals: number): string {
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  let frac = decimals
    ? (v % base).toString().padStart(decimals, "0").replace(/0+$/, "")
    : "";
  if (frac.length === 1) frac += "0";
  return `${v / base}${frac ? `.${frac}` : ""}`;
}

export function parseUnits(value: string, decimals: number): bigint | null {
  const s = value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(frac.padEnd(decimals, "0") || "0")
  );
}

/** Mirrors the program: who may do what right now. */
export function allowedActions(
  job: JobView,
  m: MilestoneView,
  role: Role | null,
  now: number,
): string[] {
  const out: string[] = [];
  const s = m.status;
  if (s === "funded") {
    if (role === "freelancer" && job.accepted && now <= m.deliveryDeadline)
      out.push("submit");
    if (role === "freelancer" && m.revisions > 0 && now <= m.deliveryDeadline)
      out.push("dispute");
    if (role === "client" && (!job.accepted || now > m.deliveryDeadline))
      out.push("refund");
  }
  if (s === "submitted") {
    if (now > m.reviewDeadline) out.push("release");
    else if (role === "client") {
      out.push("approve");
      if (m.revisions < job.maxRevisions) out.push("revision");
      out.push("dispute");
    }
  }
  if (s === "disputed") {
    if (role === "client" || role === "freelancer") {
      out.push("propose");
      if (m.proposalBy && m.proposalBy !== role) out.push("acceptSplit");
    }
    if (role === "arbiter" && now > m.negotiateDeadline) out.push("resolve");
    const last = job.arbiter ? m.arbiterDeadline : m.negotiateDeadline;
    if (now > last) out.push("fallback");
  }
  return out;
}

export function messageHash(tx: Transaction): string {
  return createHash("sha256").update(tx.serializeMessage()).digest("hex");
}

export function roleOf(job: JobView, wallet?: string | null): Role | null {
  if (!wallet) return null;
  if (wallet === job.client) return "client";
  if (wallet === job.freelancer) return "freelancer";
  if (wallet === job.arbiter) return "arbiter";
  return null;
}

export class Chain {
  readonly connection: Connection;
  readonly program: InstanceType<typeof Program>;
  readonly mint: PublicKey;
  readonly symbol: string;
  readonly sponsor?: Keypair;
  decimals = 6;
  private nowCache = { at: 0, value: 0 };
  private errorMessages = new Map<number, string>();
  private readonly sponsorLimits = new SponsorLimits(
    Number(process.env.SPONSOR_PER_WALLET_PER_HOUR ?? 20),
    Number(process.env.SPONSOR_PER_DAY ?? 500),
  );

  constructor(
    rpcUrl: string,
    opts: { mint: PublicKey; symbol?: string; sponsor?: Keypair },
  ) {
    this.mint = opts.mint;
    this.symbol = opts.symbol ?? "USDC";
    this.sponsor = opts.sponsor;
    this.connection = new Connection(rpcUrl, "confirmed");
    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    for (const e of idl.errors ?? []) this.errorMessages.set(e.code, e.msg);
    this.program = new Program(
      idl,
      new AnchorProvider(this.connection, new Wallet(Keypair.generate()), {
        commitment: "confirmed",
      }),
    );
  }

  private get methods(): any {
    return this.program.methods;
  }

  async init() {
    const info = await this.connection.getAccountInfo(this.mint);
    if (!info) throw new Error(`Mint ${this.mint.toBase58()} not found`);
    if (!info.owner.equals(TOKEN_PROGRAM_ID))
      throw new Error("MINT must be a classic SPL Token mint (not Token-2022)");
    this.decimals = (await getMint(this.connection, this.mint)).decimals;
  }

  fmt(v: bigint | string) {
    return formatUnits(v, this.decimals);
  }

  /**
   * Quota is only checked here and counted once the transaction lands
   * (`recordSponsored`), so requests that are never sent cost nobody anything.
   * Deadline-critical actions skip the per-wallet cap: a counterparty must not
   * be able to use up someone's quota right before their deadline.
   */
  payerFor(
    account: PublicKey,
    critical = false,
  ): Pick<Built, "feePayer" | "signers"> {
    return this.sponsor && this.sponsorLimits.can(account.toBase58(), critical)
      ? { feePayer: this.sponsor.publicKey, signers: [this.sponsor] }
      : { feePayer: account, signers: [] };
  }

  canSponsor(wallet: string, critical: boolean) {
    return !!this.sponsor && this.sponsorLimits.can(wallet, critical);
  }

  signAsSponsor(tx: Transaction) {
    if (this.sponsor) tx.partialSign(this.sponsor);
  }

  recordSponsored(wallet: string) {
    this.sponsorLimits.record(wallet);
  }

  isServerKey(account: PublicKey) {
    return !!this.sponsor && account.equals(this.sponsor.publicKey);
  }

  jobPda(client: PublicKey, jobId: bigint) {
    const id = Buffer.alloc(8);
    id.writeBigUInt64LE(jobId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("job"), client.toBuffer(), id],
      PROGRAM_ID,
    )[0];
  }

  milestonePda(job: PublicKey, index: number) {
    const i = Buffer.alloc(2);
    i.writeUInt16LE(index);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("milestone"), job.toBuffer(), i],
      PROGRAM_ID,
    )[0];
  }

  /** Owners may be PDAs too: a Squads vault or a DAO can be the client. */
  ata(owner: PublicKey) {
    return getAssociatedTokenAddressSync(this.mint, owner, true);
  }

  /** Cluster time, re-read every 10 s and extrapolated in between. */
  async chainNow(): Promise<number> {
    const age = Date.now() - this.nowCache.at;
    if (age < 10_000) return this.nowCache.value + Math.floor(age / 1000);
    let value = Math.floor(Date.now() / 1000);
    try {
      const t = await this.connection.getBlockTime(
        await this.connection.getSlot("confirmed"),
      );
      if (t) value = t;
    } catch {
      /* wall clock */
    }
    this.nowCache = { at: Date.now(), value };
    return value;
  }

  async isDeployed() {
    return !!(await this.connection.getAccountInfo(PROGRAM_ID))?.executable;
  }

  async balance(owner: PublicKey): Promise<bigint> {
    try {
      const b = await this.connection.getTokenAccountBalance(
        this.ata(owner),
        "confirmed",
      );
      return BigInt(b.value.amount);
    } catch {
      return 0n;
    }
  }

  private toJob(address: PublicKey, a: any): JobView {
    const arb = a.arbiter.toBase58();
    return {
      address: address.toBase58(),
      client: a.client.toBase58(),
      freelancer: a.freelancer.toBase58(),
      arbiter: arb === NO_KEY ? null : arb,
      mint: a.mint.toBase58(),
      jobId: u64(a.jobId),
      windows: {
        review: num(a.windows.review),
        fix: num(a.windows.fix),
        negotiate: num(a.windows.negotiate),
        arbiter: num(a.windows.arbiter),
      },
      maxRevisions: a.maxRevisions,
      accepted: a.accepted,
      milestoneCount: a.milestoneCount,
      openMilestones: a.openMilestones,
      fallbackBps: a.fallbackBps,
      rentPayer: a.rentPayer.toBase58(),
      termsHash: hex(a.termsHash),
      title: a.title,
    };
  }

  private toMilestone(address: PublicKey, a: any): MilestoneView {
    return {
      address: address.toBase58(),
      index: a.index,
      title: a.title,
      amount: u64(a.amount),
      status: Object.keys(a.status)[0] as Status,
      deliveryDeadline: num(a.deliveryDeadline),
      reviewDeadline: num(a.reviewDeadline),
      negotiateDeadline: num(a.negotiateDeadline),
      arbiterDeadline: num(a.arbiterDeadline),
      revisions: a.revisions,
      submissions: a.submissions,
      deliverableHash: hashOrNull(a.deliverableHash),
      reasonHash: hashOrNull(a.reasonHash),
      disputedBy: roleName(a.disputedBy),
      proposalBy: roleName(a.proposalBy),
      proposalBps: a.proposalBps,
      paidFreelancer: u64(a.paidFreelancer),
      paidClient: u64(a.paidClient),
      settledAt: num(a.settledAt),
    };
  }

  async getJob(address: PublicKey): Promise<JobView | null> {
    const info = await this.connection.getAccountInfo(address);
    if (!info || !info.owner.equals(PROGRAM_ID)) return null;
    try {
      return this.toJob(
        address,
        this.program.coder.accounts.decode("job", info.data),
      );
    } catch {
      return null;
    }
  }

  async mustGetJob(address: PublicKey): Promise<JobView> {
    const job = await this.getJob(address);
    if (!job) throw new UserError("Job not found.", 404);
    if (job.mint !== this.mint.toBase58())
      throw new UserError("This job uses a different token than this app.");
    return job;
  }

  /** Reads the milestone PDAs directly; closed ones are skipped. */
  async milestones(job: JobView): Promise<MilestoneView[]> {
    const key = new PublicKey(job.address);
    const addrs = Array.from({ length: job.milestoneCount }, (_, i) =>
      this.milestonePda(key, i),
    );
    const out: MilestoneView[] = [];
    for (let i = 0; i < addrs.length; i += 100) {
      const infos = await this.connection.getMultipleAccountsInfo(
        addrs.slice(i, i + 100),
        "confirmed",
      );
      infos.forEach((info, j) => {
        const a = info && this.decode("milestone", info.data);
        if (a) out.push(this.toMilestone(addrs[i + j], a));
      });
    }
    return out;
  }

  /** null for accounts written by an older program version. */
  private decode(name: "job" | "milestone", data: Buffer): any {
    try {
      return this.program.coder.accounts.decode(name, data);
    } catch {
      return null;
    }
  }

  async mustGetMilestone(job: PublicKey, index: number) {
    const address = this.milestonePda(job, index);
    const info = await this.connection.getAccountInfo(address);
    if (!info) throw new UserError("Milestone not found.", 404);
    return this.toMilestone(
      address,
      this.program.coder.accounts.decode("milestone", info.data),
    );
  }

  async getMilestone(address: PublicKey) {
    const info = await this.connection.getAccountInfo(address);
    if (!info || !info.owner.equals(PROGRAM_ID)) return null;
    try {
      const a = this.program.coder.accounts.decode("milestone", info.data);
      return { m: this.toMilestone(address, a), job: a.job as PublicKey };
    } catch {
      return null;
    }
  }

  private txEvents = new Map<
    string,
    (HistoryEntry & { milestone: string })[]
  >();
  private historyCache = new Map<
    string,
    { state: string; value: HistoryEntry[] }
  >();
  private historyLoads = new Map<string, Promise<HistoryEntry[]>>();

  /** Whatever history was read last for this milestone, even if outdated. */
  knownHistory(address: string): HistoryEntry[] | undefined {
    return this.historyCache.get(address)?.value;
  }

  /**
   * The milestone's program events, oldest first, read from its transactions.
   * Re-read only when the account changed; a final state without its payout
   * event is not cached, since the signature index can lag behind the account.
   */
  history(m: MilestoneView): Promise<HistoryEntry[]> {
    const state = [
      m.status,
      m.submissions,
      m.revisions,
      m.proposalBy,
      m.proposalBps,
      m.settledAt,
    ].join("|");
    const hit = this.historyCache.get(m.address);
    if (hit && hit.state === state) return Promise.resolve(hit.value);
    const k = `${m.address}|${state}`;
    let load = this.historyLoads.get(k);
    if (!load) {
      load = this.readHistory(m, state).finally(() =>
        this.historyLoads.delete(k),
      );
      this.historyLoads.set(k, load);
    }
    return load;
  }

  private async readHistory(
    m: MilestoneView,
    state: string,
  ): Promise<HistoryEntry[]> {
    const key = m.address;
    const sigs = (
      await this.connection.getSignaturesForAddress(
        new PublicKey(key),
        { limit: 100 },
        "confirmed",
      )
    )
      .reverse()
      .filter((s) => !s.err);
    const parser = new EventParser(PROGRAM_ID, this.program.coder);
    const missing = sigs.filter((s) => !this.txEvents.has(s.signature));
    for (let i = 0; i < missing.length; i += 4)
      await Promise.all(
        missing.slice(i, i + 4).map(async (s) => {
          const tx = await this.connection.getTransaction(s.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          if (!tx) return;
          const events: (HistoryEntry & { milestone: string })[] = [];
          for (const e of parser.parseLogs(tx.meta?.logMessages ?? [])) {
            const milestone = e.data.milestone?.toBase58?.();
            if (!milestone) continue;
            events.push({
              milestone,
              signature: s.signature,
              slot: s.slot,
              time: s.blockTime ?? null,
              event: e.name.charAt(0).toUpperCase() + e.name.slice(1),
              outcome: e.data.outcome
                ? Object.keys(e.data.outcome)[0]
                : undefined,
            });
          }
          if (this.txEvents.size > 20_000) this.txEvents.clear();
          this.txEvents.set(s.signature, events);
        }),
      );
    const out: HistoryEntry[] = [];
    for (const s of sigs)
      for (const e of this.txEvents.get(s.signature) ?? [])
        if (e.milestone === key) {
          const { milestone: _, ...entry } = e;
          out.push(entry);
        }
    const final = FINAL.includes(m.status);
    if (!final || out.some((e) => e.event === "Paid")) {
      if (this.historyCache.size > 5000) this.historyCache.clear();
      this.historyCache.set(key, { state, value: out });
    }
    return out;
  }

  async getJobs(addresses: PublicKey[]): Promise<(JobView | null)[]> {
    const out: (JobView | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const infos = await this.connection.getMultipleAccountsInfo(
        addresses.slice(i, i + 100),
        "confirmed",
      );
      infos.forEach((info, k) => {
        const a =
          info &&
          info.owner.equals(PROGRAM_ID) &&
          this.decode("job", info.data);
        out.push(a ? this.toJob(addresses[i + k], a) : null);
      });
    }
    return out;
  }

  /** Offsets: client 8, freelancer 40, arbiter 72. */
  async jobsOf(wallet: PublicKey): Promise<JobView[]> {
    const disc = this.program.coder.accounts.memcmp("job");
    const seen = new Map<string, JobView>();
    for (const offset of [8, 40, 72]) {
      const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          { memcmp: disc },
          { memcmp: { offset, bytes: wallet.toBase58() } },
        ],
      });
      for (const { pubkey, account } of accounts) {
        const a = this.decode("job", account.data);
        if (a) seen.set(pubkey.toBase58(), this.toJob(pubkey, a));
      }
    }
    return [...seen.values()].filter((j) => j.mint === this.mint.toBase58());
  }

  /** Milestone offsets: status 50, rent_payer 177. */
  async milestonesWhere(
    filter: { statuses: Status[] } | { rentPayer: PublicKey } | { open: true },
  ): Promise<{ m: MilestoneView; job: PublicKey; rentPayer: PublicKey }[]> {
    const order: Status[] = [
      "funded",
      "submitted",
      "disputed",
      "released",
      "settled",
      "resolved",
      "refunded",
    ];
    const queries =
      "open" in filter
        ? [null]
        : "statuses" in filter
          ? filter.statuses.map((s) => ({
              offset: 50,
              bytes: bs58.encode([order.indexOf(s)]),
            }))
          : [{ offset: 177, bytes: filter.rentPayer.toBase58() }];
    const out = [];
    for (const memcmp of queries) {
      const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          { memcmp: this.program.coder.accounts.memcmp("milestone") },
          ...(memcmp ? [{ memcmp }] : []),
        ],
      });
      for (const { pubkey, account } of accounts) {
        const a = this.decode("milestone", account.data);
        if (
          a &&
          "open" in filter &&
          FINAL.includes(this.toMilestone(pubkey, a).status)
        )
          continue;
        if (a)
          out.push({
            m: this.toMilestone(pubkey, a),
            job: a.job as PublicKey,
            rentPayer: a.rentPayer as PublicKey,
          });
      }
    }
    return out;
  }

  async buildCloseMilestone(
    job: JobView,
    m: MilestoneView,
    rentPayer: PublicKey,
  ) {
    const milestone = new PublicKey(m.address);
    const client = new PublicKey(job.client);
    return this.methods
      .closeMilestone()
      .accountsPartial({
        job: new PublicKey(job.address),
        milestone,
        rentPayer,
        mint: this.mint,
        vault: this.ata(milestone),
        clientToken: this.ata(client),
      })
      .instruction() as Promise<TransactionInstruction>;
  }

  async buildCloseJob(job: JobView) {
    return this.methods
      .closeJob()
      .accountsPartial({
        job: new PublicKey(job.address),
        rentPayer: new PublicKey(job.rentPayer),
      })
      .instruction() as Promise<TransactionInstruction>;
  }

  async buildCreate(
    client: PublicKey,
    p: {
      jobId: bigint;
      freelancer: PublicKey;
      arbiter: PublicKey | null;
      windows: Windows;
      maxRevisions: number;
      fallbackBps: number;
      termsHash: number[];
      title: string;
      milestones: { title: string; amount: bigint; deadline: number }[];
    },
  ) {
    if (p.freelancer.equals(client))
      throw new UserError(
        "The freelancer must be a different wallet than yours.",
      );
    if (
      p.arbiter &&
      (p.arbiter.equals(client) || p.arbiter.equals(p.freelancer))
    )
      throw new UserError(
        "The arbiter must be neither you nor the freelancer.",
      );
    const job = this.jobPda(client, p.jobId);
    if (await this.connection.getAccountInfo(job))
      throw new UserError("This job already exists.", 409);
    const total = p.milestones.reduce((s, m) => s + m.amount, 0n);
    await this.needTokens(client, total);
    const pay = this.payerFor(client);
    const ixs = [
      await this.methods
        .createJob(
          new BN(p.jobId.toString()),
          p.freelancer,
          p.arbiter ?? PublicKey.default,
          {
            review: new BN(p.windows.review),
            fix: new BN(p.windows.fix),
            negotiate: new BN(p.windows.negotiate),
            arbiter: new BN(p.windows.arbiter),
          },
          p.maxRevisions,
          p.fallbackBps,
          p.termsHash,
          p.title,
        )
        .accountsPartial({ client, payer: pay.feePayer, job, mint: this.mint })
        .instruction(),
    ];
    for (const [i, m] of p.milestones.entries())
      ixs.push(await this.addMilestoneIx(client, pay.feePayer, job, i, m));
    return { job, ixs, ...pay, total };
  }

  async buildAddMilestone(
    client: PublicKey,
    jobKey: PublicKey,
    m: { title: string; amount: bigint; deadline: number },
  ) {
    const job = await this.mustGetJob(jobKey);
    if (job.client !== client.toBase58())
      throw new UserError("Only the client can fund milestones.", 403);
    if (job.milestoneCount >= MAX_MILESTONES)
      throw new UserError(
        `A job can have at most ${MAX_MILESTONES} milestones.`,
      );
    await this.needTokens(client, m.amount);
    const pay = this.payerFor(client);
    return {
      job,
      ixs: [
        await this.addMilestoneIx(
          client,
          pay.feePayer,
          jobKey,
          job.milestoneCount,
          m,
        ),
      ],
      ...pay,
    };
  }

  private async addMilestoneIx(
    client: PublicKey,
    payer: PublicKey,
    job: PublicKey,
    index: number,
    m: { title: string; amount: bigint; deadline: number },
  ) {
    const milestone = this.milestonePda(job, index);
    return this.methods
      .addMilestone(new BN(m.amount.toString()), new BN(m.deadline), m.title)
      .accountsPartial({
        client,
        payer,
        job,
        milestone,
        mint: this.mint,
        clientToken: this.ata(client),
        vault: this.ata(milestone),
      })
      .instruction();
  }

  private async needTokens(owner: PublicKey, amount: bigint) {
    const have = await this.balance(owner);
    if (have < amount)
      throw new UserError(
        `You need ${this.fmt(amount)} ${this.symbol} in this wallet (you have ${this.fmt(have)}).`,
        409,
      );
    if (!this.sponsor && (await this.connection.getBalance(owner)) === 0)
      throw new UserError(
        "This wallet has no SOL to pay the network fee.",
        409,
      );
  }

  async buildAccept(freelancer: PublicKey, jobKey: PublicKey) {
    const job = await this.mustGetJob(jobKey);
    if (job.freelancer !== freelancer.toBase58())
      throw new UserError(
        "Only the named freelancer can accept this job.",
        403,
      );
    if (job.accepted)
      throw new UserError("You already accepted this job.", 409);
    const pay = this.payerFor(freelancer);
    return {
      job,
      ixs: [
        await this.methods
          .acceptJob()
          .accountsPartial({ freelancer, job: jobKey })
          .instruction(),
      ],
      ...pay,
    };
  }

  /** submit, requestRevision, openDispute, proposeSplit. */
  async buildAct(
    method: "submit" | "requestRevision" | "openDispute" | "proposeSplit",
    actor: PublicKey,
    jobKey: PublicKey,
    index: number,
    arg: number[] | number,
  ) {
    const job = await this.mustGetJob(jobKey);
    const m = await this.mustGetMilestone(jobKey, index);
    const pay = this.payerFor(
      actor,
      method === "submit" || method === "openDispute",
    );
    const ix = await this.methods[method](arg)
      .accountsPartial({
        actor,
        job: jobKey,
        milestone: this.milestonePda(jobKey, index),
      })
      .instruction();
    return { job, m, ixs: [ix], ...pay };
  }

  /** approve, releaseOnSilence, acceptSplit, resolve, fallbackSplit, refund. */
  async buildPayout(
    method:
      | "approve"
      | "releaseOnSilence"
      | "acceptSplit"
      | "resolve"
      | "fallbackSplit"
      | "refund",
    actor: PublicKey,
    jobKey: PublicKey,
    index: number,
    bps?: number,
  ) {
    const job = await this.mustGetJob(jobKey);
    const m = await this.mustGetMilestone(jobKey, index);
    const pay = this.payerFor(actor, method === "releaseOnSilence");
    const milestone = this.milestonePda(jobKey, index);
    const client = new PublicKey(job.client);
    const freelancer = new PublicKey(job.freelancer);
    const ixs = [
      createAssociatedTokenAccountIdempotentInstruction(
        pay.feePayer,
        this.ata(freelancer),
        freelancer,
        this.mint,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        pay.feePayer,
        this.ata(client),
        client,
        this.mint,
      ),
      await this.methods[method](...(bps === undefined ? [] : [bps]))
        .accountsPartial({
          actor,
          job: jobKey,
          milestone,
          mint: this.mint,
          vault: this.ata(milestone),
          freelancerToken: this.ata(freelancer),
          clientToken: this.ata(client),
        })
        .instruction(),
    ];
    return { job, m, ixs, ...pay };
  }

  /** Simulates first, so a failing tx comes back as the program's own message. */
  /**
   * Simulates and returns the unsigned transaction. The sponsor signs only in
   * /api/send, after checking it is exactly this message.
   */
  async finalize(b: Built): Promise<{ transaction: string; hash: string }> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: b.feePayer,
      blockhash,
      lastValidBlockHeight,
    }).add(...b.ixs);
    const sim = await this.connection.simulateTransaction(
      new VersionedTransaction(tx.compileMessage()),
      { sigVerify: false, commitment: "confirmed" },
    );
    if (sim.value.err)
      throw new UserError(
        this.explain(sim.value.err, sim.value.logs ?? []),
        422,
      );
    return {
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      hash: messageHash(tx),
    };
  }

  /** For server-side keys (demo counterpart, crank): build, sign, send. */
  async send(b: Built, signers: Keypair[]): Promise<string> {
    const tx = new Transaction().add(...b.ixs);
    tx.feePayer = b.feePayer;
    const all = [...signers, ...b.signers].filter(
      (k, i, a) => a.findIndex((x) => x.publicKey.equals(k.publicKey)) === i,
    );
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.sign(...all);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
    });
    await this.confirm(signature, blockhash);
    return signature;
  }

  /**
   * Polls instead of subscribing: public RPCs rate-limit websockets hard.
   * Bounded by the validity of the transaction's own blockhash.
   */
  async confirm(signature: string, blockhash: string) {
    const giveUp = Date.now() + 90_000;
    for (;;) {
      let st;
      try {
        st = (await this.connection.getSignatureStatuses([signature])).value[0];
      } catch (e) {
        if (!isRateLimited(e) || Date.now() > giveUp) throw e;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (st?.err)
        throw new UserError(
          `Transaction failed: ${JSON.stringify(st.err)}`,
          422,
        );
      if (
        st?.confirmationStatus === "confirmed" ||
        st?.confirmationStatus === "finalized"
      )
        return;
      const valid = await this.connection
        .isBlockhashValid(blockhash, { commitment: "confirmed" })
        .then((r) => r.value)
        .catch((e) => {
          if (isRateLimited(e)) return true;
          throw e;
        });
      if (!valid || Date.now() > giveUp) {
        const last = (
          await this.connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          })
        ).value[0];
        if (last && !last.err && last.confirmationStatus) return;
        throw new UserError(
          "The transaction expired before it was confirmed. Please try again.",
          422,
        );
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  explain(err: unknown, logs: string[]): string {
    for (const l of logs) {
      const m = /Error Message: (.*)$/.exec(l);
      if (m) return m[1].replace(/\.$/, "") + ".";
    }
    const custom = JSON.stringify(err).match(/"Custom":(\d+)/);
    if (custom && this.errorMessages.has(Number(custom[1])))
      return this.errorMessages.get(Number(custom[1]))! + ".";
    const all = logs.join("\n");
    if (/insufficient funds/i.test(all))
      return `Not enough ${this.symbol} in this wallet.`;
    if (
      /insufficient lamports/i.test(all) ||
      err === "InsufficientFundsForRent"
    )
      return "Not enough SOL in this wallet to pay for fees and rent.";
    if (err === "AccountNotFound")
      return "This wallet has no SOL on this network to pay the network fee.";
    return `The transaction would fail (${JSON.stringify(err)}).`;
  }
}

/** Keeps a public fee sponsor from being drained by one visitor. */
export class SponsorLimits {
  private readonly perWallet = new Map<string, number[]>();
  private day: number[] = [];
  constructor(
    private readonly walletPerHour: number,
    private readonly perDay: number,
    private readonly walletWindowMs = 3_600_000,
  ) {}
  load(file: string) {
    try {
      const d = JSON.parse(readFileSync(file, "utf8"));
      this.day = d.day;
      for (const [k, v] of d.wallets) this.perWallet.set(k, v);
    } catch {
      /* first start */
    }
  }
  save(file: string) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({ day: this.day, wallets: [...this.perWallet] }),
      );
      renameSync(`${file}.tmp`, file);
    } catch {
      /* limits still hold in memory */
    }
  }
  can(wallet: string, skipWalletCap = false, now = Date.now()): boolean {
    this.day = this.day.filter((t) => t > now - 86_400_000);
    const mine = (this.perWallet.get(wallet) ?? []).filter(
      (t) => t > now - this.walletWindowMs,
    );
    if (mine.length) this.perWallet.set(wallet, mine);
    else this.perWallet.delete(wallet);
    if (this.day.length >= this.perDay) return false;
    return skipWalletCap || mine.length < this.walletPerHour;
  }
  record(wallet: string, now = Date.now()) {
    const mine = this.perWallet.get(wallet) ?? [];
    mine.push(now);
    this.perWallet.delete(wallet);
    this.perWallet.set(wallet, mine);
    this.day.push(now);
    trimOldest(this.perWallet, 10_000);
  }
  allow(wallet: string, now = Date.now()): boolean {
    if (!this.can(wallet, false, now)) return false;
    this.record(wallet, now);
    return true;
  }
}
