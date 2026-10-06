/* Sidebar mockups: three skins over the real app.

   The live site runs in #app. Its sidebar is hidden with visibility only, so
   it keeps its box and the map still pads around a left panel (its width is
   set to the mockup's). Every control in a mockup clicks the real control;
   after each change the real list is read back out of the DOM and drawn in
   the chosen layout. Search, drill-in, status filters, fitting the map and
   point popups are therefore production behaviour, not imitations. */
(function () {
  "use strict";

  var WIDTH = { a: 372, b: 392, c: 372 };
  var ORDER = ["a", "b", "c", "asli"];
  var LAMBANG = "/assets/lambang-jambi.png";

  var body = document.body;
  var frame = document.getElementById("app");
  var panel = document.getElementById("mk-panel");
  var regions = {};
  Array.prototype.forEach.call(panel.querySelectorAll("[data-region]"), function (el) {
    regions[el.getAttribute("data-region")] = el;
  });
  var searchInput = document.getElementById("mk-search-input");
  var searchClear = panel.querySelector(".mk-search__clear");
  var expandBtn = document.getElementById("mk-expand");
  var grabber = panel.querySelector(".mk-grabber");
  var grabberText = grabber.querySelector(".mk-grabber__text");
  var switcher = document.getElementById("mk-switcher");
  var narrowNote = document.getElementById("mk-narrow");

  var appWin = null;
  var appDoc = null;
  var variant = location.hash.replace("#", "") || "a";
  var model = null;
  var groupsCache = [];
  var geo = null;
  var rendered = {};
  var lastScreen = "";
  var lastQuery = "";
  var pendingFocus = null;
  var queued = false;
  var hl = null;
  var hoverKey = null;
  var enterTimer = null;
  var narrow = null;
  // ?open=Kab.%20Tebo&filter=duplikat&q=… lands straight on a state, so a
  // link (or a screenshot) can show a detail screen without clicking.
  var params = new URLSearchParams(location.search);
  var boot = { open: params.get("open"), filter: params.get("filter"), q: params.get("q") };
  var bootPoint = params.get("point");

  // ---------- helpers ----------------------------------------------------

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function txt(el) {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function num(value) {
    var match = String(value || "").replace(/\./g, "").match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString("id-ID");
  }

  // Under a "Kabupaten/Kota" heading the prefix is noise; "Kota" stays
  // because it tells the city from the kabupaten around it.
  function shortName(name) {
    return String(name || "").replace(/^Kab\.\s+/i, "");
  }

  function normKey(name) {
    return String(name || "")
      .toUpperCase()
      .replace(/^KAB(UPATEN)?\.?\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cssValue(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  var PATHS = {
    chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
    chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
    frame:
      '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.2"/>',
    panelClose: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/>'
  };

  function icon(name, size) {
    var s = size || 18;
    return (
      '<svg class="mk-icon" viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" aria-hidden="true" focusable="false">' + PATHS[name] + "</svg>"
    );
  }

  // ---------- reading the real app ----------------------------------------

  function emptyModel() {
    return {
      screen: "overview", group: "", summary: "", footer: "", query: "",
      loading: true, error: "", filters: [], groups: [], sections: [], empty: ""
    };
  }

  function readModel() {
    var d = appDoc;
    var list = d.getElementById("list-data");
    var ctx = d.querySelector(".panel-context");
    var input = d.getElementById("list-search");
    var m = emptyModel();
    m.screen = ctx ? "detail" : "overview";
    m.group = ctx ? txt(ctx.querySelector(".panel-context__title")) : "";
    m.summary = txt(d.getElementById("list-summary"));
    m.footer = txt(d.querySelector(".sidebar-footer"));
    m.query = input ? input.value : "";
    if (!list) {
      return m;
    }
    m.loading = !!list.querySelector(".loading-state, .skeleton-row");

    var err = list.querySelector(".data-error");
    if (err) {
      m.error = txt(err.querySelector(".data-error__copy")) || txt(err);
    }

    Array.prototype.forEach.call(d.querySelectorAll(".status-chip"), function (chip) {
      var match = chip.className.match(/status-chip--(\w+)/);
      m.filters.push({
        flag: match ? match[1] : "",
        count: num(txt(chip.querySelector(".status-chip__count"))),
        active: chip.classList.contains("is-active")
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll(".group-row"), function (row) {
      var g = {
        name: row.getAttribute("data-group-name"),
        count: num(txt(row.querySelector(".group-row__count strong"))),
        kecamatan: 0,
        duplikat: 0,
        belum: 0
      };
      Array.prototype.forEach.call(row.querySelectorAll(".group-row__meta-item"), function (part) {
        var t = txt(part);
        if (part.classList.contains("group-row__flag--duplikat")) {
          g.duplikat = num(t);
        } else if (part.classList.contains("group-row__flag--belum")) {
          g.belum = num(t);
        } else if (/kecamatan/i.test(t)) {
          g.kecamatan = num(t);
        }
      });
      m.groups.push(g);
    });

    var section = null;
    Array.prototype.forEach.call(list.querySelectorAll(".list-section, .item"), function (node) {
      if (node.classList.contains("list-section")) {
        section = {
          title: txt(node.querySelector(".list-section__title")),
          count: num(txt(node.querySelector(".list-section__count"))),
          items: []
        };
        m.sections.push(section);
        return;
      }
      if (!section) {
        section = { title: "", count: 0, items: [] };
        m.sections.push(section);
      }
      section.items.push({
        id: node.getAttribute("data-item-id"),
        code: txt(node.querySelector(".item-code")),
        label: txt(node.querySelector(".item-label")),
        coord: txt(node.querySelector(".item-coord")),
        sub: txt(node.querySelector(".item-subline")),
        cadangan: node.classList.contains("is-cadangan"),
        duplikat: node.classList.contains("is-duplikat"),
        belum: node.classList.contains("is-belum"),
        active: node.classList.contains("is-active")
      });
    });

    var empty = list.querySelector(".empty-state");
    if (empty) {
      m.empty = txt(empty.querySelector(".empty-state__copy")) || txt(empty);
    }
    return m;
  }

  function findGroup(name) {
    for (var i = 0; i < groupsCache.length; i++) {
      if (groupsCache[i].name === name) {
        return groupsCache[i];
      }
    }
    return null;
  }

  function totals() {
    var t = { count: 0, kecamatan: 0, duplikat: 0, belum: 0, groups: groupsCache.length };
    groupsCache.forEach(function (g) {
      t.count += g.count;
      t.kecamatan += g.kecamatan;
      t.duplikat += g.duplikat;
      t.belum += g.belum;
    });
    return t;
  }

  function sourceLine(m) {
    var match = /s\.d\.\s+(.+?)(?:\s+·|$)/.exec(m.footer);
    return "Sumber: survey lapangan" + (match ? " s.d. " + match[1] : "");
  }

  function cleanSummary(text) {
    return String(text || "").replace(/\s*·\s*peta difilter ke grup ini/i, "");
  }

  function activeFilter(m) {
    return m.filters.some(function (f) {
      return f.active && f.flag;
    });
  }

  // ---------- shared pieces ------------------------------------------------

  var FLAG_COUNT = { duplikat: "perlu verifikasi", belum: "belum ditetapkan" };
  var FLAG_LABEL = { "": "Semua", duplikat: "Perlu verifikasi", belum: "Belum ditetapkan" };
  var FLAG_ORDER = ["", "duplikat", "belum"];

  function groupFlags(g) {
    var out = [];
    if (g.duplikat) {
      out.push({ flag: "duplikat", n: g.duplikat });
    }
    if (g.belum) {
      out.push({ flag: "belum", n: g.belum });
    }
    return out;
  }

  // A status count is also a shortcut into the filtered group, as on the
  // live site; spans inside a button cannot be buttons, so the click handler
  // reads which part was hit.
  function flagSpans(g) {
    return groupFlags(g)
      .map(function (f) {
        return (
          '<span class="mk-flag mk-flag--' + f.flag + '" data-shortcut="' + f.flag +
          '" title="Tampilkan hanya ' + FLAG_COUNT[f.flag] + '">' + fmt(f.n) + " " +
          FLAG_COUNT[f.flag] + "</span>"
        );
      })
      .join("");
  }

  function groupAria(g) {
    var parts = [g.name, fmt(g.count) + " titik", fmt(g.kecamatan) + " kecamatan"];
    if (g.duplikat) {
      parts.push(fmt(g.duplikat) + " perlu verifikasi");
    }
    if (g.belum) {
      parts.push(fmt(g.belum) + " lokasi belum ditetapkan");
    }
    parts.push("buka daftar");
    return parts.join(", ");
  }

  function itemFlags(it) {
    var out = [];
    if (it.cadangan) {
      out.push(["cadangan", "Cadangan"]);
    }
    if (it.duplikat) {
      out.push(["duplikat", "Perlu verifikasi"]);
    }
    if (it.belum) {
      out.push(["belum", "Lokasi belum ditetapkan"]);
    }
    return out;
  }

  function itemFlagSpans(it) {
    return itemFlags(it)
      .map(function (f) {
        return '<span class="mk-flag mk-flag--' + f[0] + '">' + f[1] + "</span>";
      })
      .join("");
  }

  function itemAria(it) {
    return ["Titik " + it.code]
      .concat(itemFlags(it).map(function (f) { return f[1]; }), [it.label, it.sub])
      .filter(Boolean)
      .join(". ");
  }

  // "RT 02 Desa Embacang Gedang, Kec. Muara Tabir" under a "Kec. Muara Tabir"
  // header: the header already says where, so the row drops the repeat. The
  // full wording stays searchable and in the accessible name.
  function underSection(label, section) {
    var kec = String(section || "").trim();
    if (!/^Kec\.\s/i.test(kec)) {
      return label;
    }
    var tail = ", " + kec;
    return label.length > tail.length && label.slice(-tail.length).toLowerCase() === tail.toLowerCase()
      ? label.slice(0, -tail.length)
      : label;
  }

  function itemClass(it) {
    return (
      (it.cadangan ? " is-cadangan" : "") +
      (it.duplikat ? " is-duplikat" : "") +
      (it.belum ? " is-belum" : "") +
      (it.active ? " is-active" : "")
    );
  }

  function collapseButton() {
    return (
      '<button class="mk-collapse" type="button" data-action="collapse" aria-label="Sembunyikan daftar" title="Sembunyikan daftar">' +
      icon("panelClose", 20) + "</button>"
    );
  }

  function fitButton() {
    return (
      '<button class="mk-fit" type="button" data-action="fit" title="Tampilkan semua titik di peta">' +
      icon("frame", 16) + "<span>Lihat semua</span></button>"
    );
  }

  function filterButtons(m, cls, asRadio) {
    var byFlag = {};
    m.filters.forEach(function (f) {
      byFlag[f.flag] = f;
    });
    return FLAG_ORDER.map(function (flag) {
      var f = byFlag[flag];
      if (!f) {
        return "";
      }
      var state = asRadio
        ? 'role="radio" aria-checked="' + f.active + '"'
        : 'aria-pressed="' + f.active + '"';
      var swatch = cls === "vb-pill" && flag
        ? '<span class="vb-pill__swatch vb-pill__swatch--' + flag + '" aria-hidden="true"></span>'
        : "";
      return (
        '<button class="' + cls + (flag ? " " + cls + "--" + flag : "") + '" type="button" data-action="filter" data-flag="' +
        flag + '" ' + state + ">" + swatch + FLAG_LABEL[flag] + " <b>" + fmt(f.count) + "</b></button>"
      );
    }).join("");
  }

  function loadingState() {
    var rows = "";
    for (var i = 0; i < 7; i++) {
      rows +=
        '<div class="mk-skel-row"><span class="mk-skel" style="width:' + (48 + ((i * 17) % 38)) +
        '%"></span><span class="mk-skel mk-skel--sub" style="width:' + (28 + ((i * 23) % 30)) + '%"></span></div>';
    }
    return '<div class="mk-loading" role="status" aria-label="Memuat data titik">' + rows + "</div>";
  }

  function stateList(m) {
    if (m.loading) {
      return loadingState();
    }
    if (m.error) {
      return (
        '<div class="mk-empty"><p>' + esc(m.error) +
        '</p><div class="mk-empty__actions"><button type="button" data-action="retry">Coba lagi</button></div></div>'
      );
    }
    if (m.empty) {
      var actions = "";
      if (m.screen === "detail" && m.query) {
        actions += '<button type="button" data-action="widen">Cari di semua titik</button>';
      }
      if (m.query) {
        actions += '<button type="button" data-action="clear-search">Hapus pencarian</button>';
      }
      return (
        '<div class="mk-empty"><p>' + esc(m.empty) + "</p>" +
        (actions ? '<div class="mk-empty__actions">' + actions + "</div>" : "") + "</div>"
      );
    }
    return null;
  }

  // ---------- geography for the atlas -------------------------------------

  function ringsOf(geometry) {
    var type = geometry.getType();
    if (type === "Polygon") {
      return geometry.getCoordinates();
    }
    if (type === "MultiPolygon") {
      return geometry.getCoordinates().reduce(function (all, poly) {
        return all.concat(poly);
      }, []);
    }
    return [];
  }

  function fitTransform(extent, w, h, pad, alignStart) {
    var ew = extent[2] - extent[0] || 1;
    var eh = extent[3] - extent[1] || 1;
    var s = Math.min((w - pad * 2) / ew, (h - pad * 2) / eh);
    var ox = alignStart ? pad : (w - ew * s) / 2;
    var oy = (h - eh * s) / 2;
    return function (c) {
      return [(c[0] - extent[0]) * s + ox, (extent[3] - c[1]) * s + oy];
    };
  }

  // Thin the outline to what the drawing can show: a vertex closer than
  // `step` px to the last one kept adds nothing at thumbnail size.
  function ringPath(rings, tx, step) {
    var d = "";
    rings.forEach(function (ring) {
      var seg = "";
      var last = null;
      var n = 0;
      for (var i = 0; i < ring.length; i++) {
        var p = tx(ring[i]);
        if (last && Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < step) {
          continue;
        }
        seg += (n ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
        last = p;
        n += 1;
      }
      if (n > 2) {
        d += seg + "Z";
      }
    });
    return d;
  }

  var DOT_ORDER = { sk: 0, belum: 1, duplikat: 2 };

  function buildGeo() {
    if (geo || !appWin || !appWin.lyr_BatasKabupaten_1 || !appWin.lyr_260331_4) {
      return;
    }
    var polys = {};
    var extent = null;
    appWin.lyr_BatasKabupaten_1.getSource().getFeatures().forEach(function (f) {
      var g = f.getGeometry();
      if (!g) {
        return;
      }
      polys[normKey(f.get("KABUPATEN_") || f.get("NAMOBJ"))] = f;
      var e = g.getExtent();
      extent = extent
        ? [Math.min(extent[0], e[0]), Math.min(extent[1], e[1]), Math.max(extent[2], e[2]), Math.max(extent[3], e[3])]
        : e.slice();
    });

    var points = {};
    var seen = new Set();
    var placed = 0;
    [appWin.lyr_260331_4, appWin.lyr_BelumDitetapkan_6, appWin.lyr_Cadangan_5].forEach(function (layer) {
      var source = layer && layer.getSource ? layer.getSource() : null;
      if (!source || !source.getFeatures) {
        return;
      }
      source.getFeatures().forEach(function (f) {
        if (seen.has(f)) {
          return;
        }
        seen.add(f);
        var kab = f.get("kabupaten");
        var g = f.getGeometry();
        var status = String(f.get("Status") || "").trim().toLowerCase();
        if (!kab || !g || status === "cadangan") {
          return;
        }
        var dup = f.get("Duplikat");
        var isDup = dup === true || /^(true|ya|1)$/i.test(String(dup || "").trim());
        var kind = status === "belum ditetapkan" ? "belum" : isDup ? "duplikat" : "sk";
        var e = g.getExtent();
        var key = normKey(kab);
        (points[key] = points[key] || []).push({ c: [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2], kind: kind });
        placed += 1;
      });
    });

    if (!extent || !placed) {
      return;
    }
    Object.keys(points).forEach(function (key) {
      points[key].sort(function (a, b) {
        return DOT_ORDER[a.kind] - DOT_ORDER[b.kind];
      });
    });
    geo = { polys: polys, points: points, extent: extent, cache: {} };
  }

  function shapeSvg(key, w, h, r) {
    if (!geo || !geo.polys[key]) {
      return "";
    }
    var geometry = geo.polys[key].getGeometry();
    // Left-aligned, so the outline starts on the same edge as the name.
    var tx = fitTransform(geometry.getExtent(), w, h, r + 1.5, true);
    var ck = "shape|" + key + "|" + w + "x" + h;
    var d = geo.cache[ck] || (geo.cache[ck] = ringPath(ringsOf(geometry), tx, 0.6));
    var dots = (geo.points[key] || [])
      .map(function (p) {
        var q = tx(p.c);
        return '<circle class="dot dot--' + p.kind + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + r + '"/>';
      })
      .join("");
    return (
      '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false"><path class="shape" fill-rule="evenodd" d="' +
      d + '"/>' + dots + "</svg>"
    );
  }

  function locatorSvg(activeKey, w, h) {
    if (!geo) {
      return "";
    }
    var tx = fitTransform(geo.extent, w, h, 2);
    var keys = Object.keys(geo.polys).sort(function (a, b) {
      return (a === activeKey) - (b === activeKey);
    });
    return (
      '<svg viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false">' +
      keys
        .map(function (k) {
          var ck = "loc|" + k + "|" + w + "x" + h;
          var d = geo.cache[ck] || (geo.cache[ck] = ringPath(ringsOf(geo.polys[k].getGeometry()), tx, 0.5));
          return '<path class="loc' + (k === activeKey ? " is-on" : "") + '" fill-rule="evenodd" d="' + d + '"/>';
        })
        .join("") +
      "</svg>"
    );
  }

  // ---------- point card -------------------------------------------------
  // popup.css restyles the live card per variant. The few pieces a variant
  // adds are built here as the card is written, inside the same call that
  // writes it, so the app measures the card with them in place and frames
  // the map around its real height. Each piece is tagged mk-only-a|b|c, so
  // switching variants needs no rebuild.

  var POPUP_CSS = "/.superpowers/mockups/sidebar/popup.css";
  // The right-hand map controls follow the variant too, on the same class.
  var CONTROLS_CSS = "/.superpowers/mockups/sidebar/controls.css";

  function insetSvg(key, here) {
    var w = 70;
    var h = 52;
    var geometry = geo.polys[key].getGeometry();
    var tx = fitTransform(geometry.getExtent(), w, h, 4);
    var ck = "inset|" + key;
    var d = geo.cache[ck] || (geo.cache[ck] = ringPath(ringsOf(geometry), tx, 0.5));
    var dots = (geo.points[key] || [])
      .map(function (p) {
        var q = tx(p.c);
        return '<circle class="mk-dot" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="1.3"/>';
      })
      .join("");
    var at = tx(here);
    var x = at[0].toFixed(1);
    var y = at[1].toFixed(1);
    return (
      '<svg viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false"><path class="mk-shape" fill-rule="evenodd" d="' + d + '"/>' +
      dots + '<circle class="mk-here-ring" cx="' + x + '" cy="' + y + '" r="6"/><circle class="mk-here" cx="' + x + '" cy="' + y + '" r="3.2"/></svg>'
    );
  }

  function metaField(rows, pattern) {
    for (var i = 0; i < rows.length; i++) {
      var dt = rows[i].querySelector("dt");
      if (dt && pattern.test(dt.textContent)) {
        return { row: rows[i], label: txt(dt), value: txt(rows[i].querySelector("dd")) };
      }
    }
    return null;
  }

  function unitStateClass(item) {
    return (
      (item.classList.contains("is-duplikat") ? " is-duplikat" : "") +
      (item.classList.contains("is-belum") ? " is-belum" : "") +
      (item.classList.contains("is-cadangan") ? " is-cadangan" : "")
    );
  }

  function decoratePopup(root) {
    var card = root.querySelector(".feature-popup");
    if (!card || card.hasAttribute("data-mk")) {
      return;
    }
    card.setAttribute("data-mk", "");
    var d = appDoc;
    var body = card.querySelector(".feature-popup__body");
    var title = card.querySelector(".feature-popup__title");
    var eyebrow = card.querySelector(".feature-popup__eyebrow");
    var meta = card.querySelector(".feature-popup__meta");
    var media = card.querySelector(".feature-popup__media");
    var rows = meta ? Array.prototype.slice.call(meta.querySelectorAll(".feature-popup__meta-row")) : [];
    var coord = metaField(rows, /^Koordinat/i);
    var date = metaField(rows, /^Dokumentasi/i);
    var active = d.querySelector("#list-data .item.is-active");
    var nomor = active ? active.getAttribute("title") || "" : "";
    if (!nomor && media && media.querySelector("img")) {
      nomor = media.querySelector("img").alt.replace(/^Foto lokasi\s+/i, "");
    }
    if (!body || !title) {
      return;
    }

    // A: the letterhead rule closes the title; the register opens with the
    // point's registry number, the ID the allocation sheet and photos use.
    var rule = d.createElement("div");
    rule.className = "mk-pop-rule mk-only-a";
    rule.setAttribute("aria-hidden", "true");
    title.insertAdjacentElement("afterend", rule);
    if (meta && nomor) {
      var nomorRow = d.createElement("div");
      nomorRow.className = "feature-popup__meta-row mk-pop-nomor mk-only-a";
      nomorRow.innerHTML = "<div><dt>Nomor</dt><dd>" + esc(nomor) + "</dd></div>";
      meta.insertBefore(nomorRow, meta.firstChild);
    }

    // B: where in the kabupaten this pole stands, inset on the photo.
    var kab = eyebrow ? (eyebrow.textContent.split("·")[1] || "").trim() : "";
    var key = normKey(kab);
    var ll = coord ? coord.value.split(/,\s*/).map(Number) : [];
    if (geo && geo.polys[key] && ll.length === 2 && isFinite(ll[0]) && isFinite(ll[1]) && appWin.ol) {
      var inset = d.createElement("span");
      inset.className = "mk-pop-inset mk-only-b" + (media ? "" : " mk-pop-inset--block");
      inset.innerHTML = insetSvg(key, appWin.ol.proj.fromLonLat([ll[1], ll[0]]));
      if (media) {
        media.appendChild(inset);
      } else {
        body.insertBefore(inset, body.firstChild);
      }
    }

    // B: the other units at the same spot, as the sidebar's tiles.
    if (active) {
      var label = txt(active.querySelector(".item-label"));
      var sub = txt(active.querySelector(".item-subline"));
      var siblings = Array.prototype.filter.call(d.querySelectorAll("#list-data .item"), function (item) {
        return txt(item.querySelector(".item-label")) === label && txt(item.querySelector(".item-subline")) === sub;
      });
      if (siblings.length > 1) {
        var units = d.createElement("div");
        units.className = "mk-pop-units mk-only-b";
        units.innerHTML =
          '<p class="mk-pop-units__label">' + fmt(siblings.length) + ' titik di lokasi ini</p><div class="mk-pop-units__row">' +
          siblings
            .map(function (item) {
              var code = txt(item.querySelector(".item-code"));
              var current = item === active;
              return (
                '<button type="button" class="mk-pop-unit' + unitStateClass(item) + '" data-item-id="' +
                esc(item.getAttribute("data-item-id")) + '"' + (current ? ' aria-current="true"' : "") +
                ' aria-label="Titik ' + esc(code) + (current ? ", sedang dibuka" : "") + '">' + esc(code) + "</button>"
              );
            })
            .join("") +
          "</div>";
        units.addEventListener("click", function (event) {
          var tile = event.target.closest(".mk-pop-unit");
          if (!tile || tile.getAttribute("aria-current") === "true") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          appClick(d.querySelector('#list-data .item[data-item-id="' + cssValue(tile.getAttribute("data-item-id")) + '"]'));
        });
        // After the route button: getting to this pole stays the first
        // thing the card offers; the neighbours are the next step.
        var anchor = card.querySelector(".feature-popup__actions") || meta || title;
        anchor.insertAdjacentElement("afterend", units);
      }
    }

    // C: coordinate and date as the band's figures.
    if (coord) {
      var figs = d.createElement("dl");
      figs.className = "mk-pop-figs mk-only-c";
      figs.innerHTML =
        "<div><dt>" + esc(coord.label) + "</dt><dd>" + esc(coord.value) + "</dd></div>" +
        (date ? "<div><dt>Dokumentasi</dt><dd>" + esc(date.value) + "</dd></div>" : "");
      title.insertAdjacentElement("afterend", figs);
      coord.row.classList.add("mk-fig-src");
      if (date) {
        date.row.classList.add("mk-fig-src");
      }
    }
  }

  function hookPopup() {
    var content = appDoc.getElementById("popup-content");
    var desc = Object.getOwnPropertyDescriptor(appWin.Element.prototype, "innerHTML");
    if (!content || !desc || !desc.set) {
      return;
    }
    Object.defineProperty(content, "innerHTML", {
      configurable: true,
      get: function () {
        return desc.get.call(this);
      },
      set: function (html) {
        desc.set.call(this, html);
        try {
          decoratePopup(this);
        } catch (err) {
          window.console.warn("mockup: kartu titik", err);
        }
      }
    });
    decoratePopup(content);
  }

  function syncPopupVariant(reframe) {
    if (!appDoc) {
      return;
    }
    var root = appDoc.documentElement.classList;
    ["a", "b", "c"].forEach(function (v) {
      root.toggle("mk-pop-" + v, v === variant);
    });
    // A variant changes the card's height; reopening the same point lets the
    // app frame the map around the new card.
    if (reframe && appDoc.body.classList.contains("is-popup-open")) {
      appClick(appDoc.querySelector("#list-data .item.is-active"));
    }
  }

  // ---------- map controls ------------------------------------------------
  // controls.css reshapes the right-hand controls per variant. C needs two
  // things CSS cannot draw: the navy rail behind the controls and a count
  // beside each legend entry, both tagged mk-only-c. The scale/attribution
  // block's size goes to CSS too, so A's Keterangan box can stack on it and
  // C's status bar can keep its entries clear of it.

  var LEGEND_KEYS = [
    [/belum/i, "belum"],
    [/verifikasi/i, "duplikat"],
    [/titik puts/i, "plain"]
  ];
  var legendObserved = false;
  var infoObserved = false;

  function decorateControls() {
    if (!appDoc || !appDoc.body) {
      return;
    }
    // The rail goes inside the map, just under the controls' own layer
    // (.ol-overlaycontainer-stopevent is a z-index:0 stacking context, so a
    // rail anywhere above it in the page would cover the controls).
    var stopEvent = appDoc.querySelector(".ol-overlaycontainer-stopevent");
    if (stopEvent && !appDoc.querySelector(".mk-rail")) {
      var rail = appDoc.createElement("div");
      rail.className = "mk-rail mk-only-c";
      rail.setAttribute("aria-hidden", "true");
      stopEvent.parentNode.insertBefore(rail, stopEvent);
    }

    var info = appDoc.querySelector(".map-meta__info");
    if (info && !infoObserved && appWin.ResizeObserver) {
      infoObserved = true;
      new appWin.ResizeObserver(function () {
        var box = info.getBoundingClientRect();
        var style = appDoc.documentElement.style;
        style.setProperty("--mk-info-h", Math.round(box.height) + "px");
        style.setProperty("--mk-info-w", Math.round(box.width) + "px");
      }).observe(info);
    }

    var legend = appDoc.querySelector(".map-legend");
    if (!legend) {
      return;
    }
    if (!legendObserved) {
      legendObserved = true;
      var Observer = appWin.MutationObserver || window.MutationObserver;
      new Observer(decorateControls).observe(legend, { childList: true, subtree: true });
    }
    var t = totals();
    var counts = { belum: t.belum, duplikat: t.duplikat, plain: t.count - t.belum - t.duplikat };
    Array.prototype.forEach.call(legend.querySelectorAll(".map-legend__item"), function (item) {
      var label = txt(item.querySelector(".map-legend__label--long"));
      var key = null;
      LEGEND_KEYS.some(function (pair) {
        if (pair[0].test(label)) {
          key = pair[1];
          return true;
        }
        return false;
      });
      var value = key && t.count ? fmt(counts[key]) : "";
      var badge = item.querySelector(".mk-legend-n");
      if (!value) {
        if (badge) {
          badge.remove();
        }
        return;
      }
      if (!badge) {
        badge = appDoc.createElement("b");
        badge.className = "mk-legend-n mk-only-c";
        item.appendChild(badge);
      }
      if (badge.textContent !== value) {
        badge.textContent = value;
      }
    });
  }

  // ---------- region highlight on the real map ----------------------------

  function holds(layer, target) {
    if (layer === target) {
      return true;
    }
    if (layer.getLayers) {
      return layer.getLayers().getArray().some(function (child) {
        return holds(child, target);
      });
    }
    return false;
  }

  function ensureHighlight() {
    if (hl) {
      return hl;
    }
    if (!appWin || !appWin.ol || !appWin.map) {
      return null;
    }
    var ol = appWin.ol;
    var source = new ol.source.Vector();
    var layer = new ol.layer.Vector({
      source: source,
      style: [
        new ol.style.Style({
          stroke: new ol.style.Stroke({ color: "rgba(14, 24, 34, 0.5)", width: 5.5 })
        }),
        new ol.style.Style({
          fill: new ol.style.Fill({ color: "rgba(254, 229, 15, 0.08)" }),
          stroke: new ol.style.Stroke({ color: "#fee50f", width: 2.5 })
        })
      ]
    });
    // Under the points, over the boundaries.
    var layers = appWin.map.getLayers();
    var arr = layers.getArray();
    var index = arr.length;
    for (var i = 0; i < arr.length; i++) {
      if (holds(arr[i], appWin.lyr_260331_4)) {
        index = i;
        break;
      }
    }
    layers.insertAt(index, layer);
    hl = { source: source, key: null };
    return hl;
  }

  function highlight(key) {
    if (!geo || !ensureHighlight() || hl.key === key) {
      return;
    }
    hl.key = key;
    hl.source.clear();
    var f = key && geo.polys[key];
    if (f) {
      hl.source.addFeature(new appWin.ol.Feature(f.getGeometry()));
    }
  }

  function setHover(key) {
    hoverKey = key;
    if (variant === "asli") {
      highlight(null);
      return;
    }
    var base = model && model.screen === "detail" ? normKey(model.group) : null;
    highlight(key || base);
  }

  // ---------- A · Kop Surat ------------------------------------------------

  var RENDER = {};

  RENDER.a = {
    placeholder: function (m) {
      return m.screen === "detail" ? "Cari dalam " + m.group + "…" : "Cari lokasi atau kabupaten…";
    },
    top: function (m) {
      var kop =
        '<div class="va-kop"><img src="' + LAMBANG + '" alt="Lambang Provinsi Jambi" width="44" height="45">' +
        '<div class="va-kop__text"><p class="va-kop__gov">Pemerintah Provinsi Jambi</p>' +
        '<p class="va-kop__dinas">Dinas Energi dan Sumber Daya Mineral</p></div>' +
        collapseButton() + '</div><div class="va-rule" aria-hidden="true"></div>';
      if (m.screen === "detail") {
        var g = findGroup(m.group);
        return (
          kop + '<div class="va-heading va-heading--detail">' +
          '<button class="va-back" type="button" data-action="back">' + icon("chevronLeft", 16) +
          "Semua kabupaten/kota</button><h1>" + esc(m.group) + "</h1>" +
          (g ? "<p>" + fmt(g.count) + " titik di " + fmt(g.kecamatan) + " kecamatan</p>" : "") + "</div>"
        );
      }
      return (
        kop + '<div class="va-heading"><h1>Peta Sebaran PUTS 2026</h1>' +
        '<div class="va-heading__row"><p>Penerangan Umum Tenaga Surya</p>' + fitButton() + "</div></div>"
      );
    },
    meta: function (m) {
      if (m.loading || m.error) {
        return "";
      }
      var out = "";
      if (m.screen === "detail" && m.filters.length) {
        out +=
          '<div class="va-filter" role="radiogroup" aria-label="Saring menurut status">' +
          filterButtons(m, "va-radio", true) + "</div>";
      }
      if (m.query || (m.screen === "detail" && activeFilter(m))) {
        out += '<p class="va-result" role="status">' + esc(cleanSummary(m.summary)) + "</p>";
      }
      return out;
    },
    list: function (m) {
      var state = stateList(m);
      if (state) {
        return state;
      }
      if (m.screen === "overview" && !m.query) {
        var t = totals();
        return (
          '<div class="va-table"><div class="va-thead" aria-hidden="true"><span>Kabupaten/Kota</span><span>Kec.</span><span>Titik</span><span></span></div>' +
          m.groups
            .map(function (g) {
              var flags = flagSpans(g);
              return (
                '<button class="va-row" type="button" data-action="open" data-group="' + esc(g.name) +
                '" data-key="' + esc(normKey(g.name)) + '" aria-label="' + esc(groupAria(g)) + '">' +
                '<span class="va-row__name">' + esc(shortName(g.name)) + "</span>" +
                '<span class="va-row__kec">' + fmt(g.kecamatan) + "</span>" +
                '<span class="va-row__count">' + fmt(g.count) + "</span>" +
                '<span class="va-row__go">' + icon("chevronRight", 16) + "</span>" +
                (flags ? '<span class="va-row__flags">' + flags + "</span>" : "") +
                "</button>"
              );
            })
            .join("") +
          '<div class="va-total"><span>Jumlah</span><span>' + fmt(t.kecamatan) + "</span><span>" +
          fmt(t.count) + "</span><span></span></div></div>"
        );
      }
      return (
        '<div class="va-table"><div class="va-thead va-thead--points" aria-hidden="true"><span>No.</span><span>Lokasi</span><span>Koordinat</span></div>' +
        m.sections
          .map(function (s) {
            return (
              (s.title
                ? '<div class="va-section" role="heading" aria-level="3">' + esc(s.title) + "<span>" + fmt(s.count) + " titik</span></div>"
                : "") +
              s.items
                .map(function (it) {
                  var c = it.coord.split(/,\s*/);
                  return (
                    '<button class="va-point' + itemClass(it) + '" type="button" data-action="point" data-id="' +
                    esc(it.id) + '" aria-label="' + esc(itemAria(it)) + '">' +
                    '<span class="va-point__no">' + esc(it.code) + "</span>" +
                    '<span class="va-point__body"><span class="va-point__title">' + esc(underSection(it.label, s.title)) + "</span>" +
                    (it.sub ? '<span class="va-point__sub">' + esc(it.sub) + "</span>" : "") +
                    itemFlagSpans(it) + "</span>" +
                    '<span class="va-point__coord">' +
                    (c.length === 2 ? esc(c[0]) + "<br>" + esc(c[1]) : esc(it.coord)) + "</span></button>"
                  );
                })
                .join("")
            );
          })
          .join("") +
        "</div>"
      );
    },
    foot: function (m) {
      return '<p class="va-foot">' + esc(sourceLine(m)) + "</p>";
    }
  };

  // ---------- B · Atlas Wilayah -------------------------------------------

  function desaGroups(items) {
    var out = [];
    var byKey = {};
    items.forEach(function (it) {
      var key = it.label + "\u0000" + it.sub;
      var group = byKey[key];
      if (!group) {
        group = byKey[key] = { label: it.label, sub: it.sub, items: [] };
        out.push(group);
      }
      group.items.push(it);
    });
    return out;
  }

  function plain(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b(desa|kel\.|kelurahan)\s+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function unitTitle(it) {
    return ["Titik " + it.code]
      .concat(itemFlags(it).map(function (f) { return f[1].toLowerCase(); }))
      .join(", ");
  }

  function legendB() {
    function dot(kind) {
      return (
        '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle class="dot dot--' + kind +
        '" cx="6" cy="6" r="4"/></svg>'
      );
    }
    return (
      '<div class="vb-key"><span class="vb-key__item">' + dot("sk") + "Titik PUTS</span>" +
      '<span class="vb-key__item">' + dot("duplikat") + "Perlu verifikasi</span>" +
      '<span class="vb-key__item">' + dot("belum") + "Belum ditetapkan</span></div>"
    );
  }

  RENDER.b = {
    placeholder: RENDER.a.placeholder,
    top: function (m) {
      if (m.screen === "detail") {
        var g = findGroup(m.group);
        return (
          '<div class="vb-detail"><div class="vb-detail__bar"><button class="vb-back" type="button" data-action="back">' +
          icon("chevronLeft", 16) + "Semua wilayah</button>" + collapseButton() + "</div>" +
          '<div class="vb-detail__main"><div><h1>' + esc(m.group) + "</h1>" +
          (g ? "<p><b>" + fmt(g.count) + "</b> titik di <b>" + fmt(g.kecamatan) + "</b> kecamatan</p>" : "") +
          '</div><div class="vb-locator" role="img" aria-label="Letak ' + esc(m.group) + ' di Provinsi Jambi">' +
          locatorSvg(normKey(m.group), 112, 84) + "</div></div></div>"
        );
      }
      return (
        '<div class="vb-head"><img src="' + LAMBANG + '" alt="Lambang Provinsi Jambi" width="38" height="39">' +
        '<div><p class="vb-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="vb-head__title">Sebaran PUTS 2026</h1></div>' +
        collapseButton() + "</div>"
      );
    },
    meta: function (m) {
      if (m.loading || m.error) {
        return "";
      }
      if (m.screen === "detail") {
        return (
          (m.filters.length
            ? '<div class="vb-pills" role="group" aria-label="Saring menurut status">' + filterButtons(m, "vb-pill") + "</div>"
            : "") +
          '<p class="vb-hint">' +
          (m.query || activeFilter(m) ? esc(cleanSummary(m.summary)) : "Pilih nomor titik untuk melihatnya di peta.") +
          "</p>"
        );
      }
      if (m.query) {
        return '<p class="vb-summary" role="status">' + esc(m.summary) + "</p>";
      }
      var t = totals();
      return (
        '<div class="vb-summary"><p><b>' + fmt(t.count) + "</b> titik di <b>" + fmt(t.groups) +
        "</b> kabupaten/kota</p>" + fitButton() + "</div>"
      );
    },
    list: function (m) {
      var state = stateList(m);
      if (state) {
        return state;
      }
      if (m.screen === "overview" && !m.query) {
        return (
          '<div class="vb-grid">' +
          m.groups
            .map(function (g) {
              var key = normKey(g.name);
              return (
                '<button class="vb-cell" type="button" data-action="open" data-group="' + esc(g.name) +
                '" data-key="' + esc(key) + '" aria-label="' + esc(groupAria(g)) + '">' +
                '<span class="vb-cell__shape">' + shapeSvg(key, 160, 54, 2) + "</span>" +
                '<span class="vb-cell__name">' + esc(shortName(g.name)) + "</span>" +
                '<span class="vb-cell__meta"><b>' + fmt(g.count) + "</b> titik di " + fmt(g.kecamatan) + " kecamatan</span>" +
                flagSpans(g) + "</button>"
              );
            })
            .join("") +
          "</div>" + legendB()
        );
      }
      return m.sections
        .map(function (s) {
          return (
            (s.title
              ? '<div class="vb-section" role="heading" aria-level="3">' + esc(s.title) + "<span>" + fmt(s.count) + " titik</span></div>"
              : "") +
            desaGroups(s.items)
              .map(function (grp) {
                var showSub = grp.sub && plain(grp.label).indexOf(plain(grp.sub)) === -1;
                return (
                  '<div class="vb-desa"><div class="vb-desa__head"><span class="vb-desa__title">' + esc(underSection(grp.label, s.title)) +
                  '</span><span class="vb-desa__count">' + fmt(grp.items.length) + " titik</span></div>" +
                  (showSub ? '<p class="vb-desa__sub">' + esc(grp.sub) + "</p>" : "") +
                  '<div class="vb-units">' +
                  grp.items
                    .map(function (it) {
                      return (
                        '<button class="vb-unit' + itemClass(it) + '" type="button" data-action="point" data-id="' + esc(it.id) +
                        '" aria-label="' + esc(itemAria(it)) + '" title="' + esc(unitTitle(it)) + '">' + esc(it.code) + "</button>"
                      );
                    })
                    .join("") +
                  "</div></div>"
                );
              })
              .join("")
          );
        })
        .join("");
    },
    foot: function (m) {
      return '<p class="vb-foot">' + esc(sourceLine(m)) + "</p>";
    }
  };

  // ---------- C · Dasbor Navy ---------------------------------------------

  RENDER.c = {
    placeholder: RENDER.a.placeholder,
    top: function (m) {
      var detail = m.screen === "detail";
      var g = detail ? findGroup(m.group) : null;
      var t = totals();
      var figures = [];
      if (detail && g) {
        figures = [[g.count, "titik"], [g.kecamatan, "kecamatan"], [g.duplikat, "perlu verifikasi", true]];
      } else if (!detail && t.count) {
        figures = [[t.count, "titik"], [t.groups, "kabupaten/kota"], [t.duplikat, "perlu verifikasi", true]];
      }
      var head = detail
        ? '<div class="vc-band__top vc-band__top--detail"><button class="vc-back" type="button" data-action="back">' +
          icon("chevronLeft", 16) + "Semua wilayah</button>" + collapseButton() + "</div>"
        : '<div class="vc-band__top"><img src="' + LAMBANG + '" alt="Lambang Provinsi Jambi" width="32" height="33">' +
          '<p class="vc-org">Dinas ESDM Provinsi Jambi</p>' + collapseButton() + "</div>";
      return (
        '<div class="vc-band">' + head +
        '<h1 class="vc-title">' + (detail ? esc(m.group) : "Sebaran PUTS 2026") + "</h1>" +
        (detail ? "" : '<p class="vc-sub">Penerangan Umum Tenaga Surya</p>') +
        (figures.length
          ? '<dl class="vc-figures">' +
            figures
              .map(function (f) {
                return '<div class="vc-fig' + (f[2] ? " vc-fig--warn" : "") + '"><dt>' + f[1] + "</dt><dd>" + fmt(f[0]) + "</dd></div>";
              })
              .join("") +
            "</dl>"
          : "") +
        '</div><div class="vc-lamp" aria-hidden="true"></div>'
      );
    },
    meta: function (m) {
      if (m.loading || m.error) {
        return "";
      }
      if (m.screen === "detail") {
        return (
          (m.filters.length
            ? '<div class="vc-filters" role="group" aria-label="Saring menurut status">' + filterButtons(m, "vc-pill") + "</div>"
            : "") +
          (m.query || activeFilter(m) ? '<p class="vc-result" role="status">' + esc(cleanSummary(m.summary)) + "</p>" : "")
        );
      }
      if (m.query) {
        return '<p class="vc-result" role="status">' + esc(m.summary) + "</p>";
      }
      return '<div class="vc-listhead"><h2>Titik per kabupaten/kota</h2>' + fitButton() + "</div>";
    },
    list: function (m) {
      var state = stateList(m);
      if (state) {
        return state;
      }
      if (m.screen === "overview" && !m.query) {
        var sorted = m.groups.slice().sort(function (a, b) {
          return b.count - a.count || a.name.localeCompare(b.name, "id");
        });
        var max = sorted.length ? sorted[0].count || 1 : 1;
        return (
          '<div class="vc-bars">' +
          sorted
            .map(function (g) {
              var dup = Math.min(g.duplikat, g.count);
              var bel = Math.min(g.belum, g.count - dup);
              var sk = g.count - dup - bel;
              var flags = flagSpans(g);
              return (
                '<button class="vc-row" type="button" data-action="open" data-group="' + esc(g.name) +
                '" data-key="' + esc(normKey(g.name)) + '" aria-label="' + esc(groupAria(g)) + '">' +
                '<span class="vc-row__name">' + esc(shortName(g.name)) + "</span>" +
                '<span class="vc-row__count">' + fmt(g.count) + "</span>" +
                '<span class="vc-row__go">' + icon("chevronRight", 16) + "</span>" +
                '<span class="vc-track" aria-hidden="true"><span class="vc-bar" style="--share:' + (g.count / max).toFixed(4) + '">' +
                '<i class="vc-bar__sk" style="flex:' + sk + '"></i>' +
                (dup ? '<i class="vc-bar__duplikat" style="flex:' + dup + '"></i>' : "") +
                (bel ? '<i class="vc-bar__belum" style="flex:' + bel + '"></i>' : "") +
                "</span></span>" +
                (flags ? '<span class="vc-row__flags">' + flags + "</span>" : "") +
                "</button>"
              );
            })
            .join("") +
          "</div>"
        );
      }
      var group = findGroup(m.group);
      var whole = group ? group.count : m.sections.reduce(function (sum, s) { return sum + s.count; }, 0);
      return m.sections
        .map(function (s) {
          return (
            (s.title
              ? '<div class="vc-section" role="heading" aria-level="3"><div class="vc-section__line">' + esc(s.title) +
                "<span>" + fmt(s.count) + ' titik</span></div><div class="vc-section__track" aria-hidden="true"><i style="--share:' +
                (whole ? Math.min(1, s.count / whole).toFixed(4) : 0) + '"></i></div></div>'
              : "") +
            s.items
              .map(function (it) {
                return (
                  '<button class="vc-pin-row' + itemClass(it) + '" type="button" data-action="point" data-id="' + esc(it.id) +
                  '" aria-label="' + esc(itemAria(it)) + '"><span class="vc-pin" aria-hidden="true">' + esc(it.code) + "</span>" +
                  '<span class="vc-pin-row__body"><span class="vc-pin-row__title">' + esc(underSection(it.label, s.title)) + "</span>" +
                  '<span class="vc-pin-row__sub">' + (it.sub ? "<span>" + esc(it.sub) + "</span>" : "") +
                  (it.coord ? "<span>" + esc(it.coord) + "</span>" : "") + "</span>" +
                  itemFlagSpans(it) + "</span></button>"
                );
              })
              .join("")
          );
        })
        .join("");
    },
    foot: function (m) {
      return '<p class="vc-foot">' + esc(sourceLine(m)) + "</p>";
    }
  };

  // ---------- rendering ----------------------------------------------------

  function focusKeyOf(el) {
    var action = el && el.getAttribute && el.getAttribute("data-action");
    if (!action) {
      return null;
    }
    var sel = '[data-action="' + action + '"]';
    ["data-flag", "data-id", "data-group"].forEach(function (attr) {
      if (el.hasAttribute(attr)) {
        sel += "[" + attr + '="' + cssValue(el.getAttribute(attr)) + '"]';
      }
    });
    return sel;
  }

  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    // A timer, not requestAnimationFrame: rAF stops in a background tab, and
    // the mockup should still be current when someone switches back to it.
    setTimeout(render, 0);
  }

  function render() {
    queued = false;
    if (variant === "asli") {
      return;
    }
    if (appDoc) {
      buildGeo();
      model = readModel();
      if (model.screen === "overview" && !model.query && model.groups.length) {
        groupsCache = model.groups;
      }
      decorateControls();
    } else {
      model = emptyModel();
    }
    if (model.screen === "overview" && !model.query && model.groups.length) {
      groupsCache = model.groups;
    }

    var R = RENDER[variant];
    var screen = variant + "|" + model.screen + "|" + model.group;
    var changed = screen !== lastScreen;
    var dir = changed && lastScreen.split("|")[0] === variant ? (model.screen === "detail" ? "fwd" : "back") : "";
    var queryChanged = model.query !== lastQuery;
    lastScreen = screen;
    lastQuery = model.query;

    var focused = document.activeElement;
    var focusKey = focused && focused !== searchInput && panel.contains(focused) ? focusKeyOf(focused) : null;
    var scroller = regions.list;
    var keep = changed || queryChanged ? 0 : scroller.scrollTop;

    ["top", "meta", "list", "foot"].forEach(function (name) {
      var html = R[name](model);
      if (rendered[name] !== html) {
        regions[name].innerHTML = html;
        rendered[name] = html;
      }
    });
    scroller.scrollTop = keep;

    var placeholder = R.placeholder(model);
    if (searchInput.placeholder !== placeholder) {
      searchInput.placeholder = placeholder;
    }
    if (document.activeElement !== searchInput && searchInput.value !== model.query) {
      searchInput.value = model.query;
    }
    searchClear.hidden = !searchInput.value;
    measurePeek();

    if (dir) {
      panel.removeAttribute("data-enter");
      void panel.offsetWidth;
      panel.setAttribute("data-enter", dir);
      clearTimeout(enterTimer);
      enterTimer = setTimeout(function () {
        panel.removeAttribute("data-enter");
      }, 320);
    }
    if (changed) {
      setHover(null);
    }

    var target = null;
    if (pendingFocus) {
      target = panel.querySelector(pendingFocus);
      if (target) {
        pendingFocus = null;
      }
    } else if (focusKey && !panel.contains(document.activeElement)) {
      target = panel.querySelector(focusKey);
    }
    if (target) {
      target.focus({ preventScroll: !changed });
    }

    if (boot && appDoc && model.screen === "overview" && model.groups.length) {
      var start = boot;
      boot = null;
      // ?sheet=1 opens the phone sheet, for links and screenshots.
      if (params.get("sheet")) {
        setSheetOpen(true);
      }
      if (start.open) {
        openGroup(start.open, start.filter);
      }
      if (start.q) {
        searchInput.value = start.q;
        pushQuery(start.q);
      }
    } else if (bootPoint && appDoc && model.screen === "detail") {
      // point=007, or point=003@Rengas when the code repeats across desa.
      var wanted = bootPoint.split("@");
      bootPoint = null;
      var hit = Array.prototype.filter.call(appDoc.querySelectorAll("#list-data .item"), function (item) {
        return (
          txt(item.querySelector(".item-code")) === wanted[0] &&
          (!wanted[1] || txt(item.querySelector(".item-label")).toLowerCase().indexOf(wanted[1].toLowerCase()) !== -1)
        );
      })[0];
      appClick(hit);
    }
  }

  // ---------- driving the real app ----------------------------------------

  function appClick(el) {
    if (el) {
      el.click();
    }
  }

  function openGroup(name, flag) {
    var rows = appDoc.querySelectorAll(".group-row");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-group-name") === name) {
        var hit = flag ? rows[i].querySelector(".group-row__flag--" + flag) : null;
        appClick(hit || rows[i]);
        return;
      }
    }
  }

  function setFilter(flag) {
    appClick(
      flag
        ? appDoc.querySelector(".status-chip--" + flag)
        : appDoc.querySelector(".status-chip:not([class*='status-chip--'])")
    );
  }

  function pushQuery(value) {
    var real = appDoc && appDoc.getElementById("list-search");
    if (!real) {
      return;
    }
    real.value = value;
    real.dispatchEvent(new appWin.Event("input", { bubbles: true }));
  }

  function clearSearch() {
    searchInput.value = "";
    searchClear.hidden = true;
    appClick(appDoc && appDoc.getElementById("list-search-clear"));
    searchInput.focus();
  }

  panel.addEventListener("click", function (event) {
    var el = event.target.closest("[data-action]");
    if (!el || !panel.contains(el) || !appDoc) {
      return;
    }
    var action = el.getAttribute("data-action");
    if (action === "open") {
      var shortcut = event.target.closest("[data-shortcut]");
      pendingFocus = '[data-action="back"]';
      openGroup(el.getAttribute("data-group"), shortcut ? shortcut.getAttribute("data-shortcut") : null);
    } else if (action === "back") {
      pendingFocus = '[data-action="open"][data-group="' + cssValue(model.group) + '"]';
      appClick(appDoc.querySelector(".panel-back"));
    } else if (action === "filter") {
      setFilter(el.getAttribute("data-flag"));
    } else if (action === "point") {
      appClick(appDoc.querySelector('.item[data-item-id="' + cssValue(el.getAttribute("data-id")) + '"]'));
    } else if (action === "fit") {
      appClick(appDoc.getElementById("fit-map"));
    } else if (action === "collapse") {
      setCollapsed(true);
    } else if (action === "clear-search") {
      clearSearch();
    } else if (action === "widen") {
      appClick(appDoc.querySelector(".empty-state .secondary-action"));
    } else if (action === "retry") {
      appClick(appDoc.querySelector(".data-error__action"));
    }
  });

  panel.addEventListener("mouseover", function (event) {
    var el = event.target.closest("[data-key]");
    var key = el && panel.contains(el) ? el.getAttribute("data-key") : null;
    if (key !== hoverKey) {
      setHover(key);
    }
  });

  panel.addEventListener("mouseleave", function () {
    setHover(null);
  });

  panel.addEventListener("focusin", function (event) {
    var el = event.target.closest("[data-key]");
    setHover(el ? el.getAttribute("data-key") : null);
  });

  searchInput.addEventListener("input", function () {
    searchClear.hidden = !searchInput.value;
    pushQuery(searchInput.value);
  });

  // ---------- phone sheet ------------------------------------------------

  function isMobile() {
    return body.classList.contains("is-mobile");
  }

  function setSheetOpen(next) {
    if (!appDoc || !isMobile()) {
      return;
    }
    if (appDoc.body.classList.contains("is-panel-open") !== next) {
      appClick(appDoc.getElementById("sheet-handle"));
    }
  }

  // Tap toggles; a drag of 40px or more decides by its direction.
  var dragStart = null;
  var dragged = false;

  grabber.addEventListener("pointerdown", function (event) {
    // A finger on the handle ends the site's call-outs at once, as live.
    if (appDoc) {
      appDoc.body.classList.remove("is-sheet-hinting", "is-sheet-nudging");
    }
    dragStart = event.clientY;
    dragged = false;
    grabber.setPointerCapture(event.pointerId);
  });

  grabber.addEventListener("pointermove", function (event) {
    if (dragStart !== null && Math.abs(event.clientY - dragStart) > 6) {
      dragged = true;
    }
  });

  grabber.addEventListener("pointerup", function (event) {
    if (dragStart === null) {
      return;
    }
    var dy = event.clientY - dragStart;
    dragStart = null;
    if (dragged && Math.abs(dy) >= 40) {
      setSheetOpen(dy < 0);
    }
  });

  grabber.addEventListener("click", function () {
    if (dragged) {
      dragged = false;
      return;
    }
    setSheetOpen(!body.classList.contains("is-sheet-open"));
  });

  // Typing needs the list in view.
  searchInput.addEventListener("focus", function () {
    setSheetOpen(true);
  });

  // The peek shows the sheet down to its search field; the site's map
  // controls sit on the same line, so it learns the height too.
  function measurePeek() {
    if (!isMobile() || !appDoc) {
      return;
    }
    var peek = Math.round(regions.search.offsetTop + regions.search.offsetHeight + 14);
    body.style.setProperty("--peek", peek + "px");
    appDoc.documentElement.style.setProperty("--sheet-peek", peek + "px");
  }

  searchInput.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && searchInput.value) {
      event.preventDefault();
      clearSearch();
    }
  });

  searchClear.addEventListener("click", clearSearch);

  // ---------- collapse, variants, viewport ---------------------------------

  function applyCollapsed(next) {
    body.classList.toggle("is-collapsed", next);
    expandBtn.hidden = !next || variant === "asli";
  }

  function setCollapsed(next) {
    if (!appDoc) {
      return;
    }
    if (appDoc.body.classList.contains("is-sidebar-collapsed") !== next) {
      appClick(appDoc.getElementById("panel-toggle"));
    }
    applyCollapsed(next);
    if (next) {
      expandBtn.focus();
    } else {
      var again = panel.querySelector('[data-action="collapse"]');
      if (again) {
        again.focus({ preventScroll: true });
      }
    }
  }

  expandBtn.addEventListener("click", function () {
    setCollapsed(false);
  });

  function syncApp() {
    if (!appDoc || !appDoc.body) {
      return;
    }
    var mock = variant !== "asli";
    appDoc.body.classList.toggle("mk-hide-sidebar", mock);
    var root = appDoc.documentElement.style;
    if (mock) {
      root.setProperty("--panel-width", WIDTH[variant] + "px");
    } else {
      root.removeProperty("--panel-width");
    }
    // The legend and the popup placement measure the panel on resize.
    appWin.dispatchEvent(new appWin.Event("resize"));
  }

  function setVariant(next) {
    if (ORDER.indexOf(next) === -1) {
      next = "a";
    }
    variant = next;
    body.setAttribute("data-variant", next);
    if (next !== "asli") {
      panel.className = "mk-panel v" + next;
      body.style.setProperty("--w", WIDTH[next] + "px");
    }
    Array.prototype.forEach.call(switcher.querySelectorAll("button[data-variant]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-variant") === next));
    });
    if (history.replaceState) {
      history.replaceState(null, "", "#" + next);
    }
    syncApp();
    syncPopupVariant(true);
    if (appDoc) {
      applyCollapsed(appDoc.body.classList.contains("is-sidebar-collapsed"));
    }
    rendered = {};
    lastScreen = "";
    if (next === "asli") {
      highlight(null);
    } else {
      render();
    }
  }

  // Below 1200px the stage keeps a 1280px desktop layout and scales down to
  // fit; the site inside never sees a phone-sized window.
  var STAGE_MIN = 1200;
  var STAGE_W = 1280;
  var noteTimer = null;

  // Under 760px the stage stops scaling: the site inside switches to its own
  // phone layout and every mockup becomes a bottom sheet over it.
  var MOBILE_MAX = 760;

  function layoutStage() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var mobile = vw < MOBILE_MAX;
    var scale = !mobile && vw < STAGE_MIN ? vw / STAGE_W : 1;
    var root = document.documentElement.style;
    root.setProperty("--stage-scale", String(scale));
    root.setProperty("--stage-w", (scale === 1 ? vw : STAGE_W) + "px");
    root.setProperty("--stage-h", (scale === 1 ? vh : vh / scale) + "px");
    if (mobile !== body.classList.contains("is-mobile")) {
      body.classList.toggle("is-mobile", mobile);
      rendered = {};
      schedule();
    }
    var scaled = scale < 1;
    if (scaled === narrow) {
      return;
    }
    narrow = scaled;
    narrowNote.hidden = !scaled;
    narrowNote.classList.remove("is-fading");
    clearTimeout(noteTimer);
    if (scaled) {
      noteTimer = setTimeout(function () {
        narrowNote.classList.add("is-fading");
        noteTimer = setTimeout(function () {
          narrowNote.hidden = true;
        }, 450);
      }, 6000);
    }
  }

  function onKey(event) {
    var t = event.target;
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    var i = ["1", "2", "3", "4"].indexOf(event.key);
    if (i !== -1) {
      setVariant(ORDER[i]);
    }
  }

  switcher.addEventListener("click", function (event) {
    var b = event.target.closest("button[data-variant]");
    if (b) {
      setVariant(b.getAttribute("data-variant"));
    }
  });

  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", layoutStage);

  function attach() {
    appWin = frame.contentWindow;
    appDoc = frame.contentDocument;
    if (!appDoc || !appDoc.body) {
      return;
    }
    var style = appDoc.createElement("style");
    style.textContent =
      // The phone masthead goes too: each mockup's sheet carries the
      // identity in its peek. Visibility only, so the popup still docks
      // where the site measures it.
      "body.mk-hide-sidebar #sidebar, body.mk-hide-sidebar #panel-toggle," +
      " body.mk-hide-sidebar .masthead { visibility: hidden !important; }";
    appDoc.head.appendChild(style);
    var popupStyle = appDoc.createElement("link");
    popupStyle.rel = "stylesheet";
    popupStyle.href = POPUP_CSS + "?v=" + Date.now();
    appDoc.head.appendChild(popupStyle);
    var controlsStyle = appDoc.createElement("link");
    controlsStyle.rel = "stylesheet";
    controlsStyle.href = CONTROLS_CSS + "?v=" + Date.now();
    appDoc.head.appendChild(controlsStyle);
    hookPopup();

    var Observer = appWin.MutationObserver || window.MutationObserver;
    var observer = new Observer(schedule);
    ["list-data", "list-summary"].forEach(function (id) {
      var el = appDoc.getElementById(id);
      if (el) {
        observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
      }
    });
    var header = appDoc.querySelector(".sidebar-header");
    if (header) {
      observer.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed"] });
    }
    var foot = appDoc.querySelector(".sidebar-footer");
    if (foot) {
      observer.observe(foot, { childList: true, subtree: true, characterData: true });
    }
    new Observer(function () {
      if (variant !== "asli") {
        applyCollapsed(appDoc.body.classList.contains("is-sidebar-collapsed"));
      }
      // The switcher steps aside while a point card is open: the card is
      // often placed right where the switcher sits.
      body.classList.toggle("has-popup", appDoc.body.classList.contains("is-popup-open"));
      // On phones the sheet follows the site's own open state, so picking a
      // point (which closes it) and the map's gestures behave as they do live.
      var open = appDoc.body.classList.contains("is-panel-open");
      body.classList.toggle("is-sheet-open", open);
      var hint = open ? "Kembali ke peta" : "Lihat daftar titik";
      grabber.setAttribute("aria-expanded", String(open));
      grabber.setAttribute("aria-label", hint);
      grabber.title = open
        ? "Ketuk atau geser ke bawah untuk lihat peta"
        : "Ketuk atau geser ke atas untuk lihat daftar";
      if (grabberText.textContent !== hint) {
        grabberText.textContent = hint;
      }
      // The site's own sheet cues (custom.js startSheetHints) run in the
      // frame on phones; the mockup sheet plays them on its own handle.
      body.classList.toggle("is-sheet-hinting", appDoc.body.classList.contains("is-sheet-hinting"));
      body.classList.toggle("is-sheet-nudging", appDoc.body.classList.contains("is-sheet-nudging"));
    }).observe(appDoc.body, { attributes: true, attributeFilter: ["class"] });

    appDoc.addEventListener("keydown", onKey);
    setVariant(variant);
    var early = appDoc.getElementById("mk-early");
    if (early) {
      early.remove();
    }
  }

  // The frame's load event waits for every map tile, which left the site's
  // own sheet and sidebar on screen for seconds under the mockup. Hide them
  // as soon as the frame has a document; attach() takes over from there.
  var earlyTimer = setInterval(function () {
    var doc = frame.contentDocument;
    if (!doc || !doc.head || doc.URL === "about:blank") {
      return;
    }
    clearInterval(earlyTimer);
    if (variant === "asli" || doc.getElementById("mk-early")) {
      return;
    }
    var early = doc.createElement("style");
    early.id = "mk-early";
    early.textContent = "#sidebar, #panel-toggle, .masthead { visibility: hidden !important; }";
    doc.head.appendChild(early);
  }, 30);

  frame.addEventListener("load", attach);
  layoutStage();
  setVariant(variant);
})();
