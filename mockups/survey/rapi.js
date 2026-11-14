/* Mockup H: Sebaran and Progres with the doubles taken out. The strip on top picks a layout:
     Sekarang   the live app as deployed (1242aca)
     1+3        the Progres tab's "32%" only while Sebaran is open (1), cells without their bar (3)
     1+2+3      as 1+3, and the Terpasang legend row keeps the colour key and today's "+n" only (2)
   and a name for the views (4). The tabs in the panel switch views as they do live.
   "Hari ini" is sample data, seven units picked from those with an accepted stage. */
(function () {
  "use strict";
  var K = window.Mock, M = K.data, esc = K.esc;

  var view = { layout: "a", tab: "progres", name: "now", marks: true };
  var LAYOUTS = [["now", "Sekarang"], ["a", "Usulan 1+3"], ["b", "Usulan 1+2+3"]];
  var NAMES = [["now", "Nama sekarang"], ["lokasi", "Tab “Lokasi”"], ["judul", "Judul “Peta PUTS 2026”"]];
  var mark = function (n) { return '<i class="mark" aria-hidden="true">' + n + "</i>"; };

  // ---- Progress, as the live view counts it ----
  var STEP_LABEL = { 4: "Terpasang", 2: "Cor selesai", 1: "Galian selesai", 0: "Belum dimulai" };
  var step = function (stage) { return stage >= 3 ? 4 : stage; };
  function tally(units) {
    var t = { total: 0, s: { 4: 0, 2: 0, 1: 0, 0: 0 } };
    K.official(units).forEach(function (u) { t.total++; t.s[step(u.s)]++; });
    t.pct = t.total ? Math.round((t.s[4] / t.total) * 100) : 0;
    return t;
  }
  function bar(t, thin) {
    return '<div class="dist' + (thin ? " dist--thin" : "") + '" aria-hidden="true">' + [4, 2, 1, 0].map(function (s) {
      return t.s[s] ? '<i class="s' + s + '" style="flex:' + t.s[s] + '"></i>' : "";
    }).join("") + "</div>";
  }

  // ---- Sample "hari ini" ----
  function hash(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var today = K.official(M.units).filter(function (u) { return u.s >= 1; })
    .sort(function (a, b) { return hash(a.k + a.c + a.desa) - hash(b.k + b.c + b.desa); }).slice(0, 7);
  var todayBy = { 4: 0, 2: 0, 1: 0, 0: 0 }, todayIn = {};
  today.forEach(function (u) { todayBy[step(u.s)]++; todayIn[u.k] = (todayIn[u.k] || 0) + 1; });
  var UP = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2.5M2.6 5.6 6 2.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var all = tally(M.units);
  var official = K.official(M.units);
  var top = document.getElementById("top"), screen = document.getElementById("screen");
  var ICON_COLLAPSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/></svg>';
  var ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
  var ICON_FIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.5"/></svg>';

  // ---- Names (4) ----
  function names() {
    return {
      title: view.name === "judul" ? "Peta PUTS 2026" : "Sebaran PUTS 2026",
      first: view.name === "lokasi" ? "Lokasi" : "Sebaran",
    };
  }

  // ---- Panel top: header, search, tabs, total ----
  function head() {
    var n = names(), sebaran = view.tab === "sebaran", proposal = view.layout !== "now";
    // 1: once Progres is open, "32% selesai" sits right under the tab; the tab's own pill only
    // invites a reader still on Sebaran.
    var pill = sebaran || !proposal ? ' <span class="mode__pct">' + all.pct + "%</span>" : "";
    var tabs = '<div class="mode" role="group" aria-label="Tampilan">' +
      '<button type="button" data-tab="sebaran" class="' + (sebaran ? "is-on" : "") + '" aria-pressed="' + sebaran + '">' + n.first + (view.name === "lokasi" ? mark(4) : "") + "</button>" +
      '<button type="button" data-tab="progres" class="' + (sebaran ? "" : "is-on") + '" aria-pressed="' + !sebaran + '">Progres' + pill + (!sebaran && proposal ? mark(1) : "") + "</button></div>";
    var total = sebaran
      ? '<div class="total"><p class="total__main"><b class="total__num total__count">' + official.length + '</b><span class="total__label"><span>Titik PUTS</span><span>di <b>' + M.order.length + "</b> kabupaten/kota</span></span></p>" +
        '<button class="see-all" type="button" data-toast="Di halaman asli: peta memperlihatkan semua titik">' + ICON_FIT + "Lihat Semua</button></div>"
      : '<div class="total"><p class="total__main"><b class="total__num">' + all.s[4] + '</b><span class="total__label"><span>Titik Terpasang</span><span>dari <b>' + all.total + '</b> titik PUTS</span></span></p>' +
        '<span class="total__side"><span class="total__pct"><b>' + all.pct + '%</b> selesai</span><button class="today-chip" type="button" data-toast="Di halaman asli: membuka daftar Progres hari ini">' + UP + today.length + " hari ini</button></span></div>";
    top.innerHTML = '<div class="atlas-head"><img src="../../src/public/assets/lambang-jambi-76.webp" alt="Lambang Provinsi Jambi" width="38" height="39"><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">' + n.title + (view.name === "judul" ? mark(4) : "") + '</h1></div><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar">' + ICON_COLLAPSE + "</button></div>" +
      '<div class="fake-search">' + ICON_SEARCH + "Cari lokasi atau kabupaten…</div>" + tabs + total;
    document.getElementById("masthead-title").textContent = n.title;
  }

  // ---- Sebaran: the live atlas grid, pins as the map draws them ----
  function sebaranThumb(name) {
    var r = M.regions.find(function (x) { return x.name === name; }), pad = Math.max(r.box[2], r.box[3]) * 0.04;
    var box = [r.box[0] - pad, r.box[1] - pad, r.box[2] + pad * 2, r.box[3] + pad * 2], rad = Math.max(box[2], box[3]) / 40;
    var dots = K.official(K.unitsOf(name)).map(function (u) {
      return '<circle class="sebaran-dot' + (u.f ? " is-" + u.f : "") + '" cx="' + u.x + '" cy="' + u.y + '" r="' + rad.toFixed(1) + '"/>';
    }).join("");
    return '<svg viewBox="' + box.join(" ") + '" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false"><path class="atlas-shape" fill-rule="evenodd" d="' + r.d + '"/>' + dots + "</svg>";
  }

  function sebaranGrid() {
    return '<div class="atlas-grid atlas-grid--sebaran">' + M.order.map(function (name) {
      var units = K.official(K.unitsOf(name));
      var kec = new Set(units.map(function (u) { return u.kec; })).size;
      var dup = units.filter(function (u) { return u.f === "duplikat"; }).length, belum = units.filter(function (u) { return u.f === "belum"; }).length;
      return '<button class="atlas-cell" type="button" data-region="' + esc(name) + '"><span class="atlas-cell__shape">' + sebaranThumb(name) + "</span>" +
        '<span class="atlas-cell__name"><span>' + esc(name) + "</span></span>" +
        '<span class="atlas-cell__meta"><b>' + units.length + "</b> titik di " + kec + " kecamatan</span>" +
        (dup ? '<span class="flag flag--duplikat">' + dup + " perlu konfirmasi</span>" : "") +
        (belum ? '<span class="flag flag--belum">' + belum + " belum ditetapkan</span>" : "") + "</button>";
    }).join("") + "</div>";
  }

  // ---- Progres ----
  function legend() {
    return '<ul class="legend">' + [4, 2, 1, 0].map(function (s) {
      var d = todayBy[s] ? '<em class="delta" title="' + todayBy[s] + ' hari ini">+' + todayBy[s] + "</em>" : "";
      // 2: the headline already says 158, so this row only keys the green and carries today's step.
      if (s === 4 && view.layout === "b") return '<li class="is-key">' + K.badge(s) + "<span>" + STEP_LABEL[s] + mark(2) + "</span>" + d + "</li>";
      return "<li>" + K.badge(s) + "<span>" + STEP_LABEL[s] + "</span><b>" + all.s[s] + "</b>" + d + "</li>";
    }).join("") + "</ul>";
  }

  function rest(t) {
    if (t.s[0] === t.total) return '<span class="atlas-cell__rest"><span class="is-none">' + K.badge(0) + "Belum dimulai</span></span>";
    return '<span class="atlas-cell__rest">' + [2, 1, 0].filter(function (s) { return t.s[s]; }).map(function (s) { return "<span>" + K.badge(s) + t.s[s] + "</span>"; }).join("") + "</span>";
  }

  function progresGrid() {
    var marked = false;
    return '<p class="grid-head" role="heading" aria-level="2">Semua Wilayah<span>' + M.order.length + ' kabupaten/kota</span></p><div class="atlas-grid">' + M.order.map(function (name) {
      var t = tally(K.unitsOf(name)), done = t.total > 0 && t.s[4] === t.total, n = todayIn[name] || 0;
      // 3: "x/y terpasang" and the badges for what is left already tell the split the thin bar draws.
      var noBar = view.layout !== "now";
      var tag = noBar && !done && !marked ? (marked = true, mark(3)) : "";
      var chip = n ? '<span class="today-chip">' + UP + n + " hari ini</span>" : "";
      return '<button class="atlas-cell' + (noBar ? " no-bar" : "") + '" type="button" data-region="' + esc(name) + '">' + (done ? '<span class="atlas-cell__check">' + K.badge(4) + "</span>" : "") +
        '<span class="atlas-cell__shape">' + K.thumb(name).replace(/prog-dot s3/g, "prog-dot s4") + "</span>" +
        '<span class="atlas-cell__name"><span>' + esc(name) + "</span>" + chip + "</span>" +
        (done ? '<span class="atlas-cell__meta is-done">Semua terpasang · ' + t.total + "</span>"
          : '<span class="atlas-cell__meta"><b>' + t.s[4] + "</b>/" + t.total + " terpasang" + tag + "</span>" + (noBar ? "" : bar(t, true)) + rest(t)) + "</button>";
    }).join("") + "</div>";
  }

  function render() {
    head();
    screen.innerHTML = view.tab === "sebaran" ? sebaranGrid()
      : '<section class="sum" aria-label="Ringkasan progres">' + bar(all) + legend() + "</section>" + progresGrid();
    document.body.classList.toggle("no-marks", !view.marks);
    strip();
  }

  // ---- Mockup strip ----
  var nav = document.createElement("nav");
  nav.className = "mock-bar";
  nav.setAttribute("aria-label", "Pilih mockup");
  document.body.prepend(nav);
  function strip() {
    var group = function (key, list) {
      return list.map(function (item) { return '<button type="button" data-' + key + '="' + item[0] + '" aria-pressed="' + (view[key] === item[0]) + '">' + item[1] + "</button>"; }).join("");
    };
    nav.innerHTML = '<span class="mock-bar__label">Rapikan</span>' + group("layout", LAYOUTS) + '<span class="mock-bar__sep" aria-hidden="true"></span>' + group("name", NAMES) +
      '<span class="mock-bar__sep" aria-hidden="true"></span><button type="button" data-marks aria-pressed="' + view.marks + '">Tanda nomor</button>' +
      '<span class="mock-bar__note">Klik tab Sebaran/Progres di panel · angka kuning = nomor usulan</span>';
  }

  document.addEventListener("click", function (event) {
    var el = event.target.closest && event.target.closest("button, [data-region]");
    if (!el) return;
    if (el.dataset.layout) view.layout = el.dataset.layout;
    else if (el.dataset.name) view.name = el.dataset.name;
    else if (el.hasAttribute("data-marks")) view.marks = !view.marks;
    else if (el.dataset.tab) view.tab = el.dataset.tab;
    else if (el.dataset.toast) { K.toast(el.dataset.toast); return; }
    else if (el.dataset.region) { K.toast("Di halaman asli: membuka " + (view.tab === "sebaran" ? "daftar titik " : "daftar kerja ") + el.dataset.region); return; }
    else return;
    render();
  });

  K.map(document.getElementById("map"));
  document.getElementById("legend").innerHTML = [1, 2, 3, 4].map(function (s) { return "<span>" + K.badge(s) + (s === 4 ? "Terpasang" : K.STAGES[s - 1]) + "</span>"; }).join("") + '<span><i class="dot dot--belum"></i>Belum Ditetapkan</span><span><i class="dot dot--duplikat"></i>Perlu Konfirmasi</span>';
  document.getElementById("foot").textContent = "s.d. 6 Oktober 2026 · Dinas ESDM Jambi";
  render();
})();
