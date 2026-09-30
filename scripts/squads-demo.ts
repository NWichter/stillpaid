// A Squads v4 multisig as the client, on devnet: the vault funds a job, the
// members approve milestone 1 together, milestone 2 is paid on silence.
//   node --env-file=.env.devnet --import tsx scripts/squads-demo.ts
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import * as multisig from "@sqds/multisig";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Chain, parseSecretKey } from "../app/chain.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
});
const chain = new Chain(RPC, {
  mint: new PublicKey(process.env.MINT!),
  symbol: process.env.MINT_SYMBOL,
});
await chain.init();
const funder = parseSecretKey(process.env.SPONSOR_SECRET_KEY!);
const mintAuthority = parseSecretKey(process.env.TEST_MINT_AUTHORITY!);

const tx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const log: Record<string, string> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The public devnet RPC rate-limits hard: back off and try again. */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 8 || !/429|Too many|fetch failed/i.test(String(e))) throw e;
      await sleep(2000 * i);
    }
  }
}

async function confirmed(sig: string) {
  for (let i = 0; i < 40; i++) {
    await sleep(2500);
    const s = (
      await retry(() => connection.getSignatureStatuses([sig]))
    ).value[0];
    if (s?.err) throw new Error(`${sig} failed: ${JSON.stringify(s.err)}`);
    if (
      s?.confirmationStatus === "confirmed" ||
      s?.confirmationStatus === "finalized"
    )
      return sig;
  }
  throw new Error(`${sig} not confirmed`);
}
async function send(ixs: TransactionInstruction[], signers: Keypair[]) {
  const t = new Transaction().add(...ixs);
  t.feePayer = signers[0].publicKey;
  t.recentBlockhash = (
    await retry(() => connection.getLatestBlockhash())
  ).blockhash;
  t.sign(...signers);
  return confirmed(await retry(() => connection.sendRawTransaction(t.serialize())));
}

const [alice, bob, freelancer] = [
  Keypair.generate(),
  Keypair.generate(),
  Keypair.generate(),
];
const createKey = Keypair.generate();
const [msPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
const [vault] = multisig.getVaultPda({ multisigPda: msPda, index: 0 });
console.log(`multisig ${msPda.toBase58()}, vault ${vault.toBase58()}`);

await send(
  [
    [alice.publicKey, 0.08],
    [bob.publicKey, 0.02],
    [freelancer.publicKey, 0.03],
    [vault, 0.04],
  ].map(([to, sol]) =>
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: to as PublicKey,
      lamports: Math.round((sol as number) * LAMPORTS_PER_SOL),
    }),
  ),
  [funder],
);
const vaultAta = chain.ata(vault);
await send(
  [
    createAssociatedTokenAccountIdempotentInstruction(
      funder.publicKey,
      vaultAta,
      vault,
      chain.mint,
    ),
    createMintToInstruction(
      chain.mint,
      vaultAta,
      mintAuthority.publicKey,
      30n * 10n ** BigInt(chain.decimals),
    ),
  ],
  [funder, mintAuthority],
);

const [configPda] = multisig.getProgramConfigPda({});
const { treasury } = await multisig.accounts.ProgramConfig.fromAccountAddress(
  connection,
  configPda,
);
const all = multisig.types.Permissions.all();
log.multisig = tx(
  await confirmed(
    await multisig.rpc.multisigCreateV2({
      connection,
      treasury,
      createKey,
      creator: alice,
      multisigPda: msPda,
      configAuthority: null,
      threshold: 2,
      members: [
        { key: alice.publicKey, permissions: all },
        { key: bob.publicKey, permissions: all },
      ],
      timeLock: 0,
      rentCollector: null,
    }),
  ),
);

let index = 0n;
/** Proposes `ixs` from the vault, both members approve, Alice executes. */
async function viaSquads(ixs: TransactionInstruction[], label: string) {
  index += 1n;
  const common = {
    connection,
    feePayer: alice,
    multisigPda: msPda,
    transactionIndex: index,
  };
  const { blockhash } = await connection.getLatestBlockhash();
  await confirmed(
    await multisig.rpc.vaultTransactionCreate({
      ...common,
      creator: alice.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: new TransactionMessage({
        payerKey: vault,
        recentBlockhash: blockhash,
        instructions: ixs,
      }),
    }),
  );
  await confirmed(
    await multisig.rpc.proposalCreate({ ...common, creator: alice }),
  );
  log[`${label} · approved by Alice`] = tx(
    await confirmed(
      await multisig.rpc.proposalApprove({ ...common, member: alice }),
    ),
  );
  log[`${label} · approved by Bob`] = tx(
    await confirmed(
      await multisig.rpc.proposalApprove({ ...common, member: bob }),
    ),
  );
  log[`${label} · executed`] = tx(
    await confirmed(
      await multisig.rpc.vaultTransactionExecute({
        ...common,
        member: alice.publicKey,
      }),
    ),
  );
}

const now = await chain.chainNow();
const terms =
  "Demo: a Squads multisig (2 of 2) hires a freelancer. Review 90 seconds; silence counts as approval.";
const created = await chain.buildCreate(vault, {
  jobId: randomBytes(8).readBigUInt64LE(),
  freelancer: freelancer.publicKey,
  arbiter: null,
  windows: { review: 90, fix: 120, negotiate: 120, arbiter: 120 },
  maxRevisions: 1,
  fallbackBps: 5000,
  termsHash: [...createHash("sha256").update(terms).digest()],
  title: "Squads multisig as client (demo)",
  milestones: [
    {
      title: "Design",
      amount: 10n * 10n ** BigInt(chain.decimals),
      deadline: now + 3600,
    },
  ],
});
const job = created.job;
await viaSquads(created.ixs, "Create job and fund milestone 1");
const second = await chain.buildAddMilestone(vault, job, {
  title: "Build",
  amount: 15n * 10n ** BigInt(chain.decimals),
  deadline: now + 3600,
});
await viaSquads(second.ixs, "Fund milestone 2");

const asFreelancer = async (b: { ixs: TransactionInstruction[] }) =>
  send(b.ixs, [freelancer]);
log["Freelancer accepts"] = tx(
  await asFreelancer(await chain.buildAccept(freelancer.publicKey, job)),
);
for (const i of [0, 1]) {
  const hash = [
    ...createHash("sha256")
      .update(`Delivery ${i + 1}`)
      .digest(),
  ];
  log[`Freelancer submits milestone ${i + 1}`] = tx(
    await asFreelancer(
      await chain.buildAct("submit", freelancer.publicKey, job, i, hash),
    ),
  );
}
await viaSquads(
  (await chain.buildPayout("approve", vault, job, 0)).ixs,
  "Approve milestone 1",
);

const m2 = await chain.mustGetMilestone(job, 1);
while ((await chain.chainNow()) <= m2.reviewDeadline) await sleep(3000);
await sleep(2000);
log["Milestone 2 released on silence (by the freelancer)"] = tx(
  await asFreelancer(
    await chain.buildPayout("releaseOnSilence", freelancer.publicKey, job, 1),
  ),
);

const out = {
  job: `https://stillpaid.sorevo.de/j/${job.toBase58()}`,
  multisig: msPda.toBase58(),
  vault: vault.toBase58(),
  steps: log,
};
writeFileSync("data/squads-demo.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
