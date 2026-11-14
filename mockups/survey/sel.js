/* Mockup J: the province Progres view with the live markup and stylesheets, and four ways for a kabupaten
   cell to say how far it is:
     Sekarang               "68/72 terpasang" and a badge per stage still to go (live, f9db60e)
     A · Angka besar        the terpasang count large with "terpasang / dari 72 titik", as the province total
     B · Cincin             one ring split by stage, the share and "68/72 terpasang" beside it
     C · Langkah berikutnya "68/72 terpasang", then what is left named by the report it needs
   Finished kabupaten keep the check and "SEMUA TERPASANG" in every variant. Units come from the data.js
   snapshot; "hari ini" is sample data (seven units). */
(function () {
  "use strict";
  var K = window.Mock, M = K.data, esc = K.esc;
  var view = { cell: "c", head: "row" };
  var CELLS = [["now", "Sekarang"], ["a", "A · Angka besar"], ["b", "B · Cincin"], ["c", "C · Langkah berikutnya"]];
  // C's terpasang line, after the rows dropped "Lapor" for "Perlu": the live "x/y terpasang", the count large
  // as in A, a first row in the list's own form (C2, the one built), or the share as a figure.
  var HEADS = [["now", "x/y (sekarang)"], ["big", "C1 · Angka besar"], ["row", "C2 · Jadi baris"], ["pct", "C3 · Persen"]];

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

  // ---- Sample "hari ini", as in mockups E and H ----
  function hash(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var today = K.official(M.units).filter(function (u) { return u.s >= 1; }).sort(function (a, b) { return hash(a.k + a.c + a.desa) - hash(b.k + b.c + b.desa); }).slice(0, 7);
  var todayIn = {}, todaySteps = [0, 0, 0, 0];
  today.forEach(function (u) { todayIn[u.k] = (todayIn[u.k] || 0) + 1; todaySteps[workStep(u.s)]++; });

  // ---- Silhouette with its units as dots (Shape.svelte, kindOf by step) ----
  function shape(name) {
    var r = M.regions.find(function (x) { return x.name === name; }), pad = Math.max(r.box[2], r.box[3]) * 0.04;
    var box = [r.box[0] - pad, r.box[1] - pad, r.box[2] + pad * 2, r.box[3] + pad * 2], rad = Math.max(box[2], box[3]) / 40;
    var dots = K.official(K.unitsOf(name)).map(function (u) { var s = workStep(u.s); return { s: s, u: u }; }).sort(function (a, b) { return (a.s === WORK_DONE) - (b.s === WORK_DONE); }).map(function (d) {
      return '<circle class="atlas-dot atlas-dot--p' + (d.s === WORK_DONE ? 2 : d.s ? 1 : 0) + '" cx="' + d.u.x + '" cy="' + d.u.y + '" r="' + rad.toFixed(1) + '"/>';
    }).join("");
    return '<svg preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false" viewBox="' + box.join(" ") + '"><path fill-rule="evenodd" class="atlas-shape" d="' + r.d + '"/>' + dots + "</svg>";
  }

  // ---- The four cell bottoms ----
  function nowCell(t) {
    var left = [2, 1, 0].filter(function (s) { return t.stages[s]; });
    return '<span class="atlas-cell__meta"><b>' + t.stages[WORK_DONE] + "</b>/" + t.total + ' terpasang</span><span class="progress-cell__left" aria-hidden="true">' +
      (t.stages[0] === t.total ? '<span class="is-none">' + workBadge(0) + "Belum dimulai</span>" : left.map(function (s) { return '<span title="' + STAGE_COUNT_LABEL[s] + '">' + workBadge(s) + t.stages[s] + "</span>"; }).join("")) + "</span>";
  }
  function bigCell(t) {
    var n = t.stages[WORK_DONE];
    return '<span class="cell-big"><b class="' + (n ? "" : "is-zero") + '">' + n + "</b><span><span>terpasang</span><span>dari " + t.total + " titik</span></span></span>";
  }
  function ring(t) {
    var r = 15, c = 2 * Math.PI * r, at = 0;
    var arcs = [3, 2, 1, 0].filter(function (s) { return t.stages[s]; }).map(function (s) {
      var len = (c * t.stages[s]) / t.total, gap = t.stages[s] === t.total ? 0 : 1.2;
      var arc = '<circle class="ring-s' + s + '" cx="19" cy="19" r="' + r + '" fill="none" stroke-width="6" stroke-dasharray="' + Math.max(0, len - gap).toFixed(2) + " " + c.toFixed(2) + '" stroke-dashoffset="' + (-at).toFixed(2) + '" transform="rotate(-90 19 19)"/>';
      at += len;
      return arc;
    }).join("");
    return '<svg viewBox="0 0 38 38" aria-hidden="true">' + arcs + "</svg>";
  }
  function ringCell(t) {
    return '<span class="cell-ring">' + ring(t) + "<span><b>" + share(t) + "%</b><small>" + t.stages[WORK_DONE] + "/" + t.total + " terpasang</small></span></span>";
  }
  function nextCell(t, units) {
    var due = [0, 0, 0], wait = 0;
    K.official(units).forEach(function (u) { var s = workStep(u.s); if (u.p.length) wait++; else if (s < WORK_DONE) due[s]++; });
    var n = t.stages[WORK_DONE];
    var rows = due.map(function (count, s) { return count ? "<li>" + workBadge(s) + "<span>" + NEXT[s] + "</span><b>" + count + "</b></li>" : ""; }).join("") +
      (wait ? '<li class="is-wait">' + CLOCK + "<span>Menunggu diperiksa</span><b>" + wait + "</b></li>" : "");
    if (view.head === "row") return '<ul class="cell-next cell-next--rows" aria-hidden="true"><li class="is-done' + (n ? "" : " is-zero") + '">' + workBadge(WORK_DONE) + "<span>Terpasang</span><b>" + n + "<small>/" + t.total + "</small></b></li>" + rows + "</ul>";
    var head = view.head === "big" ? bigCell(t)
      : view.head === "pct" ? '<span class="cell-pct"><b class="' + (n ? "" : "is-zero") + '">' + share(t) + '%</b><span>terpasang</span><small>' + n + "/" + t.total + "</small></span>"
      : '<span class="atlas-cell__meta"><b>' + n + "</b>/" + t.total + " terpasang</span>";
    return head + '<ul class="cell-next" aria-hidden="true">' + rows + "</ul>";
  }

  function cell(name) {
    var units = K.unitsOf(name), t = tally(units), done = t.total > 0 && t.stages[WORK_DONE] === t.total, moved = todayIn[name] || 0;
    var corner = done || moved ? '<span class="progress-cell__corner" aria-hidden="true">' + (moved ? '<span class="today-chip">' + ARROW + moved + " hari ini</span>" : "") + (done ? '<span class="progress-cell__check">' + workBadge(WORK_DONE) + "</span>" : "") + "</span>" : "";
    var body = done ? '<span class="atlas-cell__meta is-done">Semua terpasang · ' + t.total + "</span>"
      : view.cell === "a" ? bigCell(t) : view.cell === "b" ? ringCell(t) : view.cell === "c" ? nextCell(t, units) : nowCell(t);
    return '<button type="button" class="atlas-cell progress-cell' + (done ? " is-done" : "") + '" data-region="' + esc(name) + '">' + corner +
      '<span class="atlas-cell__shape">' + shape(name) + '</span><span class="atlas-cell__name">' + esc(name) + "</span>" + body + "</button>";
  }

  function panel() {
    var all = tally(M.units);
    var legend = [3, 2, 1, 0].map(function (s) {
      return '<li><span class="stage-legend__badge" aria-hidden="true">' + workBadge(s) + "</span><span>" + STAGE_COUNT_LABEL[s] + "</span><b>" + all.stages[s] + "</b>" + (todaySteps[s] ? '<em class="stage-legend__today">+' + todaySteps[s] + "</em>" : "") + "</li>";
    }).join("");
    return '<button id="sheet-handle" type="button" aria-label="Tutup daftar titik"><span class="sheet-handle__grabber" aria-hidden="true"></span><span class="sheet-handle__text" aria-hidden="true">Tutup Daftar Titik</span></button>' +
      '<div class="panel-top" id="panel-top"><div class="atlas-head"><img alt="Lambang Provinsi Jambi" width="38" height="39" src="../../src/public/assets/lambang-jambi-76.webp"><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar">' + COLLAPSE + "</button></div></div>" +
      '<div class="panel-search-row"><div class="panel-search"><span class="panel-search__icon">' + SEARCH + '</span><input id="list-search" type="search" aria-label="Cari titik PUTS" autocomplete="off" placeholder="Cari lokasi atau kabupaten…"></div><button type="button" aria-label="Titik di dekatku" class="locate-btn" aria-pressed="false">' + LOCATE + '<span class="locate-btn__label">Terdekat</span></button></div>' +
      '<div class="sheet-near"></div>' +
      '<div class="panel-meta" id="panel-meta"><div class="list-mode" role="group" aria-label="Tampilan daftar"><button type="button" aria-pressed="false">Sebaran</button><button type="button" aria-pressed="true">Progres</button></div>' +
      '<div class="atlas-summary atlas-summary--total"><p class="atlas-total atlas-total--progress" role="status"><b class="atlas-total__num">' + all.stages[WORK_DONE] + '</b><span class="atlas-total__label"><span>Titik Terpasang</span><span>dari <b>' + all.total + '</b> titik PUTS</span></span></p>' +
      '<span class="progress-side"><span class="progress-share"><b>' + share(all) + '%</b> selesai</span><button class="today-chip" type="button" data-toast="Di halaman asli: membuka daftar Progres hari ini">' + ARROW + today.length + " hari ini</button></span></div></div>" +
      '<div class="sidebar-scroll"><div id="list-data"><section class="progress-sum" aria-label="Ringkasan progres pembangunan"><span class="stage-bar" aria-hidden="true">' +
      [3, 2, 1, 0].map(function (s) { return all.stages[s] ? '<i class="stage-bar__s' + s + '" style="flex-grow:' + all.stages[s] + '"></i>' : ""; }).join("") + '</span><ul class="stage-legend">' + legend + "</ul></section>" +
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
  nav.setAttribute("aria-label", "Pilih desain sel");
  document.body.prepend(nav);
  function strip() {
    nav.innerHTML = '<span class="mock-bar__label">Sel kabupaten</span>' + CELLS.map(function (item) { return '<button type="button" data-cell="' + item[0] + '" aria-pressed="' + (view.cell === item[0]) + '">' + item[1] + "</button>"; }).join("") +
      (view.cell === "c" ? '<span class="mock-bar__sep" aria-hidden="true"></span><span class="mock-bar__label">Baris terpasang</span>' + HEADS.map(function (item) { return '<button type="button" data-head="' + item[0] + '" aria-pressed="' + (view.head === item[0]) + '">' + item[1] + "</button>"; }).join("") : "") +
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
    if (el.dataset.cell) { view.cell = el.dataset.cell; render(); }
    else if (el.dataset.head) { view.head = el.dataset.head; render(); }
    else if (el.dataset.toast) K.toast(el.dataset.toast);
    else if (el.dataset.region) K.toast("Di halaman asli: membuka daftar kerja " + el.dataset.region);
  });

  map();
  render();
})();
