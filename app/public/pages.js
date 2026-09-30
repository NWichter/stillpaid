(function () {
  var $ = SP.$,
    esc = SP.esc,
    sym = SP.cfg.symbol;
  var page = document.body.dataset.page;
  var LABEL = {
    funded: "In escrow",
    submitted: "In review",
    disputed: "Disputed",
    released: "Paid",
    settled: "Split agreed",
    resolved: "Decided",
    refunded: "Refunded",
  };

  if (page === "home") {
    fetch("/api/stats")
      .then(function (r) {
        return r.json();
      })
      .then(function (s) {
        // Only once the first full count is done, not while it is still running.
        if (!s.jobs || !s.updatedAt) return;
        var net = s.cluster === "mainnet-beta" ? "" : " on " + s.cluster;
        $("stats").innerHTML =
          "So far" +
          esc(net) +
          ": <b>" +
          s.jobs +
          "</b> jobs · <b>" +
          s.wallets +
          "</b> wallets · <b>" +
          esc(s.funded) +
          " " +
          esc(sym) +
          "</b> in escrow · <b>" +
          s.silentYes +
          "</b> milestones paid on silence";
        $("stats").hidden = false;
      })
      .catch(function () {});
    SP.onWallet(async function (pk) {
      var box = $("my-jobs");
      box.hidden = false;
      var r = await fetch("/api/jobs?wallet=" + pk, { cache: "no-store" });
      var d = await r.json();
      if (!r.ok) {
        $("jobs-list").innerHTML =
          '<p class="muted">' + esc(d.message) + "</p>";
        return;
      }
      $("jobs-balance").textContent =
        "Wallet balance: " + d.balance + " " + sym;
      $("jobs-list").innerHTML = d.jobs.length
        ? d.jobs
            .map(function (j) {
              var role =
                j.client === pk
                  ? "client"
                  : j.freelancer === pk
                    ? "freelancer"
                    : "arbiter";
              return (
                '<a class="card jobrow" href="/j/' +
                j.address +
                '"><div><b>' +
                esc(j.title) +
                '</b><div class="muted">You are the ' +
                role +
                " · " +
                j.total +
                " " +
                sym +
                '</div></div><div class="chips">' +
                j.statuses
                  .map(function (s) {
                    return '<span class="chip s-' + s + '">' + LABEL[s] + "</span>";
                  })
                  .join("") +
                "</div></a>"
              );
            })
            .join("")
        : '<p class="muted">No jobs for this wallet yet. <a href="/demo">Try the demo</a> or <a href="/new">create a job</a>.</p>';
    });
  }

  if (page === "new") {
    var form = $("new-job");
    var list = $("milestones");
    var tpl = list.querySelector(".ms").outerHTML;
    var q = new URLSearchParams(location.search);
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    var local = function (d) {
      return (
        d.getFullYear() +
        "-" +
        p(d.getMonth() + 1) +
        "-" +
        p(d.getDate()) +
        "T" +
        p(d.getHours()) +
        ":" +
        p(d.getMinutes())
      );
    };
    var setDeadlines = function (ms) {
      list.querySelectorAll('[name="m-deadline"]').forEach(function (el) {
        if (!el.value) el.value = local(new Date(Date.now() + ms));
      });
    };

    if (q.get("demo") === "1" && SP.cfg.demo) {
      form.job_title.value = "Landing page for a bakery (demo)";
      form.freelancer.value = SP.cfg.demo;
      form.review.value = "120";
      form.fallback.value = "5000";
      form.fix.value = "120";
      form.negotiate.value = "120";
      form.arbiter_window.value = "120";
      form.revisions.value = "1";
      form.terms.value =
        "Scope: a one-page website for a bakery (hero, opening hours, contact).\nDelivery: preview link.\nReview: 2 minutes. If the client says nothing within the review window, the delivery counts as accepted.\nChange requests: 1. If a dispute is not settled in time, it is split 50/50.";
      list.querySelector('[name="m-title"]').value = "Landing page";
      list.querySelector('[name="m-amount"]').value = "20";
      $("demo-note").hidden = false;
      setDeadlines(3600 * 1000);
    } else setDeadlines(7 * 86400 * 1000);

    $("add-ms").addEventListener("click", function () {
      if (list.querySelectorAll(".ms").length >= 3) {
        SP.toast(
          "Start with up to 3 milestones; fund more later on the job page.",
          "error",
        );
        return;
      }
      list.insertAdjacentHTML("beforeend", tpl);
      var last = list.lastElementChild;
      last.querySelectorAll("input").forEach(function (el) {
        el.value = "";
      });
      setDeadlines(14 * 86400 * 1000);
    });

    var btn = $("create-btn");
    function total() {
      var sum = 0;
      list.querySelectorAll('[name="m-amount"]').forEach(function (el) {
        var v = parseFloat(el.value.replace(",", "."));
        if (v > 0) sum += v;
      });
      btn.textContent = sum > 0
        ? "Create job and put " + (+sum.toFixed(SP.cfg.decimals)) + " " + sym + " in escrow"
        : "Create job and put the money in escrow";
    }
    list.addEventListener("input", total);
    total();
    SP.onWallet(async function (pk) {
      var r = await fetch("/api/balance?wallet=" + pk, { cache: "no-store" });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok) $("balance-line").textContent = "Your wallet holds " + d.balance + " " + sym + ".";
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var milestones = [].map.call(
        list.querySelectorAll(".ms"),
        function (row) {
          return {
            title: row.querySelector('[name="m-title"]').value,
            amount: row.querySelector('[name="m-amount"]').value,
            deadline: Math.floor(
              new Date(
                row.querySelector('[name="m-deadline"]').value,
              ).getTime() / 1000,
            ),
          };
        },
      );
      var body = {
        title: form.job_title.value,
        freelancer: form.freelancer.value.trim(),
        arbiter: form.arbiter.value.trim() || null,
        terms: form.terms.value,
        maxRevisions: Number(form.revisions.value),
        fallbackBps: Number(form.fallback.value),
        windows: {
          review: Number(form.review.value),
          fix: Number(form.fix.value),
          negotiate: Number(form.negotiate.value),
          arbiter: Number(form.arbiter_window.value),
        },
        milestones: milestones,
      };
      var r = await SP.run("create", body, btn);
      if (r && r.job) location.href = "/j/" + r.job;
    });
  }

  if (page === "demo") {
    // A first-time visitor without a wallet gets the throwaway one on the first click.
    function demoWallet() {
      return SP.wallet() || (SP.hasWallet() ? SP.connect() : SP.useBurner());
    }
    async function faucet(btn) {
      var pk = await demoWallet();
      btn.disabled = true;
      try {
        var r = await SP.post("/api/faucet", { account: pk });
        SP.toast("Sent " + r.amount + " to your wallet.");
      } finally {
        btn.disabled = false;
      }
    }
    $("demo-freelancer").addEventListener("click", async function (e) {
      var btn = e.currentTarget,
        label = btn.textContent;
      try {
        var pk = await demoWallet();
        btn.disabled = true;
        btn.textContent = "Demo client is funding a job…";
        var r = await SP.post("/api/demo/hire", { account: pk });
        location.href = "/j/" + r.job;
      } catch (x) {
        SP.toast(x.message, "error");
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    $("demo-client").addEventListener("click", async function (e) {
      try {
        await faucet(e.currentTarget);
        location.href = "/new?demo=1";
      } catch (x) {
        if (/already got test tokens/.test(x.message))
          location.href = "/new?demo=1";
        else SP.toast(x.message, "error");
      }
    });
  }
})();
