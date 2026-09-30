// End-to-end check of the app's HTTP API, signing like a browser wallet would.
// Needs the app running with the demo counterpart (scripts/setup.ts localnet, npm run app).
//   BASE=http://localhost:4050 npx tsx scripts/app-smoke.ts
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import "dotenv/config";

const BASE = process.env.BASE ?? "http://localhost:4050";
const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
  "confirmed",
);

let failures = 0;
let passes = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`,
  );
  if (ok) passes++;
  else failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, body?: unknown) {
  const r = await fetch(
    BASE + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return { status: r.status, json: (await r.json()) as any };
}

async function tx(kp: Keypair, action: string, body: Record<string, unknown>) {
  const r = await api("/api/tx", {
    action,
    account: kp.publicKey.toBase58(),
    ...body,
  });
  if (r.status !== 200) throw new Error(r.json.message);
  const t = Transaction.from(Buffer.from(r.json.transaction, "base64"));
  t.partialSign(kp);
  const s = await api("/api/send", {
    transaction: t
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  });
  if (s.status !== 200) throw new Error(s.json.message);
  return { ...r.json, signature: s.json.signature };
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | false>,
  ms = 60_000,
) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(1500);
  }
}

const job = async (address: string, wallet?: Keypair) =>
  (
    await api(
      `/api/job/${address}${wallet ? `?wallet=${wallet.publicKey.toBase58()}` : ""}`,
    )
  ).json;
const balance = async (kp: Keypair) =>
  Number(
    (await api(`/api/balance?wallet=${kp.publicKey.toBase58()}`)).json.balance,
  );

// Browser wallets hold no SOL here: the sponsor must pay every fee.
const freelancer = Keypair.generate();
const client = Keypair.generate();
const stranger = Keypair.generate();

for (const path of [
  "/",
  "/new",
  "/demo",
  "/static/app.css",
  "/static/job.js",
  "/vendor/web3.iife.min.js",
]) {
  const r = await fetch(BASE + path);
  check(r.status === 200, `GET ${path}`);
}

// Side A: the visitor is the freelancer; the demo client stays silent.
const hired = await api("/api/demo/hire", {
  account: freelancer.publicKey.toBase58(),
});
check(
  hired.status === 200 && !!hired.json.job,
  "A: demo client hires the visitor and funds 25",
);
const jobA = hired.json.job as string;
{
  const d = await job(jobA, freelancer);
  check(
    d.role === "freelancer" && !d.job.accepted,
    "A: visitor sees the job as freelancer, not yet accepted",
  );
  check(
    (await fetch(`${BASE}/j/${jobA}`)).status === 200,
    "A: job page renders",
  );
}
try {
  await tx(freelancer, "submit", { job: jobA, index: 0, text: "too early" });
  check(false, "A: submit before accept is refused");
} catch (e) {
  check(
    /not accepted/.test((e as Error).message),
    "A: submit before accept is refused",
    (e as Error).message,
  );
}
await tx(freelancer, "accept", { job: jobA });
const sub = await tx(freelancer, "submit", {
  job: jobA,
  index: 0,
  text: "Fresh from the oven, every morning.\nBaked by hand in Berlin since 1998.",
});
check(
  sub.sponsored === true,
  "A: fees paid by the sponsor (wallet has no SOL)",
);
check(
  (await connection.getBalance(freelancer.publicKey)) === 0,
  "A: freelancer wallet still holds 0 SOL",
);
{
  const d = await job(jobA, freelancer);
  const m = d.milestones[0];
  check(
    m.status === "submitted" && !!d.texts[m.deliverableHash],
    "A: delivery stored, fingerprint on-chain",
  );
}
{
  const d = await job(jobA);
  const ics = await fetch(`${BASE}/api/ics/${d.milestones[0].address}`);
  check(
    ics.status === 200 && (await ics.text()).includes("BEGIN:VEVENT"),
    "A: review deadline downloadable as a calendar entry",
  );
}
try {
  await tx(stranger, "approve", { job: jobA, index: 0 });
  check(false, "A: a stranger cannot approve");
} catch (e) {
  check(
    /Only the client/.test((e as Error).message),
    "A: a stranger cannot approve",
    (e as Error).message,
  );
}

// Side B: the visitor is the client; the demo freelancer answers.
const faucet = await api("/api/faucet", {
  account: client.publicKey.toBase58(),
});
check(faucet.status === 200, "B: faucet sends 100 test tokens");
const again = await api("/api/faucet", {
  account: client.publicKey.toBase58(),
});
check(again.status === 429, "B: faucet once per wallet per day");
const cfg = JSON.parse(
  /<script type="application\/json" id="cfg">(.*?)<\/script>/.exec(
    await (await fetch(`${BASE}/new`)).text(),
  )![1],
);
const now = Math.floor(Date.now() / 1000);
const create = (over: Record<string, unknown> = {}) =>
  tx(client, "create", {
    title: "Bakery landing page",
    freelancer: cfg.demo,
    arbiter: null,
    terms: "One-page website. Review 2 minutes.",
    maxRevisions: 1,
    windows: { review: 120, fix: 120, negotiate: 120, arbiter: 120 },
    milestones: [
      { title: "Landing page", amount: "20", deadline: now + 3600 },
      { title: "Contact form", amount: "12.5", deadline: now + 3600 },
    ],
    ...over,
  });
try {
  await create({ freelancer: client.publicKey.toBase58() });
  check(false, "B: cannot hire yourself");
} catch (e) {
  check(
    /different wallet/.test((e as Error).message),
    "B: cannot hire yourself",
    (e as Error).message,
  );
}
try {
  await create({
    milestones: [{ title: "Too much", amount: "500", deadline: now + 3600 }],
  });
  check(false, "B: cannot fund more than the wallet holds");
} catch (e) {
  check(
    /You need 500/.test((e as Error).message),
    "B: cannot fund more than the wallet holds",
    (e as Error).message,
  );
}
const created = await create();
const jobB = created.job as string;
check(
  !!jobB && (await balance(client)) === 67.5,
  "B: job created, 32.50 moved into escrow",
);

await waitFor(
  "demo freelancer delivers",
  async () => (await job(jobB)).milestones[0].status === "submitted",
);
check(true, "B: demo freelancer accepted and delivered milestone 1");
{
  const d = await job(jobB, client);
  check(
    d.actions[0].includes("approve") && d.actions[0].includes("revision"),
    "B: client may approve or ask for a revision",
  );
}
await tx(client, "revision", {
  job: jobB,
  index: 0,
  text: "Please add the opening hours.",
});
await waitFor("demo freelancer resubmits", async () => {
  const m = (await job(jobB)).milestones[0];
  return m.status === "submitted" && m.submissions === 2;
});
check(true, "B: demo freelancer delivered version 2");
{
  const d = await job(jobB, client);
  check(
    !d.actions[0].includes("revision"),
    "B: no revision left (1 of 1 used)",
  );
}
await tx(client, "dispute", {
  job: jobB,
  index: 0,
  text: "Opening hours still missing.",
});
await waitFor(
  "demo freelancer offers a split",
  async () => (await job(jobB)).milestones[0].proposalBy === "freelancer",
);
{
  const m = (await job(jobB)).milestones[0];
  check(m.proposalBps === 6000, "B: demo freelancer offers 60 %");
  try {
    await tx(client, "acceptSplit", { job: jobB, index: 0, bps: 5000 });
    check(false, "B: accepting a different split fails");
  } catch (e) {
    check(
      /offer changed/i.test((e as Error).message),
      "B: accepting a different split fails",
      (e as Error).message,
    );
  }
  const before = await balance(client);
  await tx(client, "acceptSplit", { job: jobB, index: 0, bps: 6000 });
  // Public RPC nodes can lag a moment behind the confirmed transaction.
  const settled = await waitFor(
    "split settled",
    async () =>
      (await job(jobB)).milestones[0].status === "settled" &&
      (await balance(client)) - before === 8,
    20_000,
  ).catch(() => false);
  check(
    settled === true,
    "B: split settled, 8.00 back to the client",
  );
}
await waitFor(
  "milestone 2 delivered",
  async () => (await job(jobB)).milestones[1].status === "submitted",
);
await tx(client, "approve", { job: jobB, index: 1 });
check(
  (await job(jobB)).milestones[1].status === "released",
  "B: client signs off milestone 2",
);
await tx(client, "addMilestone", {
  job: jobB,
  title: "Extra page",
  amount: "5",
  deadline: now + 7200,
});
check(
  (await job(jobB)).milestones.length === 3,
  "B: client funds a third milestone later",
);

{
  const sponsor = Keypair.fromSecretKey(
    anchor.utils.bytes.bs58.decode(process.env.SPONSOR_SECRET_KEY ?? ""),
  ).publicKey.toBase58();
  const r = await api("/api/tx", {
    action: "accept",
    account: sponsor,
    job: jobA,
  });
  check(
    r.status === 403,
    "security: the app's own fee wallet cannot be used as a party",
  );
  const built = await api("/api/tx", {
    action: "addMilestone",
    account: client.publicKey.toBase58(),
    job: jobB,
    title: "Check",
    amount: "1",
    deadline: now + 7200,
  });
  const unsigned = Transaction.from(
    Buffer.from(built.json.transaction, "base64"),
  );
  check(
    unsigned.feePayer?.toBase58() === sponsor &&
      unsigned.signatures.every((s) => s.signature === null),
    "security: prepared transactions carry no sponsor signature",
  );
  const foreign = new Transaction({
    feePayer: client.publicKey,
    recentBlockhash: unsigned.recentBlockhash,
  }).add(unsigned.instructions[0]);
  foreign.partialSign(client);
  const relay = await api("/api/send", {
    transaction: foreign
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  });
  check(
    relay.status === 409,
    "security: transactions not prepared by the app are not relayed",
  );
}

// Back to side A: nobody answered, so the crank releases after the review window.
const reviewEnd = (await job(jobA)).milestones[0].reviewDeadline;
console.log(
  `… waiting for the review window of job A (${Math.max(0, reviewEnd - Math.floor(Date.now() / 1000))} s)`,
);
await waitFor(
  "silence releases job A",
  async () => (await job(jobA)).milestones[0].status === "released",
  200_000,
);
check(
  (await balance(freelancer)) === 25,
  "A: silence → 25.00 arrived in the freelancer's wallet",
);
{
  // History is filled in over a few polls, like on the job page.
  const d = await waitFor(
    "history of job A",
    async () => {
      const j = await job(jobA);
      return j.history[0].some((e: any) => e.event === "Paid") && j;
    },
    60_000,
  );
  const paid = d.history[0].find((e: any) => e.event === "Paid");
  check(
    paid?.outcome === "silence" &&
      d.history[0].some((e: any) => e.event === "Submitted"),
    "A: on-chain activity shows the delivery and the payout on silence",
  );
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
