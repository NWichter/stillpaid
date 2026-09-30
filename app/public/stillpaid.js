window.SP = (function () {
  var cfg = JSON.parse(document.getElementById("cfg").textContent);
  var wallet = null;
  var listeners = [];
  var BURNER_KEY = "stillpaid-demo-wallet";
  var USE_BURNER = "stillpaid-use-demo-wallet";

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }
  function short(s) {
    return s ? s.slice(0, 4) + "…" + s.slice(-4) : "";
  }
  function toast(msg, kind, link) {
    var t = $("toast");
    t.textContent = msg;
    if (link) {
      var a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = " View on Solana Explorer";
      t.appendChild(a);
    }
    t.setAttribute("role", kind === "error" ? "alert" : "status");
    t.className = "toast show" + (kind === "error" ? " error" : "");
    clearTimeout(t._h);
    t._h = setTimeout(
      function () {
        t.className = "toast";
      },
      kind === "error" ? 8000 : 6000,
    );
  }

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {
      return null;
    }
  }
  var burnerCache = null;
  // Test networks only: a throwaway key in this browser. Fees are sponsored,
  // so it can sign everything a real wallet would.
  function burner() {
    if (burnerCache) return burnerCache;
    var raw = store(BURNER_KEY);
    var kp = raw
      ? solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))
      : solanaWeb3.Keypair.generate();
    if (!raw) store(BURNER_KEY, JSON.stringify(Array.from(kp.secretKey)));
    burnerCache = {
      isBurner: true,
      publicKey: kp.publicKey,
      connect: async function () {
        return { publicKey: kp.publicKey };
      },
      signTransaction: async function (tx) {
        tx.partialSign(kp);
        return tx;
      },
    };
    return burnerCache;
  }
  var canBurn = cfg.cluster !== "mainnet-beta";
  function injected() {
    return (
      (window.phantom && window.phantom.solana) ||
      window.solflare ||
      window.solana ||
      null
    );
  }
  function provider() {
    if (canBurn && store(USE_BURNER) === "1" && window.solanaWeb3)
      return burner();
    return injected();
  }
  function markBurners() {
    var on = provider() && provider().isBurner && wallet;
    document.querySelectorAll("[data-burner]").forEach(function (el) {
      if (!el.dataset.label) el.dataset.label = el.textContent;
      el.textContent = on ? "Demo wallet ready ✓" : el.dataset.label;
      el.disabled = !!on;
    });
  }
  function setWallet(pk) {
    wallet = pk;
    var b = $("wallet-btn");
    if (b)
      b.textContent = pk
        ? (provider() && provider().isBurner ? "Demo wallet " : "") + short(pk)
        : "Connect wallet";
    listeners.forEach(function (fn) {
      fn(pk);
    });
    markBurners();
  }
  async function connect() {
    var p = provider();
    if (!p)
      throw new Error(
        canBurn
          ? "No Solana wallet in this browser. Install Phantom, or use a throwaway demo wallet (button on the demo page)."
          : "No Solana wallet in this browser. Install Phantom or Solflare.",
      );
    var r = await p.connect();
    var pk = ((r && r.publicKey) || p.publicKey).toString();
    setWallet(pk);
    return pk;
  }
  async function useBurner() {
    store(USE_BURNER, "1");
    return connect();
  }
  function onWallet(fn) {
    listeners.push(fn);
    if (wallet) fn(wallet);
  }

  function b64ToBytes(s) {
    var bin = atob(s),
      out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  async function post(url, body) {
    var r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var j = await r.json().catch(function () {
      return {};
    });
    if (!r.ok)
      throw new Error(j.message || "Request failed (" + r.status + ")");
    return j;
  }

  // Signed transactions go through our own RPC, so a wallet set to another
  // network cannot send them to the wrong cluster.
  var busy = false;
  async function run(action, body, btn) {
    if (busy) return null;
    busy = true;
    $("toast").className = "toast";
    var label = btn ? btn.innerHTML : "";
    document.querySelectorAll("[data-act]").forEach(function (b) {
      b.disabled = true;
    });
    if (btn) btn.textContent = "Waiting for wallet…";
    try {
      var pk = wallet || (await connect());
      var j = await post(
        "/api/tx",
        Object.assign({ action: action, account: pk }, body),
      );
      var tx = solanaWeb3.Transaction.from(b64ToBytes(j.transaction));
      var p = provider();
      if (btn && !p.isBurner) btn.textContent = "Sign in your wallet…";
      if (!p.signTransaction)
        throw new Error(
          "This wallet can only sign and send in one step. Use Phantom, Solflare or the demo wallet.",
        );
      var signed = await p.signTransaction(tx);
      if (btn) btn.textContent = "Confirming on Solana…";
      var sig = (
        await post("/api/send", {
          transaction: bytesToB64(
            signed.serialize({
              requireAllSignatures: false,
              verifySignatures: false,
            }),
          ),
        })
      ).signature;
      toast(j.done || "Done.", "ok", explorer("tx", sig));
      return { signature: sig, job: j.job };
    } catch (e) {
      toast((e && e.message) || String(e), "error");
      return null;
    } finally {
      busy = false;
      document.querySelectorAll("[data-act]").forEach(function (b) {
        b.disabled = false;
      });
      if (btn) btn.innerHTML = label;
    }
  }

  function explorer(kind, id) {
    var q =
      cfg.cluster === "mainnet-beta"
        ? ""
        : cfg.cluster === "devnet"
          ? "?cluster=devnet"
          : "?cluster=custom&customUrl=" + encodeURIComponent(cfg.rpcUrl);
    return "https://explorer.solana.com/" + kind + "/" + id + q;
  }
  function fmtTime(ts) {
    return new Date(ts * 1000).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var d = Math.floor(sec / 86400),
      h = Math.floor((sec % 86400) / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      (d ? d + "d " : "") + (d || h ? pad(h) + ":" : "") + pad(m) + ":" + pad(s)
    );
  }
  function fmtUnits(base) {
    var v = BigInt(base),
      b = 10n ** BigInt(cfg.decimals);
    var frac = (v % b)
      .toString()
      .padStart(cfg.decimals, "0")
      .replace(/0+$/, "");
    if (frac.length === 1) frac += "0";
    return (v / b).toString() + (frac ? "." + frac : "");
  }
  async function sha256(text) {
    var d = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(d))
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var b = $("wallet-btn");
    if (b)
      b.addEventListener("click", function () {
        connect().catch(function (e) {
          toast(e.message, "error");
        });
      });
    document.querySelectorAll("[data-burner]").forEach(function (el) {
      el.hidden = !canBurn;
      el.addEventListener("click", function () {
        useBurner()
          .then(function () {
            toast(
              "Using a throwaway demo wallet in this browser. Fees are covered.",
            );
          })
          .catch(function (e) {
            toast(e.message, "error");
          });
      });
    });
    var p = provider();
    if (p && p.isBurner)
      p.connect().then(function (r) {
        setWallet(r.publicKey.toString());
      });
    else if (p && p.connect)
      p.connect({ onlyIfTrusted: true })
        .then(function (r) {
          var pk = (r && r.publicKey) || p.publicKey;
          if (pk) setWallet(pk.toString());
        })
        .catch(function () {});
  });

  return {
    cfg: cfg,
    $: $,
    esc: esc,
    short: short,
    toast: toast,
    connect: connect,
    useBurner: useBurner,
    hasWallet: function () {
      return !!provider();
    },
    onWallet: onWallet,
    wallet: function () {
      return wallet;
    },
    run: run,
    post: post,
    explorer: explorer,
    fmtTime: fmtTime,
    clock: clock,
    fmtUnits: fmtUnits,
    sha256: sha256,
  };
})();
