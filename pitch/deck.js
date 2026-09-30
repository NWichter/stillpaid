(function () {
  var q = new URLSearchParams(location.search);
  var slides = [].slice.call(document.querySelectorAll(".slide"));
  var one = parseInt(q.get("slide") || "", 10);
  if (one) {
    document.body.classList.add("single");
    if (slides[one - 1]) slides[one - 1].classList.add("on");
    return;
  }
  if (q.has("print") || q.has("all")) return;

  var body = document.body;
  var cur = -1;
  var timers = [];
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hud = document.querySelector(".hud i");
  body.classList.add("present");

  function fit() {
    body.style.setProperty(
      "--k",
      Math.min(innerWidth / 1920, innerHeight / 1080),
    );
  }
  fit();
  addEventListener("resize", fit);

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function countUp(el) {
    var to = +el.dataset.count;
    var dur = +el.dataset.dur || 1000;
    if (reduced) return;
    el.textContent = "0";
    later(function () {
      var t0 = performance.now();
      (function step(t) {
        var p = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) timers.push(requestAnimationFrame(step));
      })(t0);
    }, 300);
  }

  function clock(el) {
    var total = +el.dataset.clock;
    var t0 = performance.now();
    var pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    (function tick() {
      var left = Math.max(
        0,
        total - Math.floor(((performance.now() - t0) / 6000) * total),
      );
      el.textContent = pad(Math.floor(left / 60)) + ":" + pad(left % 60);
      if (left > 0) later(tick, 60);
    })();
  }

  function show(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === cur) return;
    timers.forEach(clearTimeout);
    timers = [];
    if (slides[cur]) {
      slides[cur].classList.remove("on");
      slides[cur].querySelectorAll("video").forEach(function (v) {
        v.pause();
      });
    }
    cur = i;
    var s = slides[cur];
    s.classList.add("on");
    s.querySelectorAll("[data-count]").forEach(countUp);
    s.querySelectorAll("[data-clock]").forEach(clock);
    hud.style.width = ((cur + 1) / slides.length) * 100 + "%";
    history.replaceState(null, "", "#" + (cur + 1));
  }

  addEventListener("keydown", function (e) {
    // In the video, space and Enter play/pause; the arrows still change slides.
    if (e.target.tagName === "VIDEO") {
      if (!["ArrowRight", "ArrowLeft", "PageDown", "PageUp"].includes(e.key))
        return;
      e.target.pause();
      e.target.blur();
    }
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) {
      e.preventDefault();
      show(cur + 1);
    }
    if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) {
      e.preventDefault();
      show(cur - 1);
    }
    if (e.key === "Home") show(0);
    if (e.key === "End") show(slides.length - 1);
  });
  addEventListener("click", function (e) {
    if (e.target.closest("video, a, button")) return;
    show(e.clientX < innerWidth / 3 ? cur - 1 : cur + 1);
  });
  var x0 = null;
  addEventListener(
    "touchstart",
    function (e) {
      x0 = e.touches[0].clientX;
    },
    { passive: true },
  );
  addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(dx < 0 ? cur + 1 : cur - 1);
    x0 = null;
  });

  show((parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
