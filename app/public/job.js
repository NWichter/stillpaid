(function () {
  var $ = SP.$,
    esc = SP.esc,
    sym = SP.cfg.symbol;
  var data = JSON.parse($("data").textContent);
  var offset = data.now - Date.now() / 1000;
  var lastKey = "";
  var pending = false;
  var loading = false;
  // After an action: the key the page had before it, until fresh data arrives.
  var awaiting = null;
  var misses = 0;
  var hashChecks = {};
  var LABEL = {
    funded: "In escrow",
    submitted: "In review",
    disputed: "Disputed",
    released: "Paid",
    settled: "Split agreed",
    resolved: "Decided",
    refunded: "Refunded",
  };
  var EVENT = {
    MilestoneFunded: "Funded",
    Submitted: "Delivery submitted",
    RevisionRequested: "Change requested",
    DisputeOpened: "Dispute opened",
    SplitProposed: "Split offered",
    Paid: "Paid out",
  };

  function now() {
    return Date.now() / 1000 + offset;
  }
  function amt(base) {
    return SP.fmtUnits(base) + " " + sym;
  }
  function pct(bps) {
    return +(bps / 100).toFixed(2) + " %";
  }
  function key(d) {
    var c = Object.assign({}, d);
    delete c.now;
    return JSON.stringify(c);
  }
  function isDemo(job) {
    return (
      !!SP.cfg.demo &&
      (job.client === SP.cfg.demo || job.freelancer === SP.cfg.demo)
    );
  }

  async function load() {
    if (loading) return;
    loading = true;
    var w = SP.wallet();
    try {
      var r = await fetch(
        "/api/job/" + data.job.address + (w ? "?wallet=" + w : ""),
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(String(r.status));
      var d = await r.json();
      misses = 0;
      $("offline").hidden = !d.stale;
      $("offline").textContent = d.stale
        ? "Solana is slow to answer right now. Showing the last known state."
        : "Reconnecting…";
      offset = d.now - Date.now() / 1000;
      data = d;
      if (awaiting && (key(d) !== awaiting.key || Date.now() > awaiting.until))
        doneWaiting();
      if (key(d) !== lastKey) render();
    } catch (e) {
      if (++misses >= 2) $("offline").hidden = false;
    } finally {
      loading = false;
    }
  }

  function waitForChange(i) {
    awaiting = { key: lastKey, i: i, until: Date.now() + 45000 };
    var u = $("updating");
    if (u) u.hidden = false;
    document.querySelectorAll("#job [data-act]").forEach(function (b) {
      b.disabled = true;
    });
  }
  function doneWaiting() {
    ["t-submit-", "t-revision-", "t-dispute-"].forEach(function (p) {
      var el = $(p + awaiting.i);
      if (el) el.value = "";
    });
    awaiting = null;
    var u = $("updating");
    if (u) u.hidden = true;
    lastKey = "";
  }

  function linkify(text) {
    return esc(text).replace(/\bhttps?:\/\/[^\s<]+/g, function (u) {
      return (
        '<a href="' +
        u +
        '" target="_blank" rel="noopener nofollow">' +
        u +
        "</a>"
      );
    });
  }
  function fingerprint(hash) {
    if (!hash) return "";
    var text = data.texts[hash];
    var id = "fp-" + hash.slice(0, 16);
    if (text != null && hashChecks[hash] === undefined) {
      hashChecks[hash] = null;
      SP.sha256(text).then(function (h) {
        hashChecks[hash] = h === hash;
        var el = $(id);
        if (el) {
          el.className = "fp " + (h === hash ? "ok" : "bad");
          el.textContent =
            h === hash
              ? "Unchanged since it was recorded on Solana"
              : "Does not match the record on Solana";
        }
      });
    }
    var ok = hashChecks[hash];
    var cls = ok === true ? " ok" : ok === false ? " bad" : "";
    var txt =
      text == null
        ? "Recorded on Solana"
        : ok === false
          ? "Does not match the record on Solana"
          : ok
            ? "Unchanged since it was recorded on Solana"
            : "Checking against the record on Solana…";
    return (
      '<div class="fp' +
      cls +
      '" id="' +
      id +
      '" title="SHA-256 on-chain: ' +
      hash +
      '">' +
      txt +
      "</div>"
    );
  }
  function doc(title, hash) {
    if (!hash) return "";
    var text = data.texts[hash];
    return (
      '<div class="doc"><h3>' +
      esc(title) +
      "</h3>" +
      (text != null
        ? '<pre class="text">' + linkify(text) + "</pre>"
        : '<p class="muted">The text is not stored on this server; its fingerprint is on-chain.</p>') +
      fingerprint(hash) +
      "</div>"
    );
  }

  function outcome(m) {
    var paid = (data.history[m.index] || [])
      .filter(function (h) {
        return h.event === "Paid";
      })
      .pop();
    var how = paid ? paid.outcome : null;
    var toF = amt(m.paidFreelancer),
      toC = amt(m.paidClient);
    if (m.status === "refunded")
      return ["Refunded", toC + " went back to the client."];
    if (m.status === "settled")
      return [
        "Split agreed",
        toF + " to the freelancer, " + toC + " back to the client.",
      ];
    if (m.status === "resolved")
      return how === "timeout"
        ? [
            "Default split",
            "Nobody decided in time: " +
              toF +
              " to the freelancer, " +
              toC +
              " to the client.",
          ]
        : [
            "Decided by the arbiter",
            toF + " to the freelancer, " + toC + " back to the client.",
          ];
    if (m.status === "released")
      return how === "silence"
        ? [
            "Silent Yes: paid",
            "The client did not answer within the review window, so " +
              toF +
              " went to the freelancer. The Solana program released it after the deadline, without the client's signature.",
            paid && paid.signature,
          ]
        : [
            "Signed off",
            "The client approved: " + toF + " went to the freelancer.",
          ];
    return null;
  }

  function until(ts, label) {
    return (
      '<div class="clock" data-until="' +
      ts +
      '">' +
      SP.clock(ts - now()) +
      '</div><div class="muted">' +
      esc(label) +
      " " +
      SP.fmtTime(ts) +
      "</div>"
    );
  }
  function progress(from, to) {
    var p = Math.min(100, Math.max(0, ((now() - from) / (to - from)) * 100));
    return (
      '<div class="progress" data-from="' +
      from +
      '" data-to="' +
      to +
      '"><i style="width:' +
      p.toFixed(1) +
      '%"></i></div>'
    );
  }

  function next(m, job, role) {
    var t = now();
    var fin = outcome(m);
    if (fin) {
      var extra = "";
      if (role && data.balance != null)
        extra +=
          '<p class="muted">Your wallet now holds ' +
          esc(data.balance) +
          " " +
          sym +
          ".</p>";
      return (
        '<span class="stamp">' +
        esc(fin[0]) +
        "</span><p>" +
        esc(fin[1]) +
        (fin[2]
          ? ' <a target="_blank" rel="noopener" href="' +
            SP.explorer("tx", fin[2]) +
            '">See the payout on Solana Explorer</a>'
          : "") +
        "</p>" +
        extra
      );
    }
    var you = function (who, mine, theirs) {
      return role === who ? mine : theirs;
    };
    if (m.status === "funded") {
      if (!job.accepted)
        return (
          "<strong>" +
          you(
            "freelancer",
            "The money is in escrow. Accept the job above to start.",
            amt(m.amount) +
              " are in escrow. Waiting for the freelancer to accept.",
          ) +
          "</strong>" +
          '<p class="muted">Until the freelancer accepts, the client can take the money back.' +
          (isDemo(job) && role === "client"
            ? " The demo freelancer usually accepts within 20 seconds."
            : "") +
          "</p>"
        );
      if (t > m.deliveryDeadline)
        return (
          '<strong>The delivery deadline has passed.</strong><p class="muted">' +
          you(
            "client",
            "You can take the " + amt(m.amount) + " back.",
            "The client can now take the " + amt(m.amount) + " back.",
          ) +
          "</p>"
        );
      if (m.revisions > 0)
        return (
          "<strong>" +
          you(
            "freelancer",
            "Your turn: submit the changed version, or dispute the change request.",
            "Change requested. Waiting for the freelancer to submit again.",
          ) +
          "</strong>" +
          until(m.deliveryDeadline, "changes due")
        );
      return (
        "<strong>" +
        you(
          "freelancer",
          "Your turn: submit your delivery below.",
          amt(m.amount) + " are in escrow. Waiting for the delivery.",
        ) +
        "</strong>" +
        until(m.deliveryDeadline, "delivery due")
      );
    }
    if (m.status === "submitted") {
      if (t <= m.reviewDeadline)
        return (
          "<strong>" +
          (role === "client"
            ? "Your review. Approve, request a change or dispute. If you do nothing, " +
              amt(m.amount) +
              " go to the freelancer in"
            : role === "freelancer"
              ? "Delivered. If the client stays silent, you get " +
                amt(m.amount) +
                " in"
              : "Delivered. If the client says nothing, " +
                amt(m.amount) +
                " go to the freelancer in") +
          "</strong>" +
          until(m.reviewDeadline, "Silent Yes at") +
          progress(m.reviewDeadline - job.windows.review, m.reviewDeadline) +
          '<p class="muted">Nobody needs to press anything. When this hits zero, the program lets anyone release the money.</p>'
        );
      return '<strong>The review window is over. Silence counts as approval.</strong><p class="muted">Stillpaid releases it within about 30 seconds. Anyone can press Release now, or <a target="_blank" rel="noopener" href="' + blink() + '">from a Blink</a>.</p>';
    }
    if (m.status === "disputed") {
      var offer = m.proposalBy
        ? "<p>Standing offer from " +
          (m.proposalBy === role ? "you" : "the " + m.proposalBy) +
          ": <b>" +
          pct(m.proposalBps) +
          "</b> to the freelancer, " +
          pct(10000 - m.proposalBps) +
          " back to the client.</p>"
        : "";
      if (t <= m.negotiateDeadline)
        return (
          "<strong>Disputed. " +
          (role === "client" || role === "freelancer"
            ? "Offer a split, or accept the other side's offer."
            : "Both sides can agree on a split until") +
          "</strong>" +
          offer +
          until(m.negotiateDeadline, "time to agree ends") +
          '<p class="muted">Without an agreement in time, ' +
          (job.arbiter
            ? "the arbiter decides; without a decision, "
            : "") +
          "the default split applies: " +
          pct(job.fallbackBps) +
          " to the freelancer.</p>"
        );
      if (job.arbiter && t <= m.arbiterDeadline)
        return (
          "<strong>" +
          you(
            "arbiter",
            "Your decision. Without one, the default split (" +
              pct(job.fallbackBps) +
              " to the freelancer) applies in",
            "The arbiter decides. Without a decision, the default split (" +
              pct(job.fallbackBps) +
              " to the freelancer) applies in",
          ) +
          "</strong>" +
          offer +
          until(m.arbiterDeadline, "arbiter deadline")
        );
      return (
        "<strong>Nobody decided in time. The default split is due: " +
        pct(job.fallbackBps) +
        " to the freelancer.</strong>" +
        offer
      );
    }
    return "";
  }

  function facts(m, job) {
    return (
      '<dl class="facts">' +
      "<div><dt>Amount</dt><dd>" +
      amt(m.amount) +
      "</dd></div>" +
      "<div><dt>Delivery due</dt><dd>" +
      SP.fmtTime(m.deliveryDeadline) +
      "</dd></div>" +
      "<div><dt>Change requests used</dt><dd>" +
      m.revisions +
      " of " +
      job.maxRevisions +
      "</dd></div>" +
      '<div><dt>Held in</dt><dd><a class="mono" target="_blank" rel="noopener" href="' +
      SP.explorer("address", m.address) +
      '">' +
      SP.short(m.address) +
      "</a></dd></div>" +
      "</dl>"
    );
  }

  function history(m) {
    var h = data.history[m.index] || [];
    if (!h.length) return "";
    return (
      '<details class="activity"><summary>On-chain activity (' +
      h.length +
      ")</summary><ol>" +
      h
        .map(function (e) {
          var what = EVENT[e.event] || e.event;
          if (e.event === "Paid")
            what = "Paid out" + (e.outcome ? " (" + e.outcome + ")" : "");
          return (
            "<li><span>" +
            esc(what) +
            '</span> <a class="mono" target="_blank" rel="noopener" href="' +
            SP.explorer("tx", e.signature) +
            '">' +
            (e.time ? SP.fmtTime(e.time) : SP.short(e.signature)) +
            "</a></li>"
          );
        })
        .join("") +
      "</ol></details>"
    );
  }

  function slider(id, label) {
    return (
      '<div class="split"><input type="range" min="0" max="100" step="5" value="50" id="' +
      id +
      '" aria-label="' +
      esc(label) +
      '">' +
      '<output for="' +
      id +
      '" id="' +
      id +
      '-out"></output></div>'
    );
  }
  function area(id, title, placeholder, value) {
    return (
      '<h3 id="' +
      id +
      '-h">' +
      title +
      '</h3><textarea id="' +
      id +
      '" aria-labelledby="' +
      id +
      '-h" placeholder="' +
      esc(placeholder) +
      '">' +
      esc(value || "") +
      "</textarea>"
    );
  }
  function button(cls, act, i, text, extra) {
    return (
      '<div class="row"><button class="btn ' +
      cls +
      '" data-act="' +
      act +
      '" data-i="' +
      i +
      '"' +
      (extra || "") +
      ">" +
      text +
      "</button></div>"
    );
  }

  function actions(m, job) {
    var a = (data.actions && data.actions[m.index]) || [];
    if (m.status === "submitted" && now() > m.reviewDeadline)
      a = a.filter(function (x) {
        return x === "release";
      });
    if (!a.length) return "";
    var i = m.index,
      h = [];
    if (a.includes("submit")) {
      var demoText =
        job.client === SP.cfg.demo
          ? 'Tagline: "Fresh from the oven, every morning."\nPreview: https://example.com/bakery'
          : "";
      h.push(
        area(
          "t-submit-" + i,
          "Submit your delivery",
          "Link to the work (preview URL, repo commit, file) and a short note",
          demoText,
        ) + button("", "submit", i, "Submit delivery"),
      );
    }
    if (a.includes("approve"))
      h.push(
        button("good", "approve", i, "Approve and release " + amt(m.amount)),
      );
    if (a.includes("revision"))
      h.push(
        area(
          "t-revision-" + i,
          "Or request a change (" +
            (job.maxRevisions - m.revisions) +
            " of " +
            job.maxRevisions +
            " left)",
          "What exactly needs to change?",
        ) + button("ghost", "revision", i, "Request a change"),
      );
    if (a.includes("dispute"))
      h.push(
        area(
          "t-dispute-" + i,
          m.status === "funded"
            ? "Disagree with the change request?"
            : "Or open a dispute",
          "Why? This is recorded and can't be edited later.",
        ) + button("bad", "dispute", i, "Open dispute"),
      );
    if (a.includes("acceptSplit"))
      h.push(
        button(
          "good",
          "acceptSplit",
          i,
          "Accept: " + pct(m.proposalBps) + " to the freelancer",
          ' data-bps="' + m.proposalBps + '"',
        ),
      );
    if (a.includes("propose"))
      h.push(
        "<h3>" +
          (m.proposalBy ? "Or make a counter-offer" : "Offer a split") +
          "</h3>" +
          slider("r-propose-" + i, "Split") +
          button("ghost", "propose", i, "Offer this split"),
      );
    if (a.includes("resolve"))
      h.push(
        "<h3>Your decision as arbiter</h3>" +
          slider("r-resolve-" + i, "Decision") +
          button("", "resolve", i, "Decide and pay out"),
      );
    if (a.includes("release"))
      h.push(button("good", "release", i, "Release now"));
    if (a.includes("fallback"))
      h.push(button("", "fallback", i, "Apply the default split now"));
    if (a.includes("refund"))
      h.push(
        "<h3>" +
          (job.accepted ? "Delivery is late" : "Cancel before work starts") +
          "</h3>" +
          button("bad", "refund", i, "Take " + amt(m.amount) + " back"),
      );
    if (m.status === "submitted" && data.role === "client")
      h.push(
        '<p class="muted"><a href="/api/ics/' +
          m.address +
          '">Add the review deadline to your calendar</a></p>',
      );
    return '<div class="act">' + h.join("") + "</div>";
  }

  function milestone(m, job, role) {
    var fin = ["released", "settled", "resolved", "refunded"].includes(
      m.status,
    );
    var reasonTitle = m.disputedBy
      ? "Dispute reason (" + m.disputedBy + ")"
      : "Change request";
    return (
      '<article class="card milestone" id="m' +
      m.index +
      '" data-status="' +
      m.status +
      '" data-final="' +
      (fin ? 1 : 0) +
      '">' +
      '<div class="mhead"><div><span class="kicker">Milestone ' +
      (m.index + 1) +
      "</span><h2>" +
      esc(m.title) +
      "</h2></div>" +
      '<div><span class="chip s-' +
      m.status +
      '">' +
      LABEL[m.status] +
      '</span> <span class="amount">' +
      amt(m.amount) +
      "</span></div></div>" +
      '<div class="next">' +
      next(m, job, role) +
      "</div>" +
      '<div class="body">' +
      facts(m, job) +
      doc(
        m.submissions > 1
          ? "Delivery (version " + m.submissions + ")"
          : "Delivery",
        m.deliverableHash,
      ) +
      (m.reasonHash ? doc(reasonTitle, m.reasonHash) : "") +
      actions(m, job) +
      history(m) +
      "</div></article>"
    );
  }

  function party(label, addr, you) {
    return (
      '<div class="card party"><div><div class="who">' +
      label +
      "</div>" +
      (addr
        ? '<a target="_blank" rel="noopener" href="' +
          SP.explorer("address", addr) +
          '">' +
          SP.short(addr) +
          "</a>" +
          (addr === SP.cfg.demo ? ' <span class="muted">(demo)</span>' : "")
        : '<span class="muted">none: an open dispute ends in the default split (' +
          pct(data.job.fallbackBps) +
          " to the freelancer)</span>") +
      "</div>" +
      (you ? '<span class="chip you">you</span>' : "") +
      "</div>"
    );
  }

  function banner(job, role) {
    if (!SP.wallet())
      return '<div class="card banner"><p>Connect your wallet to act on this job.</p><div class="row"><button class="btn" id="connect-inline">Connect wallet</button> <button class="btn ghost" data-burner hidden>Use a throwaway demo wallet</button></div></div>';
    if (!role)
      return '<div class="card banner"><p>You are viewing this job. Only the client, the freelancer and the arbiter can act on it.</p></div>';
    if (!job.accepted && role === "freelancer")
      return '<div class="card banner"><p><b>You are the freelancer on this job.</b> The money is already in escrow. Read the terms, then accept: from then on the client only gets it back if you miss a deadline or a dispute says so.</p><button class="btn good" data-act="accept">Accept job and terms</button></div>';
    return (
      '<div class="card banner slim"><p>You are the <b>' +
      role +
      "</b> on this job.</p></div>"
    );
  }

  // Solana Actions: the same job as a link that wallets and X unfurl into buttons.
  function blink() {
    var action =
      "solana-action:" + location.origin + "/api/actions/job/" + data.job.address;
    return (
      "https://dial.to/?action=" +
      encodeURIComponent(action) +
      (SP.cfg.cluster === "mainnet-beta" ? "" : "&cluster=devnet")
    );
  }

  function dur(s) {
    if (s % 86400 === 0) return s / 86400 + (s === 86400 ? " day" : " days");
    if (s % 3600 === 0) return s / 3600 + " h";
    if (s % 60 === 0) return s / 60 + " min";
    return s + " s";
  }

  function addForm() {
    var d = new Date(Date.now() + 7 * 86400000);
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    var local =
      d.getFullYear() +
      "-" +
      p(d.getMonth() + 1) +
      "-" +
      p(d.getDate()) +
      "T" +
      p(d.getHours()) +
      ":" +
      p(d.getMinutes());
    return (
      '<details class="card terms"><summary>Fund another milestone</summary><div class="ms" style="margin-top:12px">' +
      '<label class="f">Title<input id="add-title" maxlength="64"></label><label class="f">Amount (' +
      sym +
      ')<input id="add-amount" inputmode="decimal"></label>' +
      '<label class="f">Delivery due<input id="add-deadline" type="datetime-local" value="' +
      local +
      '"></label></div><p><button class="btn" data-act="addMilestone">Fund milestone</button></p></details>'
    );
  }

  function render() {
    var active = document.activeElement;
    if (
      active &&
      active.closest &&
      active.closest("#job") &&
      /^(TEXTAREA|INPUT)$/.test(active.tagName) &&
      active.value
    )
      return;
    var job = data.job,
      role = data.role;
    var saved = {};
    document
      .querySelectorAll("#job textarea, #job input")
      .forEach(function (el) {
        if (el.id) saved[el.id] = el.value;
      });
    var h =
      '<section class="page-head"><span class="kicker">Job · ' +
      (job.accepted
        ? "accepted by the freelancer"
        : "waiting for the freelancer") +
      "</span><h1>" +
      esc(job.title) +
      "</h1>" +
      "<p>Review window " +
      dur(job.windows.review) +
      " · " +
      (job.maxRevisions === 1
        ? "1 change request"
        : "up to " + job.maxRevisions + " change requests") +
      " · at least " +
      dur(job.windows.fix) +
      " to deliver changes · " +
      dur(job.windows.negotiate) +
      " to agree on a split" +
      (job.arbiter ? " · arbiter " + dur(job.windows.arbiter) : "") +
      "</p></section>";
    var terms =
      '<details class="card terms"' +
      (job.accepted ? "" : " open") +
      "><summary>Terms both sides agree to</summary>" +
      (data.texts[job.termsHash] != null
        ? '<pre class="text">' + linkify(data.texts[job.termsHash]) + "</pre>"
        : "") +
      fingerprint(job.termsHash) +
      "</details>";
    h += banner(job, role);
    if (!job.accepted) h += terms;
    h += data.milestones
      .map(function (m) {
        return milestone(m, job, role);
      })
      .join("");
    if (role === "client" && data.milestones.length < 20) h += addForm();
    h +=
      '<div class="parties">' +
      party("Client", job.client, role === "client") +
      party("Freelancer", job.freelancer, role === "freelancer") +
      party("Arbiter", job.arbiter, role === "arbiter") +
      "</div>";
    if (job.accepted) h += terms;
    h +=
      '<p class="muted share">Anyone can act on this job from a wallet or X: <a target="_blank" rel="noopener" href="' +
      blink() +
      '">share it as a Solana Blink</a>.</p>';
    if (
      isDemo(job) &&
      data.milestones.every(function (m) {
        return outcome(m);
      })
    )
      h +=
        '<p class="row"><a class="btn ghost" href="/demo">Now try the other side →</a></p>';
    $("job").innerHTML = h;
    Object.keys(saved).forEach(function (id) {
      var el = $(id);
      if (el && saved[id]) el.value = saved[id];
    });
    document.querySelectorAll('#job input[type="range"]').forEach(updateSlider);
    document.querySelectorAll("#job [data-burner]").forEach(function (el) {
      el.hidden = SP.cfg.cluster === "mainnet-beta";
      el.onclick = function () {
        SP.useBurner().catch(function (e) {
          SP.toast(e.message, "error");
        });
      };
    });
    lastKey = key(data);
    if (awaiting)
      document.querySelectorAll("#job [data-act]").forEach(function (b) {
        b.disabled = true;
      });
  }

  function updateSlider(el) {
    var out = $(el.id + "-out");
    if (out)
      out.textContent =
        el.value +
        " % to the freelancer, " +
        (100 - el.value) +
        " % back to the client";
  }
  document.addEventListener("input", function (e) {
    if (e.target.type === "range") updateSlider(e.target);
  });

  document.addEventListener("click", async function (e) {
    if (e.target.id === "connect-inline") {
      SP.connect().catch(function (x) {
        SP.toast(x.message, "error");
      });
      return;
    }
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.dataset.act,
      i = Number(btn.dataset.i),
      body = { job: data.job.address, index: i };
    if (act === "submit" || act === "revision" || act === "dispute") {
      body.text = ($("t-" + act + "-" + i).value || "").trim();
      if (!body.text) {
        SP.toast(
          "Write a short note first. It is recorded on Solana and can't be changed later.",
          "error",
        );
        return;
      }
    }
    if (act === "propose" || act === "resolve")
      body.bps = Number($("r-" + act + "-" + i).value) * 100;
    if (act === "acceptSplit") body.bps = Number(btn.dataset.bps);
    if (act === "addMilestone")
      body = {
        job: data.job.address,
        title: $("add-title").value,
        amount: $("add-amount").value,
        deadline: Math.floor(
          new Date($("add-deadline").value).getTime() / 1000,
        ),
      };
    pending = true;
    var r = await SP.run(act, body, btn);
    pending = false;
    if (r) {
      if (document.activeElement) document.activeElement.blur();
      waitForChange(i);
      await load();
    }
  });

  setInterval(function () {
    var t = now();
    document.querySelectorAll("[data-until]").forEach(function (el) {
      var left = Number(el.dataset.until) - t;
      el.textContent = SP.clock(left);
      if (left <= 0 && !el.dataset.fired) {
        el.dataset.fired = "1";
        render();
        setTimeout(load, 1500);
      }
    });
    document.querySelectorAll(".progress[data-to]").forEach(function (el) {
      var from = Number(el.dataset.from),
        to = Number(el.dataset.to);
      el.firstChild.style.width =
        Math.min(100, Math.max(0, ((t - from) / (to - from)) * 100)).toFixed(
          1,
        ) + "%";
    });
  }, 1000);
  setInterval(function () {
    if (!pending) load();
  }, 4000);
  setInterval(function () {
    if (awaiting && !pending) load();
  }, 1500);
  SP.onWallet(function () {
    load();
  });
  render();
})();
