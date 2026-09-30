// Needs a local validator with the program deployed (scripts/deploy-local.sh):
//   SOLANA_RPC_URL=http://127.0.0.1:8899 npm test
// Time windows are at least 60 s, so the run takes about three minutes:
// every scenario is set up first, then the clock-based checks run after waits.
import anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const idl = JSON.parse(
  readFileSync(resolve("anchor/target/idl/stillpaid.json"), "utf8"),
);
const connection = new Connection(RPC, "confirmed");

let failures = 0;
let passes = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`,
  );
  if (ok) passes++;
  else failures++;
};
const expectError = async (
  p: Promise<unknown>,
  code: string,
  label: string,
) => {
  try {
    await p;
    check(false, label, "succeeded unexpectedly");
  } catch (e) {
    const msg =
      String((e as Error).message ?? e) +
      JSON.stringify((e as { logs?: string[] }).logs ?? []);
    check(
      msg.includes(code),
      label,
      msg.includes(code) ? code : msg.slice(0, 200),
    );
  }
};
const chainNow = async () =>
  (await connection.getBlockTime(await connection.getSlot("confirmed")))!;
const sleepUntil = async (unix: number) => {
  for (;;) {
    if ((await chainNow()) >= unix) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
};
const sha = (s: string) => [...createHash("sha256").update(s).digest()];

async function funded() {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(
    kp.publicKey,
    5 * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(sig, "confirmed");
  return kp;
}

const [client, freelancer, arbiter, stranger, sponsor] = await Promise.all([
  funded(),
  funded(),
  funded(),
  funded(),
  funded(),
]);
const programFor = (kp: Keypair) =>
  new Program(
    idl,
    new AnchorProvider(connection, new Wallet(kp), { commitment: "confirmed" }),
  );
const asClient = programFor(client);
const asFreelancer = programFor(freelancer);
const asArbiter = programFor(arbiter);
const asStranger = programFor(stranger);
const PROGRAM_ID = asClient.programId;

const mint = await createMint(connection, client, client.publicKey, null, 6);
const ata = async (owner: PublicKey) =>
  (await getOrCreateAssociatedTokenAccount(connection, client, mint, owner))
    .address;
const clientAta = await ata(client.publicKey);
const freelancerAta = await ata(freelancer.publicKey);
await mintTo(connection, client, mint, clientAta, client, 10_000_000_000);
const balance = async (a: PublicKey) =>
  BigInt((await getAccount(connection, a)).amount.toString());

const jobPda = (owner: PublicKey, id: number) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("job"),
      owner.toBuffer(),
      new BN(id).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID,
  )[0];
const milestonePda = (job: PublicKey, index: number) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("milestone"),
      job.toBuffer(),
      new BN(index).toArrayLike(Buffer, "le", 2),
    ],
    PROGRAM_ID,
  )[0];
const vaultOf = (m: PublicKey) => getAssociatedTokenAddressSync(mint, m, true);

const W = (review = 3600, fix = 3600, negotiate = 3600, arb = 3600) => ({
  review: new BN(review),
  fix: new BN(fix),
  negotiate: new BN(negotiate),
  arbiter: new BN(arb),
});

let nextId = 1;
async function createJob(
  opts: {
    windows?: ReturnType<typeof W>;
    maxRevisions?: number;
    fallbackBps?: number;
    arbiter?: PublicKey;
    freelancer?: PublicKey;
    title?: string;
  } = {},
) {
  const id = nextId++;
  const job = jobPda(client.publicKey, id);
  await asClient.methods
    .createJob(
      new BN(id),
      opts.freelancer ?? freelancer.publicKey,
      opts.arbiter ?? arbiter.publicKey,
      opts.windows ?? W(),
      opts.maxRevisions ?? 2,
      opts.fallbackBps ?? 5000,
      sha("terms"),
      opts.title ?? `Job ${id}`,
    )
    .accountsPartial({
      client: client.publicKey,
      payer: client.publicKey,
      job,
      mint,
    })
    .rpc();
  return job;
}

async function addMilestone(
  job: PublicKey,
  index: number,
  amount: number,
  deadlineIn = 7200,
) {
  const m = milestonePda(job, index);
  await asClient.methods
    .addMilestone(
      new BN(amount),
      new BN((await chainNow()) + deadlineIn),
      `Milestone ${index + 1}`,
    )
    .accountsPartial({
      client: client.publicKey,
      payer: client.publicKey,
      job,
      milestone: m,
      mint,
      clientToken: clientAta,
      vault: vaultOf(m),
    })
    .rpc();
  return m;
}

const accept = (job: PublicKey) =>
  asFreelancer.methods
    .acceptJob()
    .accountsPartial({ freelancer: freelancer.publicKey, job })
    .rpc();
const act = (
  p: InstanceType<typeof Program>,
  who: Keypair,
  method: string,
  args: unknown[],
  job: PublicKey,
  m: PublicKey,
) =>
  (p.methods as any)
    [method](...args)
    .accountsPartial({ actor: who.publicKey, job, milestone: m })
    .rpc();
const submit = (job: PublicKey, m: PublicKey, what = "delivery v1") =>
  act(asFreelancer, freelancer, "submit", [sha(what)], job, m);
const payout = (
  p: InstanceType<typeof Program>,
  who: Keypair,
  method: string,
  args: unknown[],
  job: PublicKey,
  m: PublicKey,
) =>
  (p.methods as any)
    [method](...args)
    .accountsPartial({
      actor: who.publicKey,
      job,
      milestone: m,
      mint,
      vault: vaultOf(m),
      freelancerToken: freelancerAta,
      clientToken: clientAta,
    })
    .rpc();
const fetchM = (m: PublicKey) =>
  (asClient.account as any).milestone.fetch(m) as Promise<any>;
const statusOf = async (m: PublicKey) =>
  Object.keys((await fetchM(m)).status)[0];

{
  const id = 9000;
  const job = jobPda(client.publicKey, id);
  const base = (over: Record<string, unknown>) => {
    const a = {
      freelancer: freelancer.publicKey,
      arbiter: arbiter.publicKey,
      windows: W(),
      maxRevisions: 2,
      fallbackBps: 5000,
      title: "x",
      ...over,
    } as any;
    return asClient.methods
      .createJob(
        new BN(id),
        a.freelancer,
        a.arbiter,
        a.windows,
        a.maxRevisions,
        a.fallbackBps,
        sha("t"),
        a.title,
      )
      .accountsPartial({
        client: client.publicKey,
        payer: client.publicKey,
        job,
        mint,
      })
      .rpc();
  };
  await expectError(
    base({ freelancer: client.publicKey }),
    "InvalidParties",
    "create: freelancer cannot be the client",
  );
  await expectError(
    base({ arbiter: freelancer.publicKey }),
    "InvalidParties",
    "create: arbiter cannot be the freelancer",
  );
  await expectError(
    base({ arbiter: client.publicKey }),
    "InvalidParties",
    "create: arbiter cannot be the client",
  );
  await expectError(
    base({ windows: W(30) }),
    "InvalidWindow",
    "create: review window under 60 s rejected",
  );
  await expectError(
    base({ windows: W(3600, 3600, 3600, 91 * 86400) }),
    "InvalidWindow",
    "create: window over 90 days rejected",
  );
  await expectError(
    base({ maxRevisions: 11 }),
    "InvalidRevisions",
    "create: more than 10 revisions rejected",
  );
  await expectError(
    base({ title: "" }),
    "InvalidTitle",
    "create: empty title rejected",
  );
  await expectError(
    base({ fallbackBps: 10001 }),
    "InvalidSplit",
    "create: fallback split over 100 % rejected",
  );

  const mint22 = await createMint(
    connection,
    client,
    client.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  await expectError(
    asClient.methods
      .createJob(
        new BN(id),
        freelancer.publicKey,
        arbiter.publicKey,
        W(),
        2,
        5000,
        sha("t"),
        "x",
      )
      .accountsPartial({
        client: client.publicKey,
        payer: client.publicKey,
        job,
        mint: mint22,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc(),
    "UnsupportedMint",
    "create: Token-2022 mint rejected",
  );
}

{
  const id = nextId++;
  const job = jobPda(client.publicKey, id);
  const now = await chainNow();
  const tx = new Transaction();
  tx.add(
    await asClient.methods
      .createJob(
        new BN(id),
        freelancer.publicKey,
        arbiter.publicKey,
        W(),
        2,
        5000,
        sha("terms"),
        "Sponsored job",
      )
      .accountsPartial({
        client: client.publicKey,
        payer: sponsor.publicKey,
        job,
        mint,
      })
      .instruction(),
  );
  for (let i = 0; i < 3; i++) {
    const m = milestonePda(job, i);
    tx.add(
      await asClient.methods
        .addMilestone(
          new BN(1_000_000 * (i + 1)),
          new BN(now + 3600),
          `M${i + 1}`,
        )
        .accountsPartial({
          client: client.publicKey,
          payer: sponsor.publicKey,
          job,
          milestone: m,
          mint,
          clientToken: clientAta,
          vault: vaultOf(m),
        })
        .instruction(),
    );
  }
  tx.feePayer = sponsor.publicKey;
  const clientSol = await connection.getBalance(client.publicKey);
  await sendAndConfirmTransaction(connection, tx, [sponsor, client], {
    commitment: "confirmed",
  });
  const j = await (asClient.account as any).job.fetch(job);
  check(j.milestoneCount === 3, "one tx: job with 3 funded milestones");
  check(
    (await balance(vaultOf(milestonePda(job, 2)))) === 3_000_000n,
    "one tx: milestone 3 vault holds 3.00",
  );
  check(
    (await connection.getBalance(client.publicKey)) === clientSol,
    "one tx: client paid no SOL (sponsor paid fees and rent)",
  );
}

{
  const job = await createJob();
  const m = milestonePda(job, 0);
  const now = await chainNow();
  const add = (amount: number, deadline: number, p = asClient, who = client) =>
    p.methods
      .addMilestone(new BN(amount), new BN(deadline), "m")
      .accountsPartial({
        client: who.publicKey,
        payer: who.publicKey,
        job,
        milestone: m,
        mint,
        clientToken: clientAta,
        vault: vaultOf(m),
      })
      .rpc();
  await expectError(
    add(0, now + 3600),
    "InvalidAmount",
    "add: zero amount rejected",
  );
  await expectError(
    add(1, now - 10),
    "InvalidDeadline",
    "add: past deadline rejected",
  );
  await expectError(
    add(1, now + 366 * 86400),
    "InvalidDeadline",
    "add: deadline over a year rejected",
  );
  await expectError(
    add(1, now + 3600, asStranger, stranger),
    "ConstraintHasOne",
    "add: a stranger cannot fund someone else's job",
  );
}

const jobA = await createJob();
const mA = await addMilestone(jobA, 0, 250_000_000);
await expectError(
  submit(jobA, mA),
  "NotAccepted",
  "A: no submit before the freelancer accepts",
);
await expectError(
  asStranger.methods
    .acceptJob()
    .accountsPartial({ freelancer: stranger.publicKey, job: jobA })
    .rpc(),
  "ConstraintHasOne",
  "A: only the named freelancer can accept",
);
await accept(jobA);
check(
  (await (asClient.account as any).job.fetch(jobA)).accepted,
  "A: freelancer accepted the job",
);
await expectError(accept(jobA), "AlreadyAccepted", "A: accepting twice fails");
await expectError(
  act(asClient, client, "submit", [sha("x")], jobA, mA),
  "NotFreelancer",
  "A: the client cannot submit",
);
await submit(jobA, mA);
check(
  (await statusOf(mA)) === "submitted",
  "A: delivery submitted, review window running",
);
await expectError(
  payout(asFreelancer, freelancer, "approve", [], jobA, mA),
  "NotClient",
  "A: the freelancer cannot approve their own work",
);
await expectError(
  payout(asClient, client, "releaseOnSilence", [], jobA, mA),
  "ReviewNotOver",
  "A: no release on silence while the review window is open",
);
{
  const before = await balance(freelancerAta);
  await payout(asClient, client, "approve", [], jobA, mA);
  check(
    (await balance(freelancerAta)) - before === 250_000_000n,
    "A: approve pays the freelancer 250.00",
  );
  check((await statusOf(mA)) === "released", "A: milestone released");
  await expectError(
    payout(asClient, client, "approve", [], jobA, mA),
    "WrongStatus",
    "A: a second payout fails on-chain",
  );
}

const jobB = await createJob({ windows: W(60) });
const mB = await addMilestone(jobB, 0, 100_000_000);
await accept(jobB);
await submit(jobB, mB);
const reviewB = Number((await fetchM(mB)).reviewDeadline);

const jobC = await createJob({ maxRevisions: 1 });
const mC = await addMilestone(jobC, 0, 100_000_000);
await accept(jobC);
await submit(jobC, mC);
await act(
  asClient,
  client,
  "requestRevision",
  [sha("logo too small")],
  jobC,
  mC,
);
{
  const c = await fetchM(mC);
  check(
    Object.keys(c.status)[0] === "funded" && c.revisions === 1,
    "C: revision requested, back to the freelancer (1 of 1)",
  );
}
await submit(jobC, mC, "delivery v2");
await expectError(
  act(asClient, client, "requestRevision", [sha("again")], jobC, mC),
  "RevisionsUsedUp",
  "C: no revision beyond the agreed number",
);
await expectError(
  act(asStranger, stranger, "openDispute", [sha("x")], jobC, mC),
  "NotAParty",
  "C: a stranger cannot open a dispute",
);
await act(asClient, client, "openDispute", [sha("still wrong")], jobC, mC);
check((await statusOf(mC)) === "disputed", "C: client opened a dispute");
await expectError(
  payout(asFreelancer, freelancer, "acceptSplit", [7000], jobC, mC),
  "NoOfferFromOtherSide",
  "C: nothing to accept before an offer",
);
await act(asFreelancer, freelancer, "proposeSplit", [7000], jobC, mC);
await expectError(
  act(asFreelancer, freelancer, "proposeSplit", [10001], jobC, mC),
  "InvalidSplit",
  "C: split over 100 % rejected",
);
await expectError(
  payout(asFreelancer, freelancer, "acceptSplit", [7000], jobC, mC),
  "NoOfferFromOtherSide",
  "C: the freelancer cannot accept their own offer",
);
await expectError(
  payout(asClient, client, "acceptSplit", [6000], jobC, mC),
  "OfferChanged",
  "C: accepting a different split than offered fails",
);
{
  const f0 = await balance(freelancerAta);
  const c0 = await balance(clientAta);
  await payout(asClient, client, "acceptSplit", [7000], jobC, mC);
  check(
    (await balance(freelancerAta)) - f0 === 70_000_000n &&
      (await balance(clientAta)) - c0 === 30_000_000n,
    "C: agreed split pays 70.00 / 30.00",
  );
  check((await statusOf(mC)) === "settled", "C: milestone settled");
}

const jobD = await createJob({ windows: W(3600, 3600, 60, 3600) });
const mD = await addMilestone(jobD, 0, 100_000_000);
await accept(jobD);
await submit(jobD, mD);
await act(
  asClient,
  client,
  "requestRevision",
  [sha("change it all")],
  jobD,
  mD,
);
await act(
  asFreelancer,
  freelancer,
  "openDispute",
  [sha("out of scope")],
  jobD,
  mD,
);
check(
  (await statusOf(mD)) === "disputed",
  "D: freelancer disputed the revision request",
);
await expectError(
  payout(asArbiter, arbiter, "resolve", [2500], jobD, mD),
  "StillNegotiating",
  "D: the arbiter waits for the negotiation window",
);
const negotiateD = Number((await fetchM(mD)).negotiateDeadline);

const jobE = await createJob({ windows: W(3600, 3600, 60, 60) });
const mE = await addMilestone(jobE, 0, 100_000_001);
await accept(jobE);
await submit(jobE, mE);
await act(asClient, client, "openDispute", [sha("no")], jobE, mE);
const eM = await fetchM(mE);

const jobF = await createJob({
  windows: W(3600, 3600, 60, 3600),
  arbiter: PublicKey.default,
  fallbackBps: 8000,
});
const mF = await addMilestone(jobF, 0, 80_000_000);
await accept(jobF);
await submit(jobF, mF);
await act(asClient, client, "openDispute", [sha("no")], jobF, mF);
await expectError(
  payout(asArbiter, arbiter, "resolve", [5000], jobF, mF),
  "NoArbiter",
  "F: no arbiter, nobody can resolve",
);
const negotiateF = Number((await fetchM(mF)).negotiateDeadline);

{
  const job = await createJob({ windows: W(3600, 60, 3600, 3600) });
  const m = await addMilestone(job, 0, 10_000_000, 7200);
  const other = await addMilestone(job, 1, 10_000_000, 7200);
  await accept(job);
  await submit(job, m);
  const before = Number((await fetchM(m)).deliveryDeadline);
  await act(asClient, client, "requestRevision", [sha("small fix")], job, m);
  check(
    Number((await fetchM(m)).deliveryDeadline) === before,
    "H: a revision request never shortens the delivery deadline",
  );
  await submit(job, m, "v2");
  await expectError(
    (asClient.methods as any)
      .approve()
      .accountsPartial({
        actor: client.publicKey,
        job,
        milestone: m,
        mint,
        vault: vaultOf(other),
        freelancerToken: freelancerAta,
        clientToken: clientAta,
      })
      .rpc(),
    "ConstraintTokenOwner",
    "H: another milestone's vault cannot be substituted",
  );
  await expectError(
    (asClient.methods as any)
      .approve()
      .accountsPartial({
        actor: client.publicKey,
        job,
        milestone: m,
        mint,
        vault: vaultOf(m),
        freelancerToken: clientAta,
        clientToken: clientAta,
      })
      .rpc(),
    "ConstraintTokenOwner",
    "H: payout cannot be redirected to another token account",
  );
}

{
  const job = await createJob();
  const m = await addMilestone(job, 0, 40_000_000);
  const c0 = await balance(clientAta);
  await payout(asClient, client, "refund", [], job, m);
  check(
    (await balance(clientAta)) - c0 === 40_000_000n &&
      (await statusOf(m)) === "refunded",
    "G: before acceptance the client can take the money back",
  );
}
const jobG = await createJob();
const mG = await addMilestone(jobG, 0, 40_000_000, 20);
await accept(jobG);
await expectError(
  payout(asClient, client, "refund", [], jobG, mG),
  "NotLate",
  "G: after acceptance no refund before the delivery deadline",
);
const deliveryG = Number((await fetchM(mG)).deliveryDeadline);

await sleepUntil(Math.max(reviewB, deliveryG) + 2);
await expectError(
  act(asClient, client, "requestRevision", [sha("late")], jobB, mB),
  "ReviewOver",
  "B: no revision request after the review window",
);
await expectError(
  act(asClient, client, "openDispute", [sha("late")], jobB, mB),
  "ReviewOver",
  "B: no dispute after the review window",
);
{
  const f0 = await balance(freelancerAta);
  await payout(asStranger, stranger, "releaseOnSilence", [], jobB, mB);
  check(
    (await balance(freelancerAta)) - f0 === 100_000_000n &&
      (await statusOf(mB)) === "released",
    "B: silence → anyone releases 100.00 to the freelancer",
  );
}
await expectError(
  submit(jobG, mG),
  "DeliveryLate",
  "G: no submission after the delivery deadline",
);
await expectError(
  payout(asFreelancer, freelancer, "refund", [], jobG, mG),
  "NotClient",
  "G: only the client can take back a late milestone",
);
{
  const c0 = await balance(clientAta);
  await payout(asClient, client, "refund", [], jobG, mG);
  check(
    (await balance(clientAta)) - c0 === 40_000_000n,
    "G: late delivery → client refunded 40.00",
  );
}

await sleepUntil(Math.max(negotiateD, negotiateF) + 2);
await expectError(
  payout(asStranger, stranger, "resolve", [2500], jobD, mD),
  "NotArbiter",
  "D: only the arbiter can resolve",
);
await expectError(
  payout(asArbiter, arbiter, "resolve", [10001], jobD, mD),
  "InvalidSplit",
  "D: arbiter split over 100 % rejected",
);
{
  const f0 = await balance(freelancerAta);
  const c0 = await balance(clientAta);
  await payout(asArbiter, arbiter, "resolve", [2500], jobD, mD);
  check(
    (await balance(freelancerAta)) - f0 === 25_000_000n &&
      (await balance(clientAta)) - c0 === 75_000_000n &&
      (await statusOf(mD)) === "resolved",
    "D: arbiter decides 25 / 75",
  );
}
await expectError(
  payout(asStranger, stranger, "fallbackSplit", [], jobE, mE),
  "FallbackNotDue",
  "E: no fallback while the arbiter still has time",
);
{
  const f0 = await balance(freelancerAta);
  await payout(asStranger, stranger, "fallbackSplit", [], jobF, mF);
  check(
    (await balance(freelancerAta)) - f0 === 64_000_000n,
    "F: no arbiter → the agreed fallback split (80 %) after the negotiation window",
  );
}

await sleepUntil(Number(eM.arbiterDeadline) + 2);
await expectError(
  payout(asArbiter, arbiter, "resolve", [2500], jobE, mE),
  "ArbiterTooLate",
  "E: the arbiter cannot decide after the arbiter deadline",
);
{
  const f0 = await balance(freelancerAta);
  const c0 = await balance(clientAta);
  await payout(asStranger, stranger, "fallbackSplit", [], jobE, mE);
  // 100.000001 split: freelancer gets the rounded-down half, the client the rest.
  check(
    (await balance(freelancerAta)) - f0 === 50_000_000n &&
      (await balance(clientAta)) - c0 === 50_000_001n,
    "E: arbiter silent too → 50/50, rounding in the client's favour",
  );
  await expectError(
    payout(asStranger, stranger, "fallbackSplit", [], jobE, mE),
    "WrongStatus",
    "E: a settled milestone cannot pay out twice",
  );
}

const closeM = (
  m: PublicKey,
  job: PublicKey,
  as: [InstanceType<typeof Program>, Keypair] = [asClient, client],
) =>
  (as[0].methods as any)
    .closeMilestone()
    .accountsPartial({
      job,
      milestone: m,
      rentPayer: as[1].publicKey,
      mint,
      vault: vaultOf(m),
      clientToken: clientAta,
    })
    .rpc();
await expectError(closeM(mE, jobE), "TooEarlyToClose", "close: a just-settled milestone stays on record");
await expectError(
  (asClient.methods as any).closeJob().accountsPartial({ job: jobA, rentPayer: client.publicKey }).rpc(),
  "MilestonesOpen",
  "close: a job with open milestones cannot be closed",
);
await expectError(closeM(mG, jobG, [asStranger, stranger]), "ConstraintHasOne", "close: only whoever paid the rent can close");
{
  const job = await createJob();
  const m = await addMilestone(job, 0, 1_000_000);
  await expectError(closeM(m, job), "WrongStatus", "close: an open milestone cannot be closed");
}
await sleepUntil((await chainNow()) + 62);
{
  const sol0 = await connection.getBalance(client.publicKey);
  await closeM(mA, jobA);
  const gained = (await connection.getBalance(client.publicKey)) - sol0;
  check(
    gained > 0 && (await connection.getAccountInfo(mA)) === null && (await connection.getAccountInfo(vaultOf(mA))) === null,
    "close: milestone and vault closed, rent back to the payer",
    `${gained} lamports`,
  );
  await (asClient.methods as any).closeJob().accountsPartial({ job: jobA, rentPayer: client.publicKey }).rpc();
  check((await connection.getAccountInfo(jobA)) === null, "close: job closed once its milestones are closed");
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
