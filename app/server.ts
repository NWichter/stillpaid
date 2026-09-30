import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createApp, type Cluster } from "./app.js";
import { crank, DemoCounterpart, reclaimRent } from "./bot.js";
import { Chain, parseSecretKey } from "./chain.js";
import { TextStore } from "./store.js";
import { StatsIndexer } from "./stats.js";
import { resolve } from "node:path";

const port = Number(process.env.PORT ?? 4050);
const cluster = (
  ["devnet", "mainnet-beta"].includes(process.env.SOLANA_CLUSTER ?? "")
    ? process.env.SOLANA_CLUSTER
    : "localnet"
) as Cluster;
const rpcUrl =
  process.env.SOLANA_RPC_URL ??
  {
    localnet: "http://127.0.0.1:8899",
    devnet: "https://api.devnet.solana.com",
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
  }[cluster];
const publicUrl = (
  process.env.PUBLIC_URL ?? `http://localhost:${port}`
).replace(/\/+$/, "");
const dataDir = process.env.DATA_DIR ?? "data";

function key(name: string): Keypair | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  try {
    return parseSecretKey(v);
  } catch {
    console.error(`${name} is not a valid secret key.`);
    process.exit(1);
  }
}

if (!process.env.MINT) {
  console.error("MINT is not set (a classic SPL mint, e.g. USDC).");
  process.exit(1);
}
const sponsor = key("SPONSOR_SECRET_KEY");
const chain = new Chain(rpcUrl, {
  mint: new PublicKey(process.env.MINT),
  symbol: process.env.MINT_SYMBOL,
  sponsor,
});
for (let attempt = 1; ; attempt++) {
  try {
    await chain.init();
    break;
  } catch (e) {
    if (attempt >= 8) throw e;
    console.warn(`RPC not ready (${(e as Error).message}); retrying`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

const texts = new TextStore(resolve(dataDir, "texts.jsonl"));
const demoKey = key("DEMO_SECRET_KEY");
const mintAuthority = key("TEST_MINT_AUTHORITY");
const demo =
  cluster !== "mainnet-beta" && demoKey && mintAuthority
    ? new DemoCounterpart(chain, demoKey, mintAuthority, texts)
    : undefined;

const stats = new StatsIndexer(chain, resolve(dataDir, "stats.json"));
const app = createApp({
  chain,
  cluster,
  rpcUrl,
  publicUrl,
  dataDir,
  texts,
  demo,
  stats,
});

const every = (ms: number, fn: () => Promise<unknown>) => {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    fn()
      .catch((e) => console.warn(e.message))
      .finally(() => (busy = false));
  }, ms).unref();
};
const cranker = sponsor ?? demoKey;
// Scans every 30 s, and wakes up early when a review window is about to end.
async function crankLoop(key: Keypair) {
  let wait = 30;
  try {
    const ours = [sponsor, demoKey].flatMap((k) => (k ? [k.publicKey] : []));
    const { done, nextDue } = await crank(chain, key, ours);
    if (done) console.log(`crank: paid out ${done} due milestone(s)`);
    wait = Math.min(30, Math.max(3, nextDue + 2));
  } catch (e) {
    console.warn((e as Error).message);
  }
  setTimeout(() => crankLoop(key), wait * 1000).unref();
}
if (cranker) crankLoop(cranker);
if (demo) every(8_000, () => demo.tick());
const indexStats = () =>
  stats.update().catch((e) => console.warn(`stats: ${e.message}`));
setTimeout(indexStats, 15_000).unref();
every(5 * 60_000, indexStats);
// Test networks hand demo rent back after a day; mainnet keeps records for 60 days.
const keepSecs = Number(
  process.env.KEEP_SETTLED_SECS ??
    (cluster === "mainnet-beta" ? 60 : 1) * 86400,
);
for (const k of [sponsor, demoKey])
  if (k)
    every(5 * 60_000, async () => {
      const n = await reclaimRent(chain, k, keepSecs);
      if (n) console.log(`reclaimed rent of ${n} settled milestone(s)`);
    });

app.listen(port, () => {
  console.log(`Stillpaid on ${publicUrl} · ${cluster} · RPC ${rpcUrl}`);
  if (sponsor) console.log(`Fees paid by ${sponsor.publicKey.toBase58()}`);
  if (demo) console.log(`Demo counterpart ${demo.address}`);
  chain
    .isDeployed()
    .then(
      (ok) =>
        !ok && console.warn("The program is not deployed on this cluster."),
    )
    .catch((e) => console.warn(`RPC not reachable: ${e.message}`));
});
