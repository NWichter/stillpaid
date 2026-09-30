import type { HistoryEntry, JobView, MilestoneView, Role } from "./chain.js";

export interface ViewContext {
  cluster: "localnet" | "devnet" | "mainnet-beta";
  rpcUrl: string;
  programId: string;
  mint: string;
  symbol: string;
  decimals: number;
  sponsored: boolean;
  demo: string | null;
}

export interface JobData {
  job: JobView;
  milestones: MilestoneView[];
  now: number;
  texts: Record<string, string>;
  role: Role | null;
  actions: Record<number, string[]>;
  history: Record<number, HistoryEntry[]>;
  balance: string | null;
}

export const h = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const TAGLINE = "Silence still pays.";
const V = Date.now().toString(36);

export const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16171b"/><circle cx="8.4" cy="14.4" r="2.4" fill="#f5f2ea" fill-opacity=".55"/><circle cx="12.4" cy="18.4" r="2.4" fill="#9fd9b4" fill-opacity=".9"/><path d="M16.4 22.4L24.8 10.4" fill="none" stroke="#4fcf86" stroke-width="4.8" stroke-linecap="round"/></svg>`;

function explorer(ctx: ViewContext, address: string) {
  const q =
    ctx.cluster === "mainnet-beta"
      ? ""
      : ctx.cluster === "devnet"
        ? "?cluster=devnet"
        : `?cluster=custom&customUrl=${encodeURIComponent(ctx.rpcUrl)}`;
  return `https://explorer.solana.com/address/${address}${q}`;
}

function layout(
  ctx: ViewContext,
  o: {
    title: string;
    page: string;
    body: string;
    scripts?: string[];
    data?: unknown;
    description?: string;
  },
) {
  const cfg = {
    cluster: ctx.cluster,
    rpcUrl: ctx.rpcUrl,
    symbol: ctx.symbol,
    decimals: ctx.decimals,
    demo: ctx.demo,
  };
  const net = ctx.cluster === "mainnet-beta" ? "mainnet" : ctx.cluster;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${h(o.title)}</title>
<meta name="description" content="${h(o.description ?? `${TAGLINE} Milestone escrow on Solana: the client funds first, silence after the review window counts as approval (Silent Yes).`)}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css?v=${V}">
<script type="application/json" id="cfg">${json(cfg)}</script>
${o.data === undefined ? "" : `<script type="application/json" id="data">${json(o.data)}</script>`}
<script src="/vendor/web3.iife.min.js" defer></script>
<script src="/static/stillpaid.js?v=${V}" defer></script>
${(o.scripts ?? []).map((s) => `<script src="/static/${s}?v=${V}" defer></script>`).join("\n")}
</head>
<body data-page="${h(o.page)}">
<div class="wrap">
<header class="top">
  <a class="logo" href="/" aria-label="Stillpaid home">${iconSvg}<span>Stillpaid</span></a>
  <nav class="links">
    <span class="net">${h(net)}</span>
    ${ctx.demo ? `<a class="plain" href="/demo">Demo</a>` : ""}
    <a class="plain" href="/new">New job</a>
    <button class="btn sm ghost" id="wallet-btn" type="button">Connect wallet</button>
  </nav>
</header>
${o.body}
<footer class="foot">
  <span>Stillpaid · the money sits in a Solana program, not with us.${ctx.sponsored ? " Network fees are paid by Stillpaid." : ""}</span>
  <span>program <a class="mono" target="_blank" rel="noopener" href="${h(explorer(ctx, ctx.programId))}">${short(ctx.programId)}</a> · token <a class="mono" target="_blank" rel="noopener" href="${h(explorer(ctx, ctx.mint))}">${h(ctx.symbol)}</a></span>
</footer>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
</body>
</html>`;
}

export function landingPage(ctx: ViewContext) {
  return layout(ctx, {
    title: `Stillpaid · ${TAGLINE}`,
    page: "home",
    scripts: ["pages.js"],
    body: `
<section class="hero">
  <div class="hero-text">
  <span class="kicker">Silence still pays · optimistic payments for client work on Solana</span>
  <h1>Get paid on sign-off.<br><em>Or on silence.</em></h1>
  <p class="lead">The client puts each milestone into escrow before you start. You deliver. The client has a fixed window to approve, request a change or dispute. Clients keep that full window. They just can't ghost: if they say nothing, you get paid.</p>
  <p class="origin"><i>still</i> (German): quiet. <i>still</i> (English): even so. If your client stays still, you still get paid.</p>
  <div class="cta">
    ${ctx.demo ? `<a class="btn" href="/demo">Try it in 5 minutes</a>` : ""}
    <a class="btn ghost" href="/new">Create a job</a>
  </div>
  </div>
  <p class="stats" id="stats" hidden></p>
  <aside class="card hero-card" aria-label="Example: a milestone paid on silence">
    <div class="row-between"><span class="kicker">Milestone 1 · Landing page</span><span class="chip s-submitted">In review</span></div>
    <div class="big-clock">00:07</div>
    <div class="muted">until Silent Yes · 20 USDC in escrow</div>
    <div class="progress"><i style="width:94%"></i></div>
    <span class="stamp">Silent Yes: paid</span>
    <p class="muted">The client stayed silent. The Solana program released the money after the deadline, without the client's signature.</p>
  </aside>
</section>

<div class="flow">
  <div class="card step"><span class="kicker">1 · Fund</span><b>Money first</b><p>The client funds the milestone in USDC. It sits in its own escrow account that only the program's rules can open.</p></div>
  <div class="card step"><span class="kicker">2 · Deliver</span><b>Submit</b><p>The freelancer submits a link and a note. Their fingerprint goes on-chain, so any later edit shows.</p></div>
  <div class="card step silence"><span class="kicker">3 · Review</span><b>Silent Yes</b><p>The client approves, sends one of the agreed change requests, or disputes. If the review window ends in silence, the money goes to the freelancer. No one can block it.</p></div>
  <div class="card step"><span class="kicker">4 · Disagree?</span><b>Split, arbiter, default</b><p>Both sides can agree on a split. If not, a named arbiter decides. If nobody decides in time, the split both agreed up front applies. Money never stays locked.</p></div>
</div>

<section class="block">
  <h2>Why this needs Solana</h2>
  <div class="why">
    <div class="card"><h3>Nobody holds the money</h3><p>Not the client, not the freelancer, not us. Each milestone sits in a program-owned account and only moves by the rules both sides accepted.</p></div>
    <div class="card"><h3>Deadlines enforce themselves</h3><p>After the review window anyone can trigger the release: the freelancer needs neither the client nor our server.</p></div>
    <div class="card"><h3>Paid anywhere in seconds</h3><p>USDC settles worldwide for a fraction of a cent. No SWIFT, no marketplace taking 10&nbsp;to&nbsp;20&nbsp;%. ${ctx.sponsored ? "Stillpaid even pays the network fee." : ""}</p></div>
  </div>
</section>

<section class="block" id="my-jobs" hidden>
  <h2>Your jobs</h2>
  <p class="muted" id="jobs-balance"></p>
  <div class="jobs" id="jobs-list"><p class="muted">Loading…</p></div>
</section>`,
  });
}

const windowOptions = (ctx: ViewContext, selected: number) =>
  [
    ...(ctx.cluster === "mainnet-beta"
      ? []
      : [
          [90, "90 seconds (demo)"],
          [120, "2 minutes (demo)"],
        ]),
    [3600, "1 hour"],
    [86400, "1 day"],
    [3 * 86400, "3 days"],
    [7 * 86400, "7 days"],
    [14 * 86400, "14 days"],
    [30 * 86400, "30 days"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}"${v === selected ? " selected" : ""}>${l}</option>`,
    )
    .join("");

