// Checks the Solana Actions endpoints the way a Blink client uses them:
// GET the action, POST an account, sign the returned transaction, send it.
//   BASE=http://localhost:4050 npx tsx scripts/blink-check.ts
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import "dotenv/config";

const BASE = process.env.BASE ?? "http://localhost:4050";
const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
  "confirmed",
);
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`,
  );
  if (!ok) failures++;
};
const json = async (r: Response) => ({
  status: r.status,
  headers: r.headers,
  body: (await r.json()) as any,
});
const post = (path: string, account: Keypair) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: account.publicKey.toBase58() }),
  }).then(json);

const rules = await json(await fetch(`${BASE}/actions.json`));
check(
  rules.body.rules?.some((r: any) => r.pathPattern === "/j/*"),
  "actions.json maps job pages to actions",
);

const freelancer = Keypair.generate();
const hired = await json(
  await fetch(`${BASE}/api/demo/hire`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: freelancer.publicKey.toBase58() }),
  }),
);
const job = hired.body.job as string;
const get = await json(await fetch(`${BASE}/api/actions/job/${job}`));
const labels = (get.body.links?.actions ?? []).map((a: any) => a.label);
check(
  get.status === 200 &&
    get.body.type === "action" &&
    get.headers.get("access-control-allow-origin") === "*" &&
    !!get.headers.get("x-blockchain-ids"),
  "GET returns an action with CORS and chain headers",
);
check(
  labels.some((l: string) => /Accept job/.test(l)) &&
    labels.some((l: string) => /Fund a milestone/.test(l)),
  "an unaccepted job offers Accept and Fund",
  labels.join(" | "),
);

const accept = await post(`/api/actions/job/${job}/accept`, freelancer);
check(
  accept.status === 200 && !!accept.body.transaction,
  "POST accept returns a transaction",
);
const tx = Transaction.from(Buffer.from(accept.body.transaction, "base64"));
check(
  !tx.feePayer!.equals(freelancer.publicKey) &&
    tx.signatures.some((s) => s.publicKey.equals(tx.feePayer!) && s.signature),
  "fee payer is the app and has already signed",
);
tx.partialSign(freelancer);
const sig = await connection.sendRawTransaction(tx.serialize());
await connection.confirmTransaction(sig, "confirmed");
const after = await json(await fetch(`${BASE}/api/job/${job}`));
check(
  after.body.job?.accepted === true,
  "the wallet-signed Blink transaction accepted the job",
);

const stranger = Keypair.generate();
const early = await post(`/api/actions/job/${job}/release/0`, stranger);
check(
  early.status >= 400 &&
    /not in the right state|review window/i.test(early.body.message),
  "release before the review deadline is refused with a clear message",
  early.body.message,
);
const fund = await post(
  `/api/actions/job/${job}/fund?title=Extra&amount=5`,
  stranger,
);
check(
  fund.status === 403 && /Only the client/.test(fund.body.message),
  "only the client can fund through the Blink",
  fund.body.message,
);
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
