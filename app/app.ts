import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  Chain,
  MAX_DELIVERY_SECS,
  MAX_REVISIONS,
  MAX_WINDOW_SECS,
  MILESTONES_PER_TX,
  MIN_WINDOW_SECS,
  PROGRAM_ID,
  SponsorLimits,
  U64_MAX,
  UserError,
  allowedActions,
  messageHash,
  parsePubkey,
  roleOf,
  trimOldest,
  isRateLimited,
  parseUnits,
  type Built,
  type HistoryEntry,
  type Windows,
} from "./chain.js";
import type { DemoCounterpart } from "./bot.js";
import { MAX_TEXT_BYTES, type TextStore } from "./store.js";
import * as views from "./views.js";
import { registerActions } from "./actions.js";
import type { Stats } from "./stats.js";

const require = createRequire(import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Cluster = "localnet" | "devnet" | "mainnet-beta";

export interface AppConfig {
  chain: Chain;
  cluster: Cluster;
  rpcUrl: string;
  publicUrl: string;
  dataDir: string;
  texts: TextStore;
  demo?: DemoCounterpart;
  stats?: { get(): Stats };
}

export function createApp(config: AppConfig) {
  const { chain, demo, texts } = config;
  const sym = chain.symbol;
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY)
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
  app.use(express.json({ limit: "64kb" }));

  const minWindow = config.cluster === "mainnet-beta" ? 3600 : MIN_WINDOW_SECS;
  const maxDelivery =
    config.cluster === "mainnet-beta" ? MAX_DELIVERY_SECS : 7 * 86_400;
  /** IPv6 clients get a whole /64, so one host cannot rotate addresses. */
  const ipKey = (req: Request) => {
    const ip = (req.ip ?? "?").replace(/^::ffff:/, "");
    return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
  };
  const hits = new Map<string, number[]>();
  const perMinute: [RegExp, number][] = [
    [/^\/api\/(tx|send)$/, 30],
    [/^\/api\/actions\//, 30],
    [/^\/api\/jobs$/, 20],
    [/^\/api\/balance$/, 60],
    [/^\/api\/job\//, 90],
    [/^\/j\//, 60],
    [/^\/api\/ics\//, 20],
  ];
  app.use((req, res, next) => {
    const rule = perMinute.find(([re]) => re.test(req.path));
    if (!rule) return next();
    const key = `${rule[0].source}|${ipKey(req)}`;
    const now = Date.now();
    const mine = (hits.get(key) ?? []).filter((t) => t > now - 60_000);
    if (mine.length >= rule[1]) {
      res
        .status(429)
        .json({ error: "rate", message: "Too many requests. Wait a minute." });
      return;
    }
    mine.push(now);
    hits.delete(key);
    hits.set(key, mine);
    trimOldest(hits, 50_000);
    next();
  });

  const ctx: views.ViewContext = {
    cluster: config.cluster,
    rpcUrl: config.rpcUrl,
    programId: PROGRAM_ID.toBase58(),
    mint: chain.mint.toBase58(),
    symbol: sym,
    decimals: chain.decimals,
    sponsored: !!chain.sponsor,
    demo: demo?.address ?? null,
  };

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  const str = (v: unknown, what: string, maxBytes = 64) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) throw new UserError(`${what} is missing.`);
    if (Buffer.byteLength(s) > maxBytes)
      throw new UserError(`${what} can be at most ${maxBytes} bytes.`);
    return s;
  };
  const int = (v: unknown, what: string) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new UserError(`${what} must be a whole number.`);
    return n;
  };
  const amountOf = (v: unknown) => {
    const a = parseUnits(String(v ?? ""), chain.decimals);
    if (a === null || a <= 0n || a > U64_MAX)
      throw new UserError(
        `Amounts must be positive ${sym} values with at most ${chain.decimals} decimals.`,
      );
    return a;
  };
  const bpsOf = (v: unknown) => {
    const n = int(v, "Split");
    if (n > 10_000) throw new UserError("A split is between 0 and 100 %.");
    return n;
  };
  const hashOf = (text: string) => [...Buffer.from(texts.put(text), "hex")];

  async function milestoneInput(
    raw: any,
    now: number,
  ): Promise<{ title: string; amount: bigint; deadline: number }> {
    const deadline = int(raw?.deadline, "Delivery deadline");
    if (deadline <= now || deadline > now + maxDelivery)
      throw new UserError(
        maxDelivery === MAX_DELIVERY_SECS
          ? "Each delivery deadline must be in the future and at most a year out."
          : "On this test network, delivery deadlines are at most 7 days out.",
      );
    return {
      title: str(raw?.title, "Milestone title"),
      amount: amountOf(raw?.amount),
      deadline,
    };
  }

  type TxResult = Built & {
    message: string;
    created?: PublicKey;
    onLanded?: () => void;
  };
  const actions: Record<
    string,
    (body: any, account: PublicKey) => Promise<TxResult>
  > = {
    async create(body, client) {
      const now = await chain.chainNow();
      const w = body.windows ?? {};
      const windows: Windows = {
        review: int(w.review, "Review window"),
        fix: int(w.fix, "Revision window"),
        negotiate: int(w.negotiate, "Negotiation window"),
        arbiter: int(w.arbiter, "Arbiter window"),
      };
      for (const v of Object.values(windows))
        if (v < minWindow || v > MAX_WINDOW_SECS)
          throw new UserError(
            `Every time window must be between ${minWindow === 60 ? "1 minute" : "1 hour"} and 90 days.`,
          );
      const maxRevisions = int(body.maxRevisions, "Revisions");
      if (maxRevisions > MAX_REVISIONS)
        throw new UserError(`At most ${MAX_REVISIONS} revisions.`);
      const fallbackBps = bpsOf(body.fallbackBps ?? 5000);
      const list = Array.isArray(body.milestones) ? body.milestones : [];
      if (list.length < 1 || list.length > MILESTONES_PER_TX)
        throw new UserError(
          `Start with 1 to ${MILESTONES_PER_TX} milestones; add more on the job page.`,
        );
      const milestones = [];
      for (const m of list) milestones.push(await milestoneInput(m, now));
      const b = await chain.buildCreate(client, {
        jobId: randomBytes(8).readBigUInt64LE(),
        freelancer: parsePubkey(body.freelancer, "freelancer wallet"),
        arbiter: body.arbiter
          ? parsePubkey(body.arbiter, "arbiter wallet")
          : null,
        windows,
        maxRevisions,
        fallbackBps,
        termsHash: hashOf(str(body.terms, "Terms", MAX_TEXT_BYTES)),
        title: str(body.title, "Job title"),
        milestones,
      });
      return {
        ...b,
        created: b.job,
        onLanded:
          demo && body.freelancer === demo.address
            ? () => demo.watch(b.job)
            : undefined,
        message: `Create "${body.title}" and move ${chain.fmt(b.total)} ${sym} into escrow.`,
      };
    },
    async addMilestone(body, client) {
      const job = jobParam(body);
      const m = await milestoneInput(body, await chain.chainNow());
      const b = await chain.buildAddMilestone(client, job, m);
      return {
        ...b,
        message: `Fund "${m.title}" with ${chain.fmt(m.amount)} ${sym}.`,
      };
    },
    async accept(body, freelancer) {
      const b = await chain.buildAccept(freelancer, jobParam(body));
      return { ...b, message: `Accept "${b.job.title}" and its terms.` };
    },
    async submit(body, actor) {
      const text = str(body.text, "Delivery note", MAX_TEXT_BYTES);
      const b = await chain.buildAct(
        "submit",
        actor,
        jobParam(body),
        indexParam(body),
        hashOf(text),
      );
      return { ...b, message: `Submit your delivery for "${b.m.title}".` };
    },
    async revision(body, actor) {
      const b = await chain.buildAct(
        "requestRevision",
        actor,
        jobParam(body),
        indexParam(body),
        hashOf(str(body.text, "Reason", MAX_TEXT_BYTES)),
      );
      return { ...b, message: `Ask for a revision of "${b.m.title}".` };
    },
    async dispute(body, actor) {
      const b = await chain.buildAct(
        "openDispute",
        actor,
        jobParam(body),
        indexParam(body),
        hashOf(str(body.text, "Reason", MAX_TEXT_BYTES)),
      );
      return { ...b, message: `Open a dispute on "${b.m.title}".` };
    },
    async propose(body, actor) {
      const bps = bpsOf(body.bps);
      const b = await chain.buildAct(
        "proposeSplit",
        actor,
        jobParam(body),
        indexParam(body),
        bps,
      );
      return {
        ...b,
        message: `Offer ${bps / 100} % to the freelancer, the rest back to the client.`,
      };
    },
    async approve(body, actor) {
      const b = await chain.buildPayout(
        "approve",
        actor,
        jobParam(body),
        indexParam(body),
      );
      return {
        ...b,
        message: `Sign off "${b.m.title}" and release ${chain.fmt(b.m.amount)} ${sym}.`,
      };
    },
    async release(body, actor) {
      const b = await chain.buildPayout(
        "releaseOnSilence",
        actor,
        jobParam(body),
        indexParam(body),
      );
      return {
        ...b,
        message: `The review window is over: release "${b.m.title}" to the freelancer.`,
      };
    },
    async acceptSplit(body, actor) {
      const bps = bpsOf(body.bps);
      const b = await chain.buildPayout(
        "acceptSplit",
        actor,
        jobParam(body),
        indexParam(body),
        bps,
      );
      return { ...b, message: `Accept the ${bps / 100} % split.` };
    },
    async resolve(body, actor) {
      const bps = bpsOf(body.bps);
      const b = await chain.buildPayout(
        "resolve",
        actor,
        jobParam(body),
        indexParam(body),
        bps,
      );
      return {
        ...b,
        message: `Decide: ${bps / 100} % to the freelancer, the rest to the client.`,
      };
    },
    async fallback(body, actor) {
      const b = await chain.buildPayout(
        "fallbackSplit",
        actor,
        jobParam(body),
        indexParam(body),
      );
      return {
        ...b,
        message: `Nobody decided in time: apply the default split (${b.job.fallbackBps / 100} % to the freelancer).`,
      };
    },
    async refund(body, actor) {
      const b = await chain.buildPayout(
        "refund",
        actor,
        jobParam(body),
        indexParam(body),
      );
      return {
        ...b,
        message: `Take ${chain.fmt(b.m.amount)} ${sym} back from "${b.m.title}".`,
      };
    },
  };
  const jobParam = (body: any) => parsePubkey(body.job, "job address");
  const indexParam = (body: any) => {
    const i = int(body.index, "Milestone index");
    if (i > 0xffff) throw new UserError("Invalid milestone index.");
    return i;
  };

  const DONE: Record<string, string> = {
    create: "Job created. The money is in escrow.",
    addMilestone: "Milestone funded.",
    accept: "You accepted the job.",
    submit: "Delivery submitted. The client's review window is running.",
    revision: "Change request sent.",
    dispute: "Dispute opened.",
    propose: "Split offered.",
    approve: "Approved. The freelancer has been paid.",
    release: "Released to the freelancer.",
    acceptSplit: "Split accepted and paid out.",
    resolve: "Decision paid out.",
    fallback: "Default split paid out.",
    refund: "The money went back to the client.",
  };

  interface Pending {
    wallet: string;
    exp: number;
    sponsored: boolean;
    critical: boolean;
    action: string;
    onLanded?: () => void;
  }
  const pending = new Map<string, Pending>();
  const CRITICAL = new Set(["submit", "dispute", "release"]);
  const createLimits = new SponsorLimits(5, 150, 24 * 3_600_000);

  /** Builds and simulates an app action for `account`, with the same checks everywhere. */
  async function prepare(action: string, body: any, account: PublicKey) {
    const fn = actions[action];
    if (!fn) throw new UserError("Unknown action.");
    if (chain.isServerKey(account) || account.toBase58() === demo?.address)
      throw new UserError("This wallet belongs to the app. Use your own.", 403);
    const creates = action === "create" || action === "addMilestone";
    if (creates && chain.sponsor && !createLimits.can(account.toBase58()))
      throw new UserError(
        "This wallet has used today's limit of sponsored jobs and milestones.",
        429,
      );
    // One retry: a public RPC hiccup must not cost someone their review window.
    const build = async () => {
      const b = await fn(body, account);
      return { built: b, ...(await chain.finalize(b)) };
    };
    return build().catch(async (e) => {
      if (e instanceof UserError) throw e;
      await sleep(800);
      return build();
    });
  }

  registerActions(app, {
    chain,
    cluster: config.cluster,
    publicUrl: config.publicUrl,
    prepare,
    maxDeliverySecs: maxDelivery,
    onSponsored(action, wallet) {
      chain.recordSponsored(wallet);
      if (action === "addMilestone") createLimits.record(wallet);
    },
  });

  app.post(
    "/api/tx",
    wrap(async (req, res) => {
      const action = String(req.body?.action);
      const account = parsePubkey(req.body?.account, "wallet");
      const { built, transaction, hash } = await prepare(
        action,
        req.body,
        account,
      );
      const sponsored = !built.feePayer.equals(account);
      const now = Date.now();
      for (const [h, p] of pending) if (p.exp < now) pending.delete(h);
      trimOldest(pending, 5000);
      pending.set(hash, {
        wallet: account.toBase58(),
        exp: now + 180_000,
        sponsored,
        critical: CRITICAL.has(action),
        action,
        onLanded: built.onLanded,
      });
      res.json({
        transaction,
        message: built.message,
        done: DONE[action],
        job: built.created?.toBase58(),
        sponsored,
      });
    }),
  );

  /**
   * Only relays transactions this app built. The sponsor signs here, after
   * the wallet did, so a prepared transaction cannot be sent elsewhere.
   */
  app.post(
    "/api/send",
    wrap(async (req, res) => {
      const raw =
        typeof req.body?.transaction === "string" ? req.body.transaction : "";
      let tx: Transaction;
      try {
        tx = Transaction.from(Buffer.from(raw, "base64"));
      } catch {
        throw new UserError("Expected a base64 serialized transaction.");
      }
      const hash = messageHash(tx);
      const p = pending.get(hash);
      if (!p || p.exp < Date.now())
        throw new UserError(
          "This transaction expired or was not prepared by this app. Please try again.",
          409,
        );
      if (p.sponsored) {
        if (!chain.canSponsor(p.wallet, p.critical))
          throw new UserError(
            "The app's fee budget for this wallet is used up for now. Try again later.",
            429,
          );
        chain.signAsSponsor(tx);
      }
      let bytes: Buffer;
      try {
        bytes = tx.serialize();
      } catch {
        throw new UserError("The transaction is missing a signature.", 400);
      }
      pending.delete(hash);
      try {
        let signature = "";
        for (let i = 0; !signature; i++)
          signature = await chain.connection
            .sendRawTransaction(bytes, { preflightCommitment: "confirmed" })
            .catch(async (e) => {
              if (i >= 3 || !isRateLimited(e)) throw e;
              await sleep(1000 * (i + 1));
              return "";
            });
        await chain.confirm(signature, tx.recentBlockhash!);
        if (p.sponsored) chain.recordSponsored(p.wallet);
        if (p.action === "create" || p.action === "addMilestone")
          createLimits.record(p.wallet);
        p.onLanded?.();
        jobCache.clear();
        res.json({ signature });
      } catch (err) {
        if (err instanceof UserError) throw err;
        if (isRateLimited(err))
          throw new UserError(
            "Solana is busy right now. Nothing was sent; press the button again in a few seconds.",
            503,
          );
        throw new UserError(
          chain.explain(
            String((err as Error).message),
            (err as { logs?: string[] }).logs ?? [],
          ),
          422,
        );
      }
    }),
  );

  const jobCache = new Map<
    string,
    { at: number; done?: number; value: ReturnType<typeof loadJob> }
  >();
  const balances = new Map<string, { at: number; value: Promise<string> }>();
  const notFound = new Map<string, number>();
  // Public RPCs answer 429 now and then: serve the last good read instead of an error.
  const lastGood = new Map<
    string,
    { at: number; value: Awaited<ReturnType<typeof loadJob>> }
  >();

  async function loadJob(key: PublicKey) {
    const job = await chain.mustGetJob(key);
    const [milestones, now] = await Promise.all([
      chain.milestones(job),
      chain.chainNow(),
    ]);
    const known: Record<string, string> = {};
    for (const h of [
      job.termsHash,
      ...milestones.flatMap((m) => [m.deliverableHash, m.reasonHash]),
    ]) {
      texts.confirm(h);
      const t = texts.get(h);
      if (h && t) known[h] = t;
    }
    // A slow signature index must not hold back the state: after a short wait
    // the last known history is shown and the new one lands on a later poll.
    const history: Record<number, HistoryEntry[]> = {};
    await Promise.all(
      milestones.map(async (m) => {
        const fresh = chain.history(m).catch(() => null);
        history[m.index] =
          (await Promise.race([fresh, sleep(1500).then(() => null)])) ??
          chain.knownHistory(m.address) ??
          [];
      }),
    );
    return { job, milestones, now, texts: known, history };
  }

  /** Shared by every viewer for a few seconds; public RPCs rate-limit hard. */
  async function jobData(key: PublicKey, wallet: string | null) {
    const k = key.toBase58();
    const miss = notFound.get(k);
    if (miss && Date.now() - miss < 30_000)
      throw new UserError("Job not found.", 404);
    let hit = jobCache.get(k);
    // Polls reuse a read still in flight instead of piling up on the RPC.
    if (!hit || (hit.done && Date.now() - hit.done > 3000)) {
      const h: NonNullable<typeof hit> = { at: Date.now(), value: loadJob(key) };
      h.value.then(
        () => (h.done = Date.now()),
        () => jobCache.delete(k),
      );
      hit = h;
      if (jobCache.size > 2000) jobCache.clear();
      jobCache.set(k, hit);
    }
    let base: Awaited<ReturnType<typeof loadJob>>;
    let stale = false;
    try {
      base = await hit.value;
      if (lastGood.size > 2000) lastGood.clear();
      lastGood.set(k, { at: hit.at, value: base });
    } catch (e) {
      if (e instanceof UserError && e.status === 404) {
        if (notFound.size > 5000) notFound.clear();
        notFound.set(k, Date.now());
      }
      const old = lastGood.get(k);
      if (!old || e instanceof UserError || Date.now() - old.at > 300_000)
        throw e;
      base = old.value;
      stale = true;
      hit = { at: old.at, value: Promise.resolve(old.value) };
    }
    const now = base.now + Math.floor((Date.now() - hit.at) / 1000);
    const role = roleOf(base.job, wallet);
    const actions: Record<number, string[]> = {};
    for (const m of base.milestones)
      actions[m.index] = allowedActions(base.job, m, role, now);
    let balance: string | null = null;
    if (wallet) {
      const bk = `${wallet}|${base.milestones.map((m) => m.status).join(",")}`;
      let b = balances.get(bk);
      if (!b || Date.now() - b.at > 5000) {
        b = {
          at: Date.now(),
          value: chain.balance(new PublicKey(wallet)).then((v) => chain.fmt(v)),
        };
        if (balances.size > 5000) balances.clear();
        balances.set(bk, b);
      }
      balance = await b.value;
    }
    return { ...base, now, role, actions, balance, stale };
  }

  const walletParam = (req: Request) =>
    typeof req.query.wallet === "string" && req.query.wallet
      ? parsePubkey(req.query.wallet, "wallet").toBase58()
      : null;

  app.get(
    "/api/job/:job",
    wrap(async (req, res) => {
      res
        .set("Cache-Control", "no-store")
        .json(
          await jobData(
            parsePubkey(req.params.job, "job address"),
            walletParam(req),
          ),
        );
    }),
  );

  const walletJobs = new Map<string, { at: number; value: Promise<unknown> }>();
  app.get(
    "/api/jobs",
    wrap(async (req, res) => {
      const wallet = parsePubkey(req.query.wallet, "wallet");
      const k = wallet.toBase58();
      const hit = walletJobs.get(k);
      if (hit && Date.now() - hit.at < 10_000)
        return void res.set("Cache-Control", "no-store").json(await hit.value);
      const value = (async () => {
        const [jobs, balance] = await Promise.all([
          chain.jobsOf(wallet),
          chain.balance(wallet),
        ]);
        const out = [];
        for (const job of jobs.slice(0, 50)) {
          const ms = await chain.milestones(job);
          out.push({
            ...job,
            total: chain.fmt(ms.reduce((s, m) => s + BigInt(m.amount), 0n)),
            statuses: ms.map((m) => m.status),
          });
        }
        return { jobs: out, balance: chain.fmt(balance) };
      })();
      if (walletJobs.size > 2000) walletJobs.clear();
      walletJobs.set(k, { at: Date.now(), value });
      value.catch(() => walletJobs.delete(k));
      res.set("Cache-Control", "no-store").json(await value);
    }),
  );

  app.get(
    "/api/balance",
    wrap(async (req, res) => {
      const wallet = parsePubkey(req.query.wallet, "wallet");
      res
        .set("Cache-Control", "no-store")
        .json({ balance: chain.fmt(await chain.balance(wallet)) });
    }),
  );

  const faucetWallets = new SponsorLimits(1, 500, 24 * 3_600_000);
  const faucetIps = new SponsorLimits(5, 500, 24 * 3_600_000);
  const faucetFile = resolve(config.dataDir, "faucet.json");
  faucetWallets.load(faucetFile);
  app.post(
    "/api/faucet",
    wrap(async (req, res) => {
      if (!demo) throw new UserError("No test-token faucet here.", 404);
      const owner = parsePubkey(req.body?.account, "wallet");
      if (
        !faucetIps.can(`ip:${ipKey(req)}`) ||
        !faucetWallets.can(owner.toBase58())
      )
        throw new UserError("This wallet already got test tokens today.", 429);
      const signature = await demo.mintTest(owner, 100n);
      faucetIps.record(`ip:${ipKey(req)}`);
      faucetWallets.record(owner.toBase58());
      faucetWallets.save(faucetFile);
      res.json({ signature, amount: `100 ${sym}` });
    }),
  );

  const hireLimits = new SponsorLimits(3, 40, 3_600_000);
  const hireIps = new SponsorLimits(5, 40, 3_600_000);
  app.post(
    "/api/demo/hire",
    wrap(async (req, res) => {
      if (!demo) throw new UserError("The demo is off on this network.", 404);
      const freelancer = parsePubkey(req.body?.account, "wallet");
      if (freelancer.toBase58() === demo.address)
        throw new UserError("Use your own wallet.");
      if (
        !hireIps.can(`ip:${ipKey(req)}`) ||
        !hireLimits.can(freelancer.toBase58())
      )
        throw new UserError("Enough demo jobs for this hour.", 429);
      const job = await demo.hire(freelancer);
      hireIps.record(`ip:${ipKey(req)}`);
      hireLimits.record(freelancer.toBase58());
      res.json({ job: job.toBase58() });
    }),
  );

  const vendor: Record<string, string> = {
    "web3.iife.min.js":
      require.resolve("@solana/web3.js/lib/index.iife.min.js"),
  };
  const icsText = (s: string) =>
    s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, " ");
  const icsTime = (t: number) =>
    new Date(t * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  app.get(
    "/api/ics/:milestone",
    wrap(async (req, res) => {
      const address = parsePubkey(req.params.milestone, "milestone");
      const found = await chain.getMilestone(address);
      if (!found || found.m.status !== "submitted")
        throw new UserError(
          "There is no running review window for this milestone.",
          404,
        );
      const job = await chain.mustGetJob(found.job);
      const url = `${config.publicUrl}/j/${job.address}#m${found.m.index}`;
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Stillpaid//EN",
        "BEGIN:VEVENT",
        `UID:${address.toBase58()}-${found.m.reviewDeadline}@stillpaid`,
        `DTSTAMP:${icsTime(Math.floor(Date.now() / 1000))}`,
        `DTSTART:${icsTime(found.m.reviewDeadline)}`,
        `DTEND:${icsTime(found.m.reviewDeadline + 900)}`,
        `SUMMARY:${icsText(`Review ends: ${job.title} / ${found.m.title}`)}`,
        `DESCRIPTION:${icsText(`If you do not approve, request a change or dispute before this time, the payment is released to the freelancer. ${url}`)}`,
        `URL:${url}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT1H",
        "ACTION:DISPLAY",
        "DESCRIPTION:Stillpaid review ends in 1 hour",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ];
      res
        .type("text/calendar")
        .set(
          "Content-Disposition",
          'attachment; filename="stillpaid-review.ics"',
        )
        .send(lines.join("\r\n") + "\r\n");
    }),
  );

  app.use(
    "/pitch",
    express.static(resolve(dirname(fileURLToPath(import.meta.url)), "../pitch"), {
      maxAge: "10m",
    }),
  );
  app.use(
    "/static",
    express.static(resolve(dirname(fileURLToPath(import.meta.url)), "public"), {
      maxAge: "10m",
    }),
  );
  app.get("/vendor/:file", (req, res) => {
    const f = vendor[String(req.params.file)];
    if (!f) return res.sendStatus(404);
    res.sendFile(f, { maxAge: "7d" });
  });

  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  app.get("/api/stats", (_req, res) => {
    const s = config.stats?.get();
    res
      .set("Cache-Control", "public, max-age=60")
      .json(s ? { ...s, cluster: config.cluster } : { jobs: 0 });
  });

  app.get("/icon.svg", (_req, res) => {
    res
      .type("image/svg+xml")
      .set("Cache-Control", "public, max-age=86400")
      .send(views.iconSvg);
  });
  app.get("/", (_req, res) => {
    res.send(views.landingPage(ctx));
  });
  app.get("/new", (_req, res) => {
    res.send(views.newPage(ctx));
  });
  app.get("/demo", (_req, res) => {
    res.send(views.demoPage(ctx));
  });
  app.get(
    "/j/:job",
    wrap(async (req, res) => {
      const data = await jobData(
        parsePubkey(req.params.job, "job address"),
        null,
      );
      res.set("Cache-Control", "no-store").send(views.jobPage(ctx, data));
    }),
  );

  app.use((req: Request, res: Response) => {
    if (req.path.startsWith("/api/"))
      res.status(404).json({ error: "not_found", message: "Not found." });
    else res.status(404).send(views.errorPage(ctx, 404, "Nothing here."));
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const user = err instanceof UserError;
    const status = user
      ? err.status
      : (err as { status?: number }).status === 400
        ? 400
        : 500;
    const message = user
      ? err.message
      : status === 400
        ? "Malformed request."
        : "Solana didn't answer in time. Nothing was sent and your note is kept. Press the button again.";
    if (!user && status === 500) console.error(err);
    if (req.path.startsWith("/api/"))
      res
        .status(status)
        .json({ error: status < 500 ? "invalid" : "server", message });
    else res.status(status).send(views.errorPage(ctx, status, message));
  });

  return app;
}