const fallbackOptions = [
  [10000, "100 % (the delivery stands)"],
  [8000, "80 %"],
  [6000, "60 %"],
  [5000, "50 % (neither side wins by stalling)"],
  [0, "0 % (all back to the client)"],
]
  .map(
    ([v, l]) =>
      `<option value="${v}"${v === 5000 ? " selected" : ""}>${l}</option>`,
  )
  .join("");

export function newPage(ctx: ViewContext) {
  return layout(ctx, {
    title: "New job · Stillpaid",
    page: "new",
    scripts: ["pages.js"],
    body: `
<section class="page-head">
  <span class="kicker">New job · you are the client</span>
  <h1>Put the work in escrow</h1>
  <p>You fund the milestones now. The freelancer sees the money is there before starting.</p>
</section>
<div class="card banner" id="demo-note" hidden><p><b>Demo:</b> the freelancer is Stillpaid's demo freelancer. It usually accepts and delivers within 20 seconds. Then approve, request a change, dispute, or simply wait for the review window to run out.</p></div>
<form class="card new" id="new-job" autocomplete="off">
  <label class="f">Job title <input name="job_title" required maxlength="64" placeholder="Website relaunch for Acme Inc."></label>
  <label class="f">Freelancer's wallet <small>Solana address of the person doing the work</small><input name="freelancer" required class="mono" placeholder="Solana address"></label>
  <fieldset>
    <legend>Milestones</legend>
    <div id="milestones">
      <div class="ms">
        <label class="f">Milestone<input name="m-title" required maxlength="64" placeholder="e.g. Design"></label>
        <label class="f">Amount (${h(ctx.symbol)})<input name="m-amount" required inputmode="decimal" placeholder="0.00"></label>
        <label class="f">Delivery due<input name="m-deadline" required type="datetime-local"></label>
      </div>
    </div>
    <p class="hint">Start with up to three milestones; fund more later on the job page.</p>
    <div><button class="btn sm ghost" type="button" id="add-ms">+ Milestone</button></div>
  </fieldset>
  <label class="f">Terms <small>Scope, what counts as done, how to deliver. A fingerprint of this text is recorded on Solana, so neither side can change it later.</small><textarea name="terms" required maxlength="4000"></textarea></label>
  <div class="two">
    <label class="f">Review window <small>Silence after it counts as approval</small><select name="review">${windowOptions(ctx, 7 * 86400)}</select></label>
    <label class="f">Change requests <small>How often you may send it back</small><select name="revisions">${[0, 1, 2, 3, 5].map((n) => `<option${n === 2 ? " selected" : ""}>${n}</option>`).join("")}</select></label>
  </div>
  <details class="more" id="disagree">
    <summary>If you disagree: deadlines, arbiter, default split</summary>
    <div class="two">
      <label class="f">Time per revision <small>For the freelancer to deliver changes</small><select name="fix">${windowOptions(ctx, 7 * 86400)}</select></label>
      <label class="f">Time to agree <small>For a split once a dispute is open</small><select name="negotiate">${windowOptions(ctx, 7 * 86400)}</select></label>
    </div>
    <label class="f">Arbiter (optional) <small>A person both of you trust. They decide only if you cannot agree.</small><input name="arbiter" class="mono" placeholder="Solana address"></label>
    <label class="f">Arbiter's time <select name="arbiter_window">${windowOptions(ctx, 14 * 86400)}</select></label>
    <label class="f">Default split <small>If a dispute is still open when all deadlines have passed, the freelancer gets:</small><select name="fallback">${fallbackOptions}</select></label>
  </details>
  <p class="muted" id="balance-line"></p>
  <button class="btn" id="create-btn" type="submit">Create job and put the money in escrow</button>
</form>`,
  });
}

