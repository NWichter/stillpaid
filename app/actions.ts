// Solana Actions (Blinks): a job as a shareable link that wallets and X unfurl
// into buttons. Spec: https://solana.com/docs/advanced/actions
import type { Express, Request, Response } from "express";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  Chain,
  UserError,
  parsePubkey,
  type Built,
  type MilestoneView,
} from "./chain.js";
import type { Cluster } from "./app.js";

const CHAIN_IDS: Record<Cluster, string> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  localnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

interface Deps {
  chain: Chain;
  cluster: Cluster;
  publicUrl: string;
  prepare: (
    action: string,
    body: any,
    account: PublicKey,
  ) => Promise<{ built: Built & { message: string }; transaction: string }>;
  onSponsored: (action: string, wallet: string) => void;
  maxDeliverySecs: number;
}

export function blinkUrl(publicUrl: string, cluster: Cluster, job: string) {
  const action = `solana-action:${publicUrl}/api/actions/job/${job}`;
  return `https://dial.to/?action=${encodeURIComponent(action)}${cluster === "mainnet-beta" ? "" : "&cluster=devnet"}`;
}

export function registerActions(app: Express, d: Deps) {
  const { chain } = d;
  const sym = chain.symbol;

  app.use(["/actions.json", "/api/actions"], (req, res, next) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
      "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
      "X-Action-Version": "2.4",
      "X-Blockchain-Ids": CHAIN_IDS[d.cluster],
    });
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });

  app.get("/actions.json", (_req, res) => {
    res.json({
      rules: [
        { pathPattern: "/j/*", apiPath: "/api/actions/job/*" },
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      ],
    });
  });

  const fail = (res: Response, e: unknown) => {
    const status = e instanceof UserError ? e.status : 500;
    res.status(status >= 400 && status < 600 ? status : 400).json({
      message:
        e instanceof UserError
          ? e.message
          : "Solana didn't answer in time. Try again.",
    });
  };

  const state = (m: MilestoneView, now: number) => {
    if (m.status === "submitted")
      return now > m.reviewDeadline
        ? "review over, ready to release"
        : `in review, Silent Yes in ${Math.ceil((m.reviewDeadline - now) / 60)} min`;
    return (
      {
        funded: "in escrow",
        disputed: "disputed",
        released: "paid",
        settled: "split agreed",
        resolved: "decided",
        refunded: "refunded",
      }[m.status] ?? m.status
    );
  };

  app.get("/api/actions/job/:job", async (req: Request, res) => {
    try {
      const key = parsePubkey(req.params.job, "job address");
      const job = await chain.getJob(key);
      if (!job) throw new UserError("Job not found.", 404);
      const [ms, now] = await Promise.all([
        chain.milestones(job),
        chain.chainNow(),
      ]);
      const base = `/api/actions/job/${job.address}`;
      const links: object[] = [];
      for (const m of ms) {
        const last = job.arbiter ? m.arbiterDeadline : m.negotiateDeadline;
        if (m.status === "submitted" && now > m.reviewDeadline)
          links.push({
            type: "transaction",
            label: `Release "${m.title}" (${chain.fmt(m.amount)} ${sym})`,
            href: `${base}/release/${m.index}`,
          });
        if (m.status === "disputed" && now > last)
          links.push({
            type: "transaction",
            label: `Apply the default split to "${m.title}"`,
            href: `${base}/fallback/${m.index}`,
          });
      }
      if (!job.accepted)
        links.push({
          type: "transaction",
          label: "Accept job (freelancer)",
          href: `${base}/accept`,
        });
      links.push({
        type: "transaction",
        label: "Fund a milestone (client)",
        href: `${base}/fund?title={title}&amount={amount}`,
        parameters: [
          { name: "title", label: "Milestone title", required: true },
          {
            name: "amount",
            label: `Amount in ${sym}`,
            type: "number",
            required: true,
          },
        ],
      });
      const lines = ms.map(
        (m) =>
          `${m.index + 1}. ${m.title}: ${chain.fmt(m.amount)} ${sym}, ${state(m, now)}`,
      );
      res.json({
        type: "action",
        icon: `${d.publicUrl}/pitch/img/blink.png`,
        title: job.title,
        description: [
          "Milestone escrow on Solana. If the client stays silent past the review deadline, anyone can release the payment.",
          ...lines,
        ].join("\n"),
        label: "Open",
        links: { actions: links },
      });
    } catch (e) {
      fail(res, e);
    }
  });

  const post =
    (action: string, body: (req: Request, now: number) => object) =>
    async (req: Request, res: Response) => {
      try {
        const account = parsePubkey(req.body?.account, "wallet");
        const now = await chain.chainNow();
        const { built, transaction } = await d.prepare(
          action,
          { job: req.params.job, ...body(req, now) },
          account,
        );
        const tx = Transaction.from(Buffer.from(transaction, "base64"));
        // Fees stay sponsored: the app signs as fee payer, the wallet adds its
        // own signature and sends. Quota is counted now, since we never see the send.
        if (!built.feePayer.equals(account)) {
          chain.signAsSponsor(tx);
          d.onSponsored(action, account.toBase58());
        }
        res.json({
          type: "transaction",
          transaction: tx
            .serialize({ requireAllSignatures: false, verifySignatures: false })
            .toString("base64"),
          message: built.message,
        });
      } catch (e) {
        fail(res, e);
      }
    };

  const index = (req: Request) => ({ index: req.params.index });
  app.post("/api/actions/job/:job/release/:index", post("release", index));
  app.post("/api/actions/job/:job/fallback/:index", post("fallback", index));
  app.post(
    "/api/actions/job/:job/accept",
    post("accept", () => ({})),
  );
  app.post(
    "/api/actions/job/:job/fund",
    post("addMilestone", (req, now) => ({
      title: req.query.title,
      amount: req.query.amount,
      deadline: now + Math.min(7 * 86_400, d.maxDeliverySecs) - 3600,
    })),
  );
}
