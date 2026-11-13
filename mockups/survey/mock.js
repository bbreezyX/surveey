/* Shared plumbing for the three progress-summary mockups: counts from the
   data.js snapshot, the pin badges, region thumbnails, the map backdrop and
   the switcher strip. Mockup-only. The real page would read the same two
   feeds it already loads (points + esdm.cloud progress) and reuse
   shared/survey/progress.ts, whose badge drawing is copied here verbatim. */
(function () {
  "use strict";

  var M = window.SURVEY_MOCK;
  var STAGES = ["Galian", "Cor", "Tiang", "Lampu"];
  var PIE = ["", "M7 7V3.4A3.6 3.6 0 0 1 10.6 7Z", "M7 7V3.4A3.6 3.6 0 0 1 7 10.6Z", "M7 7V3.4A3.6 3.6 0 1 1 3.4 7Z"];

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  // progress.ts stageBadgeSvg, plus a hollow ring for "belum dimulai".
  function badge(stage, cls) {
    var c = ' class="badge' + (cls ? " " + cls : "") + '" aria-hidden="true"';
    if (stage >= 4) return '<svg' + c + ' viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#1f8f4e" stroke="#fff" stroke-width="1.6"/><path d="M4.3 7.2 6.2 9 9.8 5.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (stage <= 0) return '<svg' + c + ' viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.4" fill="#fff" stroke="#8a99a9" stroke-width="1.4"/></svg>';
    var dash = stage === 3 ? ' stroke-dasharray="2.2 1.5"' : "";
    return '<svg' + c + ' viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#fff" stroke="#0072bc" stroke-width="1.6"' + dash + '/><path d="' + PIE[Math.min(3, stage)] + '" fill="#0072bc"/></svg>';
  }

  var CLOCK = '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function stageSummary(stage) {
    return stage >= 4 ? "Terpasang" : stage >= 1 ? STAGES[stage - 1] + " Selesai" : "Belum Dimulai";
  }

  // Short labels for counts: "81 galian selesai", as a sentence would say it.
  var STAGE_ROW = ["Belum dimulai", "Galian selesai", "Cor selesai", "Tiang selesai", "Terpasang"];

  function official(units) { return units.filter(function (u) { return u.f !== "cadangan"; }); }

  // Counts per accepted stage (0 = not started) and open reports, official units only.
  function tally(units) {
    var t = { total: 0, s: [0, 0, 0, 0, 0], pending: [] };
    official(units).forEach(function (u) { t.total++; t.s[u.s]++; if (u.p.length) t.pending.push(u); });
    t.reached = [1, 2, 3, 4].map(function (stage) { return t.s.slice(stage).reduce(function (a, b) { return a + b; }, 0); });
    t.pct = t.total ? Math.round((t.s[4] / t.total) * 100) : 0;
    return t;
  }

  function unitsOf(region) { return M.units.filter(function (u) { return u.k === region; }); }
  function regionShape(name) { return M.regions.find(function (r) { return r.name === name; }); }

  function dist(t, thin) {
    return '<div class="dist' + (thin ? " dist--thin" : "") + '" aria-hidden="true">' + [4, 3, 2, 1, 0].map(function (s) {
      return t.s[s] ? '<i class="s' + s + '" style="flex:' + t.s[s] + '"></i>' : "";
    }).join("") + "</div>";
  }

  // Region silhouette with its units as dots, coloured by stage: the atlas
  // cell's thumbnail (Shape.svelte) in progress colours.
  function thumb(name, opts) {
    opts = opts || {};
    var r = regionShape(name), pad = Math.max(r.box[2], r.box[3]) * 0.04;
    var box = [r.box[0] - pad, r.box[1] - pad, r.box[2] + pad * 2, r.box[3] + pad * 2];
    var rad = Math.max(box[2], box[3]) / (opts.dot || 40);
    var dots = official(unitsOf(name)).map(function (u) {
      return '<circle class="prog-dot s' + u.s + '" cx="' + u.x + '" cy="' + u.y + '" r="' + rad.toFixed(1) + '"/>';
    }).join("");
    return '<svg viewBox="' + box.join(" ") + '" preserveAspectRatio="' + (opts.align || "xMinYMid") + ' meet" aria-hidden="true" focusable="false"><path class="atlas-shape" fill-rule="evenodd" d="' + r.d + '"/>' + dots + "</svg>";
  }

  // Where one kabupaten sits in the province (Locator.svelte).
  function locator(active) {
    var b = bounds();
    return '<svg viewBox="' + [b[0], b[1], b[2] - b[0], b[3] - b[1]].join(" ") + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + M.regions.slice().sort(function (a, b) { return (a.name === active) - (b.name === active); }).map(function (r) {
      return '<path class="loc-region' + (r.name === active ? " is-active" : "") + '" d="' + r.d + '"/>';
    }).join("") + "</svg>";
  }

  function bounds() {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    M.regions.forEach(function (r) { b[0] = Math.min(b[0], r.box[0]); b[1] = Math.min(b[1], r.box[1]); b[2] = Math.max(b[2], r.box[0] + r.box[2]); b[3] = Math.max(b[3], r.box[1] + r.box[3]); });
    return b;
  }

  // The backdrop: the province fitted into the map area right of the panel,
  // as the live map frames it, with every pin and its stage badge.
  function map(svg, focus) {
    var b = bounds(), bw = b[2] - b[0], bh = b[3] - b[1];
    var symbols = [1, 2, 3, 4].map(function (s) { return badge(s).replace("<svg", '<symbol id="b' + s + '"').replace(' class="badge" aria-hidden="true"', "").replace("</svg>", "</symbol>"); }).join("");
    var regions = M.regions.map(function (r) { return '<path class="map__region' + (r.name === focus ? " is-focus" : "") + '" d="' + r.d + '"/>'; }).join("");
    var labels = M.regions.map(function (r) { return '<text class="map__label" x="' + (r.box[0] + r.box[2] / 2).toFixed(0) + '" y="' + (r.box[1] + r.box[3] / 2).toFixed(0) + '">' + (r.name.indexOf("Kota") === 0 ? r.name : "Kab. " + r.name) + "</text>"; }).join("");
    var pins = M.units.map(function (u) {
      var pin = '<circle class="map__pin' + (u.f === "duplikat" || u.f === "belum" ? " map__pin--" + u.f : "") + '" cx="' + u.x + '" cy="' + u.y + '" r="11"/>';
      return pin + (u.s && u.f !== "cadangan" ? '<use href="#b' + u.s + '" x="' + (u.x + 2) + '" y="' + (u.y - 22) + '" width="20" height="20"/>' : "");
    }).join("");
    svg.innerHTML = "<defs>" + symbols + "</defs><g>" + regions + "</g><g>" + pins + "</g><g>" + labels + "</g>";
    function fit() {
      var vw = svg.clientWidth, vh = svg.clientHeight, left = innerWidth >= 960 ? 432 : 0;
      var w = vw - left, h = innerWidth >= 960 ? vh - 60 : vh;
      var scale = Math.min(w / bw, h / bh) * 0.94;
      var x = b[0] - (left + (w - bw * scale) / 2) / scale, y = b[1] - (h - bh * scale) / 2 / scale;
      svg.setAttribute("viewBox", [x, y, vw / scale, vh / scale].map(function (n) { return n.toFixed(1); }).join(" "));
    }
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    fit();
    // Redrawn when the focus region changes; keep one resize listener per map.
    if (svg._fit) removeEventListener("resize", svg._fit);
    svg._fit = fit;
    addEventListener("resize", fit);
  }

  var toastEl, toastTimer;
  function toast(message) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = message;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  // Lapor buttons point at esdm.cloud/lapangan in the real page; here they only say so.
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-lapor]");
    if (!link) return;
    event.preventDefault();
    toast("Di halaman asli: buka esdm.cloud/lapangan untuk titik " + link.getAttribute("data-lapor"));
  });

  function switcher(current) {
    var pages = [["a-atlas.html", "A · Atlas Progres"], ["b-daftar-kerja.html", "B · Daftar Kerja"], ["c-papan.html", "C · Papan Progres"], ["d-gabungan.html", "D · Gabungan A+B"]];
    var bar = document.createElement("nav");
    bar.className = "mock-bar";
    bar.setAttribute("aria-label", "Pilih mockup");
    bar.innerHTML = '<span class="mock-bar__label">Mockup</span>' + pages.map(function (p) {
      return '<a href="' + p[0] + '"' + (p[0] === current ? ' aria-current="page"' : "") + ">" + p[1] + "</a>";
    }).join("") + '<span class="mock-bar__note">Data contoh: snapshot ' + esc(M.taken) + "</span>";
    document.body.prepend(bar);
  }

  // Panel screen change, with the app's direction-aware slide.
  function enter(sidebar, dir) {
    sidebar.removeAttribute("data-enter");
    void sidebar.offsetWidth;
    sidebar.setAttribute("data-enter", dir);
    setTimeout(function () { sidebar.removeAttribute("data-enter"); }, 300);
  }

  window.Mock = {
    data: M, STAGES: STAGES, STAGE_ROW: STAGE_ROW, CLOCK: CLOCK,
    esc: esc, badge: badge, stageSummary: stageSummary, official: official, tally: tally,
    unitsOf: unitsOf, dist: dist, thumb: thumb, locator: locator, map: map, toast: toast,
    switcher: switcher, enter: enter,
  };
})();
