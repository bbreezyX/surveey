/* Shared plumbing for the three admin login/dashboard mockups.
   Mockup-only: the real admin lives on its own origin (see
   docs/superpowers/specs/2026-10-08-secure-online-admin-design.md), so in
   production the backdrop map would be the admin build's own OpenLayers
   instance, not an iframe of the public page. Here the iframe gives us the
   real basemap, boundaries and pins for free. */
(function () {
  "use strict";

  var HIDE_PUBLIC_CHROME =
    "#sidebar,.masthead,#panel-toggle,.map-legend,#popup," +
    ".ol-overlaycontainer-stopevent>*:not(.ol-attribution)" +
    "{display:none!important}";

  function backdrop(iframe) {
    return new Promise(function (resolve) {
      function ready() {
        var win = iframe.contentWindow;
        var doc = iframe.contentDocument;
        var style = doc.createElement("style");
        style.textContent = HIDE_PUBLIC_CHROME;
        doc.head.appendChild(style);
        var tries = 0;
        (function wait() {
          if (win.map && win.ol) return resolve({ map: win.map, ol: win.ol, win: win });
          if (++tries < 80) setTimeout(wait, 100);
        })();
      }
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete" &&
          iframe.contentWindow.location.href !== "about:blank") ready();
      else iframe.addEventListener("load", ready, { once: true });
    });
  }

  function kabupaten(nomor) {
    var k = String(nomor || "").split("-")[0].toLowerCase();
    return k.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function statusOf(p) {
    if (p.Status === "Cadangan") return "cadangan";
    if (p.Status === "Belum Ditetapkan") return "belum";
    if (p.Duplikat) return "duplikat";
    return "sk";
  }

  var STATUS_TEXT = {
    sk: "Alokasi utama",
    cadangan: "Cadangan",
    belum: "Belum ditetapkan",
    duplikat: "Perlu verifikasi"
  };

  function points() {
    return fetch("/data/points.geojson")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        return data.features.map(function (f, i) {
          var p = f.properties;
          return {
            id: i,
            props: p,
            nomor: p.Nomor,
            kab: kabupaten(p.Nomor),
            status: statusOf(p),
            lon: +p.Longitude || f.geometry.coordinates[0],
            lat: +p.Latitude || f.geometry.coordinates[1],
            photo: p["Foto Survey Awal"]
              ? "/images/" + encodeURIComponent(String(p["Foto Survey Awal"]).replace(/[\\/:]/g, "_").trim())
              : "",
            hay: [p.Nomor, p.Alamat, p["Lokasi Rekapan"], p["Nama Anggota"], p.Jalur]
              .join(" ").toLowerCase()
          };
        }).sort(function (a, b) {
          return a.kab.localeCompare(b.kab) || a.nomor.localeCompare(b.nomor);
        }).map(function (pt, i) { pt.id = i; return pt; });
      });
  }

  function counts(list) {
    var c = { official: 0, cadangan: 0, belum: 0, duplikat: 0 };
    list.forEach(function (pt) {
      if (pt.status === "cadangan") c.cadangan++;
      else {
        c.official++;
        if (pt.status === "belum") c.belum++;
        if (pt.props.Duplikat) c.duplikat++;
      }
    });
    return c;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  /* Renders the point list into `ul`, grouped by kabupaten. */
  function list(ul, all, opts) {
    var q = (opts.query || "").trim().toLowerCase();
    var rows = all.filter(function (pt) { return !q || pt.hay.indexOf(q) !== -1; });
    var html = "", last = "";
    rows.forEach(function (pt) {
      if (pt.kab !== last) {
        html += '<li class="group" role="presentation">' + esc(pt.kab) + "</li>";
        last = pt.kab;
      }
      html +=
        '<li><button type="button" class="row" data-id="' + pt.id + '"' +
        (opts.selected === pt.id ? ' aria-current="true"' : "") + ">" +
        '<span class="row-title">' + esc(pt.props["Lokasi Rekapan"] || pt.nomor) + "</span>" +
        '<span class="row-id">' + esc(pt.nomor) + "</span>" +
        (pt.status !== "sk"
          ? '<span class="badge badge--' + pt.status + '">' + STATUS_TEXT[pt.status] + "</span>"
          : "") +
        "</button></li>";
    });
    if (!rows.length) html = '<li class="empty">Tidak ada titik yang cocok. Coba nomor, desa, atau kecamatan lain.</li>';
    ul.innerHTML = html;
    var cur = opts.reveal && ul.querySelector("[aria-current]");
    if (cur) cur.scrollIntoView({ block: "center" });
  }

  /* Fills every [data-f] element under `root` from the point. */
  function fill(root, pt) {
    var p = pt.props;
    var values = {
      nomor: pt.nomor,
      rekapan: p["Lokasi Rekapan"] || "",
      alamat: p.Alamat || "",
      jalur: p.Jalur || "",
      pengusul: p["Nama Anggota"] || "",
      tanggal: p["Tanggal Dokumentasi"] || "",
      keterangan: p.Keterangan || "",
      catatan: p.Catatan || "",
      lat: pt.lat.toFixed(6),
      lon: pt.lon.toFixed(6),
      kab: pt.kab,
      status: p.Status || "",
      statustext: STATUS_TEXT[pt.status]
    };
    root.querySelectorAll("[data-f]").forEach(function (el) {
      var v = values[el.getAttribute("data-f")];
      if (el.type === "checkbox") el.checked = !!p.Duplikat;
      else if ("value" in el && el.tagName !== "BUTTON") el.value = v;
      else el.textContent = v;
    });
    root.querySelectorAll("img[data-photo]").forEach(function (img) {
      img.hidden = !pt.photo;
      if (pt.photo) img.src = pt.photo;
    });
  }

  /* Pans the backdrop map so lon/lat lands on the centre of `target`
     (an element in the parent page), or on the viewport centre. */
  function focus(bg, pt, target, zoom) {
    if (!bg) return;
    var ol = bg.ol, view = bg.map.getView();
    var coord = ol.proj.fromLonLat([pt.lon, pt.lat], view.getProjection());
    var size = bg.map.getSize();
    var px = size[0] / 2, py = size[1] / 2;
    if (target) {
      var r = target.getBoundingClientRect();
      px = r.left + r.width / 2;
      py = r.top + r.height / 2;
    }
    var z = zoom || 17;
    var res = view.getResolutionForZoom(z);
    var center = [coord[0] - (px - size[0] / 2) * res, coord[1] + (py - size[1] / 2) * res];
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    view.animate({ center: center, zoom: z, duration: reduce ? 0 : 900 });
  }

  /* Static satellite mosaic centred on the point: a cheap stand-in for the
     admin's own OpenLayers coordinate map in the windowed designs. */
  function tiles(el, pt, z) {
    z = z || 18;
    var w = el.clientWidth, h = el.clientHeight, n = 256 * Math.pow(2, z);
    var x = (pt.lon + 180) / 360 * n;
    var s = Math.sin(pt.lat * Math.PI / 180);
    var y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    var x0 = Math.floor((x - w / 2) / 256), x1 = Math.floor((x + w / 2) / 256);
    var y0 = Math.floor((y - h / 2) / 256), y1 = Math.floor((y + h / 2) / 256);
    var html = "";
    for (var tx = x0; tx <= x1; tx++) {
      for (var ty = y0; ty <= y1; ty++) {
        html += '<img alt="" draggable="false" style="position:absolute;width:256px;height:256px;left:' +
          Math.round(tx * 256 - x + w / 2) + "px;top:" + Math.round(ty * 256 - y + h / 2) +
          'px" src="https://mt1.google.com/vt/lyrs=s&x=' + tx + "&y=" + ty + "&z=" + z + '">';
      }
    }
    el.querySelector("[data-tiles]").innerHTML = html;
  }

  function overview(bg) {
    if (!bg) return;
    var view = bg.map.getView();
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    view.animate({
      center: bg.ol.proj.fromLonLat([102.85, -1.62], view.getProjection()),
      zoom: innerWidth < 700 ? 6.9 : 8,
      duration: reduce ? 0 : 900
    });
  }

  /* Login/logout state machine. CSS owns the motion; JS only flips
     data-state and keeps the login card's measured height in a variable,
     since `height: auto` can't be transitioned. */
  function session(opts) {
    var body = document.body;
    var login = document.querySelector("[data-login]");
    function measure() {
      if (body.dataset.state === "login") {
        body.style.setProperty("--login-h", login.scrollHeight + "px");
      }
    }
    measure();
    addEventListener("resize", measure);
    // Anything that measures the grown card (lens centre, minimap size) must
    // wait for the resize to finish, not guess with a timer.
    var shell = document.querySelector(".shell");
    shell.addEventListener("transitionend", function (e) {
      if (e.target === shell && e.propertyName === (opts.settleOn || "width") &&
          body.dataset.state === "dash" && opts.onSettled) opts.onSettled();
    });
    document.querySelector("[data-login-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var user = e.target.querySelector("[name=username]");
      var pass = e.target.querySelector("[name=password]");
      var err = e.target.querySelector("[data-error]");
      if (pass.value === "salah") {
        err.hidden = false;
        pass.focus();
        return;
      }
      err.hidden = true;
      body.dataset.state = "dash";
      body.dataset.user = user.value || "danny";
      if (opts.onEnter) opts.onEnter();
      // Reduced motion zeroes the transition, so no transitionend arrives.
      if (matchMedia("(prefers-reduced-motion: reduce)").matches && opts.onSettled) {
        requestAnimationFrame(opts.onSettled);
      }
    });
    document.querySelectorAll("[data-logout]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        body.dataset.state = "login";
        if (opts.onExit) opts.onExit();
        setTimeout(function () {
          document.querySelector("[name=password]").value = "";
          document.querySelector("[name=username]").focus();
        }, 450);
      });
    });
  }

  window.Mock = {
    backdrop: backdrop,
    points: points,
    counts: counts,
    list: list,
    fill: fill,
    focus: focus,
    tiles: tiles,
    overview: overview,
    session: session,
    STATUS_TEXT: STATUS_TEXT
  };
})();