export function demoPage(ctx: ViewContext) {
  return layout(ctx, {
    title: "Demo · Stillpaid",
    page: "demo",
    scripts: ["pages.js"],
    body: `
<section class="page-head">
  <span class="kicker">Demo on ${h(ctx.cluster)} · test tokens only</span>
  <h1>Try both sides in about five minutes</h1>
  <p><b>No wallet needed:</b> the buttons below create a throwaway test wallet in this browser${ctx.sponsored ? ", and Stillpaid pays every network fee" : ""}. Have Phantom or Solflare on devnet? Connect it first instead. It may warn that it can't preview the transaction; that's expected on a test network, and your test ${h(ctx.symbol)} shows on the job page, not in the wallet.</p>
</section>
${
  ctx.demo
    ? `<div class="demo-grid">
  <div class="card">
    <span class="kicker">Side A</span>
    <h2>Be the freelancer</h2>
    <ol>
      <li>A demo client hires you and puts 25 test ${h(ctx.symbol)} into escrow.</li>
      <li>You accept the job and submit your delivery.</li>
      <li>The demo client never answers. Watch the 90-second review window run out and the money arrive in your wallet.</li>
    </ol>
    <button class="btn" id="demo-freelancer" type="button">Get hired</button>
  </div>
  <div class="card">
    <span class="kicker">Side B</span>
    <h2>Be the client</h2>
    <ol>
      <li>Get 100 test ${h(ctx.symbol)} and create a job for the demo freelancer.</li>
      <li>It usually accepts and delivers within 20 seconds.</li>
      <li>Approve it, request a change, open a dispute and accept its split offer, or stay silent and watch it pay out.</li>
    </ol>
    <button class="btn" id="demo-client" type="button">Get test tokens and hire</button>
  </div>
</div>`
    : `<div class="card banner"><p>The demo is not available on this network.</p></div>`
}`,
  });
}

export function jobPage(ctx: ViewContext, data: JobData) {
  return layout(ctx, {
    title: `${data.job.title} · Stillpaid`,
    page: "job",
    scripts: ["job.js"],
    data,
    body: `<p class="offline" id="offline" hidden>Reconnecting…</p><p class="offline updating" id="updating" hidden>Confirmed on Solana. Updating the page…</p><div id="job"><section class="page-head"><h1>${h(data.job.title)}</h1><p class="muted">Loading…</p></section></div>`,
  });
}

export function errorPage(ctx: ViewContext, status: number, message: string) {
  return layout(ctx, {
    title: `${status} · Stillpaid`,
    page: "error",
    body: `<section class="page-head"><span class="kicker">Error ${status}</span><h1>${h(message)}</h1><p><a href="/">Back to the start</a></p></section>`,
  });
}
