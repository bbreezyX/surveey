/* Mockup K: the province Progres view with the live markup and stylesheets, and four ways for its total to
   say how many units are terpasang and what share of the whole that is:
     Sekarang                 "182 Titik Terpasang / dari 500 titik PUTS · 36%" (live, b1df8f0)
     A · Persen di depan      the share large, "Terpasang / 182 dari 500 titik PUTS" beside it
     B · Angka + persen       "182/500" and "36%" equally large on one row, the stage bar joined under them
     C · Kartu capaian        a tinted card: the share large, one meter of terpasang against 500, both ends named
   The amount switch tries each at a low and a near-full share; the chip switch shows or hides "hari ini".
   Units come from the data.js snapshot; the low/high amounts and "hari ini" are sample data. Kabupaten cells
   are the live C2 design (adff524) and always use the snapshot. */
(function () {
  "use strict";
  var K = window.Mock, M = K.data, esc = K.esc;
  var view = { total: "b", amount: "snap", chip: true };
  var TOTALS = [["now", "Sekarang"], ["a", "A · Persen di depan"], ["b", "B · Angka + persen"], ["c", "C · Kartu capaian"]];
  var AMOUNTS = [["snap", "Snapshot"], ["low", "Awal (2%)"], ["high", "Hampir (97%)"]];

  var WORK_DONE = 3;
  var workStep = function (stage) { return Math.min(stage, WORK_DONE); };
  var workBadge = function (step) { return K.badge(step === WORK_DONE ? 4 : step); };
  var STAGE_COUNT_LABEL = ["Belum dimulai", "Galian selesai", "Cor selesai", "Terpasang"];
  var NEXT = ["Perlu galian", "Perlu cor", "Perlu tiang"];
  var ARROW = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 10V2.5M2.6 5.6 6 2.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLOCK = '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="#fff" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var COLLAPSE = '<svg class="panel-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/></svg>';
  var SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
  var LOCATE = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>';

  function tally(units) {
    var t = { total: 0, stages: [0, 0, 0, 0], waiting: 0 };
    K.official(units).forEach(function (u) { t.total++; t.stages[workStep(u.s)]++; if (u.p.length) t.waiting++; });
    return t;
  }
  var share = function (t) { return t.total ? Math.round((t.stages[WORK_DONE] / t.total) * 100) : 0; };
  // The province tally the total and legend draw; the two sample amounts keep the 500 and move the stages.
  function province() {
    var t = tally(M.units);
    if (view.amount === "low") t.stages = [450, 30, 10, 10];
    if (view.amount === "high") t.stages = [0, 3, 12, 485];
    return t;
  }

  // ---- Sample "hari ini", as in mockups E, H and J ----
  function hash(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var today = K.official(M.units).filter(function (u) { return u.s >= 1; }).sort(function (a, b) { return hash(a.k + a.c + a.desa) - hash(b.k + b.c + b.desa); }).slice(0, 7);
  var todayIn = {}, todaySteps = [0, 0, 0, 0];
  today.forEach(function (u) { todayIn[u.k] = (todayIn[u.k] || 0) + 1; todaySteps[workStep(u.s)]++; });
  var chip = function () { return view.chip ? '<button class="today-chip tot-chip" type="button" data-toast="Di halaman asli: membuka daftar Progres hari ini">' + ARROW + today.length + " hari ini</button>" : ""; };

  // ---- Silhouette with its units as dots (Shape.svelte, kindOf by step) ----
  function shape(name) {
    var r = M.regions.find(function (x) { return x.name === name; }), pad = Math.max(r.box[2], r.box[3]) * 0.04;
    var box = [r.box[0] - pad, r.box[1] - pad, r.box[2] + pad * 2, r.box[3] + pad * 2], rad = Math.max(box[2], box[3]) / 40;
    var dots = K.official(K.unitsOf(name)).map(function (u) { var s = workStep(u.s); return { s: s, u: u }; }).sort(function (a, b) { return (a.s === WORK_DONE) - (b.s === WORK_DONE); }).map(function (d) {
      return '<circle class="atlas-dot atlas-dot--p' + (d.s === WORK_DONE ? 2 : d.s ? 1 : 0) + '" cx="' + d.u.x + '" cy="' + d.u.y + '" r="' + rad.toFixed(1) + '"/>';
    }).join("");
    return '<svg preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false" viewBox="' + box.join(" ") + '"><path fill-rule="evenodd" class="atlas-shape" d="' + r.d + '"/>' + dots + "</svg>";
  }

  // ---- Kabupaten cell: the live C2 rows ----
  function cell(name) {
    var units = K.unitsOf(name), t = tally(units), n = t.stages[WORK_DONE], done = t.total > 0 && n === t.total, moved = todayIn[name] || 0;
    var corner = done || moved ? '<span class="progress-cell__corner" aria-hidden="true">' + (moved ? '<span class="today-chip">' + ARROW + moved + " hari ini</span>" : "") + (done ? '<span class="progress-cell__check">' + workBadge(WORK_DONE) + "</span>" : "") + "</span>" : "";
    var due = [0, 0, 0], wait = 0;
    K.official(units).forEach(function (u) { var s = workStep(u.s); if (u.p.length) wait++; else if (s < WORK_DONE) due[s]++; });
    var mark = function (svg) { return '<span class="progress-next__badge">' + svg + "</span>"; };
    var rows = due.map(function (count, s) { return count ? "<li>" + mark(workBadge(s)) + "<span>" + NEXT[s] + "</span><b>" + count + "</b></li>" : ""; }).join("") +
      (wait ? '<li class="is-wait">' + mark(CLOCK) + "<span>Menunggu diperiksa</span><b>" + wait + "</b></li>" : "");
    var body = done ? '<span class="atlas-cell__meta is-done">Semua terpasang · ' + t.total + "</span>"
      : '<ul class="progress-next" aria-hidden="true"><li class="is-done' + (n ? "" : " is-zero") + '">' + mark(workBadge(WORK_DONE)) + "<span>Terpasang</span><b>" + n + "<small>/" + t.total + "</small></b></li>" + rows + "</ul>";
    return '<button type="button" class="atlas-cell progress-cell' + (done ? " is-done" : "") + '" data-region="' + esc(name) + '">' + corner +
      '<span class="atlas-cell__shape">' + shape(name) + '</span><span class="atlas-cell__name">' + esc(name) + "</span>" + body + "</button>";
  }

  // ---- The province total, four ways ----
  function stageBar(t) {
    return '<span class="stage-bar" aria-hidden="true">' + [3, 2, 1, 0].map(function (s) { return t.stages[s] ? '<i class="stage-bar__s' + s + '" style="flex-grow:' + t.stages[s] + '"></i>' : ""; }).join("") + "</span>";
  }
  function total(t) {
    var n = t.stages[WORK_DONE], pct = share(t), side = view.chip ? '<span class="progress-side">' + chip() + "</span>" : "";
    if (view.total === "a") {
      return '<div class="atlas-summary atlas-summary--total"><p class="atlas-total atlas-total--progress tot-a" role="status"><b class="atlas-total__num tot-fig">' + pct + '<small>%</small></b>' +
        '<span class="atlas-total__label"><span>Terpasang</span><span><b>' + n + "</b> dari <b>" + t.total + "</b> titik PUTS</span></span></p>" + side + "</div>";
    }
    if (view.total === "b") {
      return '<div class="atlas-summary atlas-summary--total tot-b"><div class="tot-b__top"><span class="tot-b__label">Titik Terpasang</span>' + chip() + "</div>" +
        '<p class="tot-b__row" role="status"><span class="tot-b__count"><b class="tot-fig">' + n + '</b><span><span class="visually-hidden"> dari </span>/' + t.total + '</span></span><b class="tot-b__pct tot-fig">' + pct + "<small>%</small></b></p>" + stageBar(t) + "</div>";
    }
    if (view.total === "c") {
      return '<div class="atlas-summary atlas-summary--total tot-c"><div class="tot-c__card"><div class="tot-c__head"><div><span class="tot-c__label">Titik Terpasang</span>' +
        '<p class="tot-c__fig" role="status"><b class="tot-fig">' + pct + '<small>%</small></b><span>dari total titik PUTS</span></p></div>' + chip() + "</div>" +
        '<progress class="tot-c__meter" max="' + t.total + '" value="' + n + '" aria-label="Titik terpasang"></progress>' +
        '<div class="tot-c__ends" aria-hidden="true"><span><b>' + n + "</b> terpasang</span><span>dari <b>" + t.total + "</b> titik</span></div></div></div>";
    }
    return '<div class="atlas-summary atlas-summary--total"><p class="atlas-total atlas-total--progress" role="status"><b class="atlas-total__num">' + n + '</b><span class="atlas-total__label"><span>Titik Terpasang</span><span>dari <b>' + t.total + "</b> titik PUTS · <b>" + pct + "%</b></span></span></p>" + side + "</div>";
  }

  function panel() {
    var all = province(), joined = view.total === "b";
    var legend = [3, 2, 1, 0].map(function (s) {
      return '<li><span class="stage-legend__badge" aria-hidden="true">' + workBadge(s) + "</span><span>" + STAGE_COUNT_LABEL[s] + "</span><b>" + all.stages[s] + "</b>" + (view.chip && todaySteps[s] ? '<em class="stage-legend__today">+' + todaySteps[s] + "</em>" : "") + "</li>";
    }).join("");
    return '<button id="sheet-handle" type="button" aria-label="Tutup daftar titik"><span class="sheet-handle__grabber" aria-hidden="true"></span><span class="sheet-handle__text" aria-hidden="true">Tutup Daftar Titik</span></button>' +
      '<div class="panel-top" id="panel-top"><div class="atlas-head"><img alt="Lambang Provinsi Jambi" width="38" height="39" src="../../src/public/assets/lambang-jambi-76.webp"><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar">' + COLLAPSE + "</button></div></div>" +
      '<div class="panel-search-row"><div class="panel-search"><span class="panel-search__icon">' + SEARCH + '</span><input id="list-search" type="search" aria-label="Cari titik PUTS" autocomplete="off" placeholder="Cari lokasi atau kabupaten…"></div><button type="button" aria-label="Titik di dekatku" class="locate-btn" aria-pressed="false">' + LOCATE + '<span class="locate-btn__label">Terdekat</span></button></div>' +
      '<div class="sheet-near"></div>' +
      '<div class="panel-meta" id="panel-meta"><div class="list-mode" role="group" aria-label="Tampilan daftar"><button type="button" aria-pressed="false">Sebaran</button><button type="button" aria-pressed="true">Progres</button></div>' + total(all) + "</div>" +
      '<div class="sidebar-scroll"><div id="list-data"><section class="progress-sum' + (joined ? " is-legend-only" : "") + '" aria-label="Ringkasan progres pembangunan">' + (joined ? "" : stageBar(all)) + '<ul class="stage-legend">' + legend + "</ul></section>" +
      '<div class="atlas-section progress-grid-head" role="heading" aria-level="2">Semua Wilayah<span>' + M.order.length + ' kabupaten/kota</span></div><div class="atlas-grid">' + M.order.map(cell).join("") + "</div></div></div>" +
      '<p class="sidebar-footer"><span class="sidebar-footer__title">Survey Lapangan &amp; Pelaksanaan</span><span class="sidebar-footer__meta">s.d. 6 Oktober 2026 · Dinas ESDM Jambi</span></p>';
  }

  // ---- Map backdrop ----
  function bounds() {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    M.regions.forEach(function (r) { b[0] = Math.min(b[0], r.box[0]); b[1] = Math.min(b[1], r.box[1]); b[2] = Math.max(b[2], r.box[0] + r.box[2]); b[3] = Math.max(b[3], r.box[1] + r.box[3]); });
    return b;
  }
  function map() {
    var svg = document.getElementById("map"), b = bounds(), bw = b[2] - b[0], bh = b[3] - b[1];
    svg.innerHTML = M.regions.map(function (r) { return '<path fill-rule="evenodd" d="' + r.d + '"/>'; }).join("");
    var fit = function () {
      var vw = svg.clientWidth, vh = svg.clientHeight, left = innerWidth >= 960 ? 432 : 0, w = vw - left, h = innerWidth >= 960 ? vh : vh * 0.4;
      var scale = Math.min(w / bw, h / bh) * 0.86;
      svg.setAttribute("viewBox", [b[0] - (left + (w - bw * scale) / 2) / scale, b[1] - (h - bh * scale) / 2 / scale, vw / scale, vh / scale].map(function (n) { return n.toFixed(1); }).join(" "));
    };
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    fit();
    addEventListener("resize", fit);
  }

  // ---- Mockup strip ----
  var nav = document.createElement("nav");
  nav.className = "mock-bar";
  nav.setAttribute("aria-label", "Pilih desain total");
  document.body.prepend(nav);
  function group(label, key, items) {
    return '<span class="mock-bar__label">' + label + "</span>" + items.map(function (item) { return '<button type="button" data-' + key + '="' + item[0] + '" aria-pressed="' + (String(view[key]) === item[0]) + '">' + item[1] + "</button>"; }).join("");
  }
  function strip() {
    nav.innerHTML = group("Total", "total", TOTALS) + '<span class="mock-bar__sep" aria-hidden="true"></span>' + group("Jumlah", "amount", AMOUNTS) +
      '<span class="mock-bar__sep" aria-hidden="true"></span>' + group("Hari ini", "chip", [["true", "Ada"], ["false", "Tidak"]]) +
      '<span class="mock-bar__note">Data contoh ' + esc(M.taken) + ' · "hari ini" disimulasikan</span>';
  }
  function render() {
    var scroll = document.querySelector(".sidebar-scroll"), top = scroll ? scroll.scrollTop : 0;
    document.getElementById("sidebar").innerHTML = panel();
    document.querySelector(".sidebar-scroll").scrollTop = top;
    strip();
  }

  document.addEventListener("click", function (event) {
    var el = event.target.closest && event.target.closest("button");
    if (!el) return;
    if (el.dataset.total) { view.total = el.dataset.total; render(); }
    else if (el.dataset.amount) { view.amount = el.dataset.amount; render(); }
    else if (el.dataset.chip) { view.chip = el.dataset.chip === "true"; render(); }
    else if (el.dataset.toast) K.toast(el.dataset.toast);
    else if (el.dataset.region) K.toast("Di halaman asli: membuka daftar kerja " + el.dataset.region);
  });

  map();
  render();
})();
