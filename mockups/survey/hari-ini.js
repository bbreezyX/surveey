/* "Progres hari ini" placement mockups (E, F, G). One script, three pages: body[data-variant] picks
   where today's reports show. The progress view underneath follows the live app: Tiang folded into
   Terpasang, a four-row legend, a check on finished kabupaten.

   The esdm.cloud feed has no dates yet, so "today" here is sample data: fourteen units that already
   have an accepted stage are said to have reached it this morning. The real page needs the time each
   stage was accepted (or a list of today's acceptances) from esdm.cloud. */
(function () {
  "use strict";
  var K = window.Mock, M = K.data, esc = K.esc;
  var variant = document.body.dataset.variant;

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

  // ---- Sample "accepted today" ----
  function hash(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var picked = K.official(M.units).filter(function (u) { return u.s >= 1; })
    .sort(function (a, b) { return hash(a.k + a.c + a.desa) - hash(b.k + b.c + b.desa); }).slice(0, 14);
  var events = picked.map(function (u, i) { var m = 7 * 60 + 12 + i * 14 + (hash(u.c + u.desa) % 9); return { u: u, step: step(u.s), at: m }; })
    .sort(function (a, b) { return b.at - a.at; });
  var clock = function (m) { return String(Math.floor(m / 60)).padStart(2, "0") + "." + String(m % 60).padStart(2, "0"); };
  var todayBy = { 4: 0, 2: 0, 1: 0 }, todayIn = {};
  events.forEach(function (e) { todayBy[e.step]++; todayIn[e.u.k] = (todayIn[e.u.k] || 0) + 1; });
  var dayLabel = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  var updated = clock(events[0].at + 16);

  var UP = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2.5M2.6 5.6 6 2.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var STEP_WORD = { 4: "terpasang", 2: "cor", 1: "galian" };
  function eventRow(e) {
    var u = e.u;
    return '<div class="event" data-event="' + esc(u.c + " " + u.desa) + '"><time>' + clock(e.at) + "</time>" + K.badge(e.step) +
      '<span class="event__text"><b>' + esc(STEP_LABEL[e.step]) + " · Titik " + esc(u.c) + " " + esc(u.desa) + "</b><small>" + esc(u.k) + " · Kec. " + esc(u.kec) + "</small></span></div>";
  }
  function split() {
    return [4, 2, 1].filter(function (s) { return todayBy[s]; }).map(function (s) { return "<span>" + K.badge(s) + todayBy[s] + " " + STEP_WORD[s] + "</span>"; }).join("");
  }

  // ---- Page ----
  var all = tally(M.units);
  var top = document.getElementById("top"), screen = document.getElementById("screen"), mapEl = document.getElementById("map");
  var ICON_COLLAPSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/></svg>';
  var ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';

  function switcher() {
    var pages = [["e-hari-ini-angka.html", "E · Di angka"], ["f-hari-ini-kartu.html", "F · Kartu Hari Ini"], ["g-hari-ini-peta.html", "G · Di peta"]];
    var nav = document.createElement("nav");
    nav.className = "mock-bar";
    nav.setAttribute("aria-label", "Pilih mockup");
    var here = location.pathname.split("/").pop();
    nav.innerHTML = '<span class="mock-bar__label">Progres hari ini</span>' + pages.map(function (p) {
      return '<a href="' + p[0] + '"' + (p[0] === here ? ' aria-current="page"' : "") + ">" + p[1] + "</a>";
    }).join("") + '<span class="mock-bar__note">Data contoh: laporan "hari ini" disimulasikan, umpan esdm.cloud belum punya tanggal</span>';
    document.body.prepend(nav);
  }

  function head() {
    var side = '<span class="total__pct"><b>' + all.pct + "%</b> selesai</span>";
    if (variant === "angka") side += '<button class="today-chip" type="button" popovertarget="today-pop" aria-label="' + events.length + ' tahap diterima hari ini, lihat daftar">' + UP + events.length + " hari ini</button>";
    top.innerHTML = '<div class="atlas-head"><img src="../../src/public/assets/lambang-jambi-76.webp" alt="Lambang Provinsi Jambi" width="38" height="39"><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar">' + ICON_COLLAPSE + "</button></div>" +
      '<div class="fake-search">' + ICON_SEARCH + "Cari lokasi atau kabupaten…</div>" +
      '<div class="mode" aria-hidden="true"><span>Sebaran</span><span class="is-on">Progres <span class="mode__pct">' + all.pct + "%</span></span></div>" +
      '<div class="total"><p class="total__main"><b class="total__num">' + all.s[4] + '</b><span class="total__label"><span>Titik Terpasang</span><span>dari <b>' + all.total + '</b> titik PUTS</span></span></p><span class="total__side">' + side + "</span></div>";
  }

  function legend() {
    return '<ul class="legend">' + [4, 2, 1, 0].map(function (s) {
      var d = variant === "angka" && todayBy[s] ? '<em class="delta" title="' + todayBy[s] + ' hari ini">+' + todayBy[s] + "</em>" : "";
      return "<li>" + K.badge(s) + "<span>" + STEP_LABEL[s] + "</span><b>" + all.s[s] + "</b>" + d + "</li>";
    }).join("") + "</ul>";
  }

  function rest(t) {
    if (t.s[0] === t.total) return '<span class="atlas-cell__rest"><span class="is-none">' + K.badge(0) + "Belum dimulai</span></span>";
    return '<span class="atlas-cell__rest">' + [2, 1, 0].filter(function (s) { return t.s[s]; }).map(function (s) { return "<span>" + K.badge(s) + t.s[s] + "</span>"; }).join("") + "</span>";
  }

  function grid() {
    return '<p class="grid-head" role="heading" aria-level="2">Semua Wilayah<span>' + M.order.length + " kabupaten/kota</span></p><div class=\"atlas-grid\">" + M.order.map(function (name) {
      var t = tally(K.unitsOf(name)), done = t.total > 0 && t.s[4] === t.total, n = todayIn[name] || 0;
      var chip = n && variant !== "peta" ? '<span class="today-chip">' + UP + n + " hari ini</span>" : "";
      return '<button class="atlas-cell" type="button" data-region="' + esc(name) + '">' + (done ? '<span class="atlas-cell__check">' + K.badge(4) + "</span>" : "") +
        '<span class="atlas-cell__shape">' + K.thumb(name).replace(/prog-dot s3/g, "prog-dot s4") + "</span>" +
        '<span class="atlas-cell__name"><span>' + esc(name) + "</span>" + chip + "</span>" +
        (done ? '<span class="atlas-cell__meta is-done">Semua terpasang · ' + t.total + "</span>"
          : '<span class="atlas-cell__meta"><b>' + t.s[4] + "</b>/" + t.total + " terpasang</span>" + bar(t, true) + rest(t)) + "</button>";
    }).join("") + "</div>";
  }

  function todayCard() {
    var latest = events.slice(0, 3).map(eventRow).join(""), more = events.slice(3).map(eventRow).join("");
    return '<section class="today-card" aria-labelledby="today-title"><div class="today-card__head"><h2 id="today-title">Hari ini</h2><span>' + esc(dayLabel) + " · " + updated + '</span></div>' +
      '<p class="today-card__big"><b>' + events.length + "</b><span>tahap diterima</span></p>" +
      '<div class="today-card__split">' + split() + "</div>" + '<div class="today-card__events">' + latest + "</div>" +
      (more ? "<details><summary>Lihat semua " + events.length + " laporan</summary>" + more + "</details>" : "") + "</section>";
  }

  function popover() {
    var pop = document.createElement("div");
    pop.id = "today-pop";
    pop.className = "today-pop";
    pop.setAttribute("popover", "");
    pop.innerHTML = "<h2>Diterima hari ini</h2><p>" + esc(dayLabel) + " · diperbarui " + updated + '</p><div class="today-card__split">' + split() + "</div>" + events.map(eventRow).join("");
    document.body.appendChild(pop);
    // Anchored under the chip; the popover API brings light dismiss and Esc for free.
    pop.addEventListener("toggle", function (event) {
      if (event.newState !== "open") return;
      var chip = document.querySelector('[popovertarget="today-pop"]').getBoundingClientRect();
      pop.style.top = Math.round(chip.bottom + 8) + "px";
      pop.style.left = Math.round(Math.max(16, Math.min(chip.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 16))) + "px";
    });
  }

  // G: today's pins lifted above the rest, with a ring, while the filter is on.
  function mapToday(on) {
    mapEl.classList.toggle("is-today", on);
    var layer = mapEl.querySelector("#today-layer");
    if (layer) layer.remove();
    if (!on) return;
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.id = "today-layer";
    layer.innerHTML = events.map(function (e) {
      var u = e.u;
      return '<circle class="map__halo" cx="' + u.x + '" cy="' + u.y + '" r="30"/><circle class="map__halo-ring" cx="' + u.x + '" cy="' + u.y + '" r="30"/><circle class="map__today-pin" cx="' + u.x + '" cy="' + u.y + '" r="12"/><use href="#b' + u.s + '" x="' + (u.x + 2) + '" y="' + (u.y - 22) + '" width="20" height="20"/>';
    }).join("");
    mapEl.appendChild(layer);
  }

  function mapPanel() {
    var box = document.createElement("div");
    box.className = "map-today";
    box.innerHTML = '<button class="map-today__pill" type="button" aria-pressed="true" aria-controls="today-list"><span class="map-today__dot" aria-hidden="true"></span>Hari ini · <b>' + events.length + "</b> tahap diterima</button>" +
      '<div class="map-today__list" id="today-list">' + events.map(eventRow).join("") + "</div>";
    document.body.appendChild(box);
    var pill = box.querySelector("button"), list = box.querySelector(".map-today__list");
    pill.addEventListener("click", function () {
      var on = pill.getAttribute("aria-pressed") !== "true";
      pill.setAttribute("aria-pressed", on);
      list.hidden = !on;
      mapToday(on);
    });
    mapToday(true);
  }

  switcher();
  K.map(mapEl);
  document.getElementById("legend").innerHTML = [1, 2, 3, 4].map(function (s) { return "<span>" + K.badge(s) + (s === 4 ? "Terpasang" : K.STAGES[s - 1]) + "</span>"; }).join("") + '<span><i class="dot dot--belum"></i>Belum Ditetapkan</span><span><i class="dot dot--duplikat"></i>Perlu Konfirmasi</span>';
  document.getElementById("foot").textContent = "s.d. 6 Oktober 2026 · Dinas ESDM Jambi";
  head();
  screen.innerHTML = (variant === "kartu" ? todayCard() : "") + '<section class="sum" aria-label="Ringkasan progres">' + bar(all) + legend() + "</section>" + grid();
  if (variant === "angka") popover();
  if (variant === "peta") mapPanel();

  document.addEventListener("click", function (event) {
    var ev = event.target.closest && event.target.closest("[data-event]");
    if (ev) { K.toast("Di halaman asli: peta terbang ke titik " + ev.getAttribute("data-event") + " dan membuka popup-nya"); return; }
    var cell = event.target.closest && event.target.closest("[data-region]");
    if (cell) K.toast("Di halaman asli: membuka daftar kerja " + cell.getAttribute("data-region"));
  });
})();
