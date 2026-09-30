// Creates the app wallets and a test mint for localnet or devnet and writes .env.
//   npx tsx scripts/setup.ts localnet
//   npx tsx scripts/setup.ts devnet   → .env.devnet (fund the printed sponsor address with devnet SOL first)
import anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";

const bs58 = anchor.utils.bytes.bs58;
const cluster = process.argv[2] === "devnet" ? "devnet" : "localnet";
const ENV_FILE = cluster === "devnet" ? ".env.devnet" : ".env";
config({ path: ENV_FILE });
const rpc =
  process.env.SOLANA_RPC_URL && process.env.SOLANA_CLUSTER === cluster
    ? process.env.SOLANA_RPC_URL
    : cluster === "devnet"
      ? "https://api.devnet.solana.com"
      : "http://127.0.0.1:8899";
const connection = new Connection(rpc, "confirmed");

const load = (name: string) =>
  process.env[name]
    ? Keypair.fromSecretKey(bs58.decode(process.env[name]!))
    : Keypair.generate();
let mint: string | undefined;
const sponsor = load("SPONSOR_SECRET_KEY");
const demo = load("DEMO_SECRET_KEY");
const authority = load("TEST_MINT_AUTHORITY");

if (cluster === "localnet") {
  for (const k of [sponsor, demo, authority]) {
    const sig = await connection.requestAirdrop(
      k.publicKey,
      20 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(sig, "confirmed");
  }
} else {
  const have = await connection.getBalance(sponsor.publicKey);
  if (have < 0.5 * LAMPORTS_PER_SOL) {
    console.log(
      `Fund the sponsor with devnet SOL, then run this again:\n  ${sponsor.publicKey.toBase58()}`,
    );
    writeEnv();
    process.exit(1);
  }
  const tx = new Transaction();
  for (const k of [demo, authority])
    if ((await connection.getBalance(k.publicKey)) < 0.1 * LAMPORTS_PER_SOL)
      tx.add(
        SystemProgram.transfer({
          fromPubkey: sponsor.publicKey,
          toPubkey: k.publicKey,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        }),
      );
  if (tx.instructions.length)
    await sendAndConfirmTransaction(connection, tx, [sponsor]);
}

mint = process.env.SOLANA_CLUSTER === cluster ? process.env.MINT : undefined;
if (
  !mint ||
  !(await connection.getAccountInfo(
    new PublicKey(mint),
  ))
)
  mint = (
    await createMint(connection, authority, authority.publicKey, null, 6)
  ).toBase58();

writeEnv();
console.log(
  `${cluster}: MINT ${mint}\n  sponsor ${sponsor.publicKey.toBase58()}\n  demo    ${demo.publicKey.toBase58()}`,
);

function writeEnv() {
  const values: Record<string, string> = {
    SOLANA_CLUSTER: cluster,
    SOLANA_RPC_URL: rpc,
    MINT: mint ?? "",
    MINT_SYMBOL: "USDC",
    SPONSOR_SECRET_KEY: bs58.encode(sponsor.secretKey),
    DEMO_SECRET_KEY: bs58.encode(demo.secretKey),
    TEST_MINT_AUTHORITY: bs58.encode(authority.secretKey),
  };
  const lines = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, "utf8").split("\n")
    : [];
  const out = lines.filter(
    (l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)) && l.trim(),
  );
  for (const [k, v] of Object.entries(values)) out.push(`${k}=${v}`);
  writeFileSync(ENV_FILE, out.join("\n") + "\n");
}
