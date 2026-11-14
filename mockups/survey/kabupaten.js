/* Mockup I: one kabupaten's list in Sebaran and in Progres, with the live markup and stylesheets. The strip
   picks the variants:
     Tahap di Sebaran   Pil (live) · Badge di nomor (the pin's badge on the number box) · Tanpa tahap
     Progres            Legenda (live) · Tanpa legenda (the work groups already key the bar's colours)
   Units come from the data.js snapshot; group titles use the desa name rather than the allocation sheet's
   "Lokasi Rekapan" line, which the snapshot does not carry. The header's "titik di" has its space back. */
(function () {
  "use strict";
  var K = window.Mock, M = K.data, esc = K.esc;
  var view = { stage: "pil", legend: "on", kab: "Kota Jambi", tab: "sebaran" };
  var STAGE_OPTIONS = [["pil", "Pil (sekarang)"], ["nomor", "Badge di nomor"], ["none", "Tanpa tahap"]];
  var LEGEND_OPTIONS = [["on", "Legenda (sekarang)"], ["off", "Tanpa legenda"]];
  var KAB_OPTIONS = [["Kota Jambi", "Kota Jambi"], ["Batanghari", "Batanghari"], ["Kerinci", "Kerinci"]];

  // progress.ts: Tiang folds into terpasang in the progress view.
  var WORK_DONE = 3;
  var workStep = function (stage) { return Math.min(stage, WORK_DONE); };
  var workBadge = function (step) { return K.badge(step === WORK_DONE ? 4 : step); };
  var STAGE_COUNT_LABEL = ["Belum dimulai", "Galian selesai", "Cor selesai", "Terpasang"];
  var NEXT_REPORT = [["Lapor Galian", "Belum ada tahap diterima"], ["Lapor Cor", "Galian sudah diterima"], ["Lapor Tiang", "Cor sudah diterima"]];
  var CLOCK = '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var pendingLabel = function (p) { return K.STAGES[Math.max.apply(null, p) - 1] + " Menunggu"; };

  // Icon.svelte
  function icon(body, size, cls) {
    return '<svg' + (cls ? ' class="panel-icon"' : "") + ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
  }
  var BACK = icon('<path d="m14.5 6-6 6 6 6"/>', 16, true);
  var COLLAPSE = icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/>', 20, true);
  var SEARCH = icon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', 18);
  var LOCATE = icon('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>', 22);
  var CAMERA = icon('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>', 16);

  function bounds() {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    M.regions.forEach(function (r) { b[0] = Math.min(b[0], r.box[0]); b[1] = Math.min(b[1], r.box[1]); b[2] = Math.max(b[2], r.box[0] + r.box[2]); b[3] = Math.max(b[3], r.box[1] + r.box[3]); });
    return b;
  }
  function regionPaths(cls) {
    return M.regions.slice().sort(function (a, b) { return (a.name === view.kab) - (b.name === view.kab); }).map(function (r) {
      return '<path class="' + cls + (r.name === view.kab ? " is-on" : "") + '" fill-rule="evenodd" d="' + r.d + '"/>';
    }).join("");
  }
  function locator() {
    var b = bounds();
    return '<svg viewBox="' + [b[0], b[1], b[2] - b[0], b[3] - b[1]].join(" ") + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + regionPaths("atlas-loc") + "</svg>";
  }

  var units = function () { return K.official(K.unitsOf(view.kab)).sort(function (a, b) { return a.n < b.n ? -1 : 1; }); };
  var coord = function (u) { return u.ll.split(", "); };

  // ---- Panel frame, as Sidebar.svelte renders a kabupaten ----
  function frame() {
    var list = units(), sebaran = view.tab === "sebaran";
    var kec = new Set(list.map(function (u) { return u.kec; })).size, done = list.filter(function (u) { return workStep(u.s) === WORK_DONE; }).length;
    var share = Math.round((K.official(M.units).filter(function (u) { return workStep(u.s) === WORK_DONE; }).length / K.official(M.units).length) * 100);
    var line = sebaran ? "<b>" + list.length + '</b> titik<span class="atlas-detail__kec"> di <b>' + kec + "</b> kecamatan</span>" : "<b>" + done + "</b> dari <b>" + list.length + "</b> titik terpasang";
    return '<button id="sheet-handle" type="button" aria-label="Tutup daftar titik"><span class="sheet-handle__grabber" aria-hidden="true"></span><span class="sheet-handle__text" aria-hidden="true">Tutup Daftar Titik</span></button>' +
      '<div class="panel-top" id="panel-top"><div class="atlas-detail"><div class="atlas-detail__bar"><button class="atlas-back" type="button" aria-label="Kembali ke semua wilayah" data-toast="Di halaman asli: kembali ke Semua Wilayah">' + BACK + '<span class="atlas-back__label">Semua Wilayah</span></button><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar">' + COLLAPSE + "</button></div>" +
      '<div class="atlas-detail__main"><div><h1>' + esc(view.kab) + "</h1><p>" + line + '</p></div><div class="atlas-locator" role="img" aria-label="Letak ' + esc(view.kab) + ' di Provinsi Jambi">' + locator() + "</div></div></div></div>" +
      '<div class="panel-search-row"><div class="panel-search"><span class="panel-search__icon">' + SEARCH + '</span><input id="list-search" type="search" aria-label="Cari titik PUTS" autocomplete="off" placeholder="Cari dalam ' + esc(view.kab) + '…"></div><button type="button" aria-label="Titik di dekatku" class="locate-btn" aria-pressed="false">' + LOCATE + '<span class="locate-btn__label">Terdekat</span></button></div>' +
      '<div class="sheet-near"></div>' +
      '<div class="panel-meta" id="panel-meta"><div class="list-mode" role="group" aria-label="Tampilan daftar"><button type="button" data-tab="sebaran" aria-pressed="' + sebaran + '">Sebaran</button><button type="button" data-tab="progres" aria-pressed="' + !sebaran + '">Progres' + (sebaran ? '<span class="list-mode__share">' + share + "%</span>" : "") + "</button></div>" +
      (sebaran ? '<p class="atlas-hint" role="status">Pilih nomor titik untuk melihatnya di peta.</p>' : "") + "</div>" +
      '<div class="sidebar-scroll"><div id="list-data">' + (sebaran ? sebaranList(list) : progresList(list)) + "</div></div>" +
      '<p class="sidebar-footer"><span class="sidebar-footer__title">Survey Lapangan &amp; Pelaksanaan</span><span class="sidebar-footer__meta">s.d. 6 Oktober 2026 · Dinas ESDM Jambi</span></p>';
  }

  function byKey(list, key) {
    var groups = [];
    list.forEach(function (u) { var k = key(u), g = groups.find(function (x) { return x.key === k; }); if (!g) groups.push(g = { key: k, items: [] }); g.items.push(u); });
    return groups;
  }
  var flagClass = function (u) { return u.f === "duplikat" ? " is-duplikat" : u.f === "belum" ? " is-belum" : ""; };

  // ---- Sebaran: PointList.svelte ----
  function sebaranUnit(u) {
    var c = coord(u), badge = view.stage === "nomor" && u.s ? '<span class="unit-badge" aria-hidden="true">' + K.badge(u.s) + "</span>" : "";
    var stages = "";
    if (view.stage !== "none" && (u.s || u.p.length)) {
      stages = '<span class="atlas-pt__stages" aria-hidden="true">' +
        (view.stage === "pil" && u.s ? '<span class="atlas-pt__stage' + (u.s >= 4 ? " is-done" : "") + '">' + K.badge(u.s) + K.stageSummary(u.s) + "</span>" : "") +
        (u.p.length ? '<span class="atlas-pt__stage is-pending">' + CLOCK + pendingLabel(u.p) + "</span>" : "") + "</span>";
    }
    return '<button type="button" class="atlas-pt" data-point="' + esc(u.c + " " + u.desa) + '"><span class="atlas-unit' + flagClass(u) + (badge ? " has-badge" : "") + '">' + esc(u.c) + badge + "</span>" +
      '<span class="atlas-pt__info">' + (u.f === "belum" ? '<span class="atlas-pt__coord atlas-pt__coord--none">Belum ada koordinat</span>' : '<span class="atlas-pt__coord">' + c[0] + "<br>" + c[1] + "</span>") + stages + "</span></button>";
  }
  function sebaranList(list) {
    var sections = byKey(list, function (u) { return u.kec; });
    return sections.map(function (s) {
      return '<div class="atlas-group">' + (sections.length > 1 ? '<div class="atlas-section" role="heading" aria-level="3">Kec. ' + esc(s.key) + "<span>" + s.items.length + " titik</span></div>" : "") +
        byKey(s.items, function (u) { return u.desa; }).map(function (g) {
          return '<div class="atlas-desa"><div class="atlas-desa__head"><span class="atlas-desa__title">' + esc(g.key) + '</span><span class="atlas-desa__count">' + g.items.length + ' titik</span></div><div class="atlas-units">' + g.items.map(sebaranUnit).join("") + "</div></div>";
        }).join("") + "</div>";
    }).join("");
  }

  // ---- Progres: WorkList.svelte ----
  function rows(list, done) {
    return byKey(list, function (u) { return u.desa + "|" + u.kec; }).map(function (g) {
      var u0 = g.items[0];
      return '<div class="work-desa"><span class="work-desa__title">' + esc(u0.desa) + '</span><span class="work-desa__kec">Kec. ' + esc(u0.kec) + "</span></div>" + g.items.map(function (u) {
        return '<div class="work-row"><button class="work-row__main" type="button" data-point="' + esc(u.c + " " + u.desa) + '"><span class="atlas-unit' + flagClass(u) + '">' + esc(u.c) + '</span><span class="work-row__text">' +
          (u.p.length ? '<span class="atlas-pt__stage is-pending">' + CLOCK + pendingLabel(u.p) + "</span>" : "") +
          '<span class="work-row__coord' + (u.f === "belum" ? " is-none" : "") + '">' + (u.f === "belum" ? "Belum ada koordinat" : esc(u.ll)) + "</span></span></button>" +
          (done ? '<span class="work-row__done">Selesai</span>' : '<a class="work-row__lapor" href="#" data-toast="Di halaman asli: buka esdm.cloud/lapangan untuk titik ' + esc(u.c) + '" aria-label="Lapor progres titik ' + esc(u.c) + '">' + CAMERA + "<span>Lapor</span></a>") + "</div>";
      }).join("");
    }).join("");
  }
  function group(cls, badge, title, note, list, done) {
    return '<details class="work-group' + cls + '"><summary><span class="work-group__badge' + (badge === CLOCK ? " work-group__badge--wait" : "") + '" aria-hidden="true">' + badge + '</span><span><span class="work-group__title">' + title + '</span><span class="work-group__note">' + note + '</span></span><span class="work-group__count">' + list.length + "</span></summary>" +
      (list.length ? rows(list, done) : '<p class="work-group__empty">Belum ada titik terpasang.</p>') + "</details>";
  }
  function progresList(list) {
    var due = [[], [], []], waiting = [], done = [], stages = [0, 0, 0, 0];
    list.forEach(function (u) { var s = workStep(u.s); stages[s]++; if (u.p.length) waiting.push(u); else if (s === WORK_DONE) done.push(u); else due[s].push(u); });
    var first = due.findIndex(function (l) { return l.length; });
    var bar = '<span class="stage-bar" aria-hidden="true">' + [3, 2, 1, 0].filter(function (s) { return stages[s]; }).map(function (s) { return '<i class="stage-bar__s' + s + '" style="flex-grow:' + stages[s] + '"></i>'; }).join("") + "</span>";
    var legend = view.legend === "on" ? '<ul class="stage-legend stage-legend--tight">' + [3, 2, 1, 0].map(function (s) {
      return '<li><span class="stage-legend__badge" aria-hidden="true">' + workBadge(s) + "</span><span>" + STAGE_COUNT_LABEL[s] + "</span><b>" + stages[s] + "</b></li>";
    }).join("") + "</ul>" : "";
    return '<section class="work-sum" aria-label="Progres ' + esc(view.kab) + '">' + bar + legend + "</section>" +
      due.map(function (l, s) { return l.length ? group(s === first ? " is-next" : "", workBadge(s), NEXT_REPORT[s][0], NEXT_REPORT[s][1], l, false) : ""; }).join("") +
      (waiting.length ? group("", CLOCK, "Menunggu Diperiksa", "Sudah dikirim, belum diterima kantor", waiting, false) : "") +
      group(" is-done", workBadge(WORK_DONE), "Terpasang", "Tiang berdiri, lampu terpasang", done, true);
  }

  // ---- Map backdrop: the province right of the panel, the kabupaten lit ----
  function map() {
    var svg = document.getElementById("map"), b = bounds(), bw = b[2] - b[0], bh = b[3] - b[1];
    svg.innerHTML = regionPaths("");
    var fit = function () {
      var vw = svg.clientWidth, vh = svg.clientHeight, left = innerWidth >= 960 ? 432 : 0, w = vw - left, h = innerWidth >= 960 ? vh : vh * 0.4;
      var scale = Math.min(w / bw, h / bh) * 0.86;
      svg.setAttribute("viewBox", [b[0] - (left + (w - bw * scale) / 2) / scale, b[1] - (h - bh * scale) / 2 / scale, vw / scale, vh / scale].map(function (n) { return n.toFixed(1); }).join(" "));
    };
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    fit();
    if (!map.bound) { map.bound = true; addEventListener("resize", fit); }
  }

  // ---- Mockup strip ----
  var nav = document.createElement("nav");
  nav.className = "mock-bar";
  nav.setAttribute("aria-label", "Pilih varian mockup");
  document.body.prepend(nav);
  function strip() {
    var group = function (key, list) { return list.map(function (item) { return '<button type="button" data-' + key + '="' + item[0] + '" aria-pressed="' + (view[key] === item[0]) + '">' + item[1] + "</button>"; }).join(""); };
    nav.innerHTML = '<span class="mock-bar__label">Tahap di Sebaran</span>' + group("stage", STAGE_OPTIONS) + '<span class="mock-bar__sep" aria-hidden="true"></span>' +
      '<span class="mock-bar__label">Progres</span>' + group("legend", LEGEND_OPTIONS) + '<span class="mock-bar__sep" aria-hidden="true"></span>' + group("kab", KAB_OPTIONS) +
      '<span class="mock-bar__note">Klik tab Sebaran/Progres di panel · data contoh ' + esc(M.taken) + "</span>";
  }

  function render() {
    document.getElementById("sidebar").innerHTML = frame();
    strip();
    map();
  }

  document.addEventListener("click", function (event) {
    var el = event.target.closest && event.target.closest("button, a, [data-point]");
    if (!el) return;
    var d = el.dataset;
    if (d.stage) view.stage = d.stage;
    else if (d.legend) view.legend = d.legend;
    else if (d.kab) view.kab = d.kab;
    else if (d.tab) view.tab = d.tab;
    else if (d.toast) { event.preventDefault(); K.toast(d.toast); return; }
    else if (d.point) { K.toast("Di halaman asli: peta terbang ke titik " + d.point + " dan membuka popup-nya"); return; }
    else return;
    render();
  });

  render();
})();
