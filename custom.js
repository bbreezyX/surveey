(function () {
  function getNormalizedText(value) {
    return String(value || "").trim().toLowerCase();
  }

  // Surveyors paste GPS or Google Maps pairs. Accept "lat, lon" or "lon, lat"
  // (Jambi bujur is ~102, lintang ~-1.5) and comma, semicolon, or whitespace
  // as the separator. Decimal commas are left alone — a lone "3, 102" is a
  // pair, not the number 3.102.
  var COORD_PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

  function parseCoordinateQuery(value) {
    var match = String(value || "").trim().match(COORD_PAIR);
    if (!match) {
      return null;
    }
    var a = parseFloat(match[1]);
    var b = parseFloat(match[2]);
    if (!isFinite(a) || !isFinite(b)) {
      return null;
    }
    // Longitude in Jambi is 101–104; latitude sits between -3 and 0. If the
    // first number looks like a bujur, treat the pair as lon, lat.
    if (Math.abs(a) > 20 && Math.abs(b) <= 20) {
      return { lat: b, lon: a };
    }
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lon: b };
    }
    return null;
  }

  function decimalPlaces(n) {
    var text = String(Math.abs(n));
    var dot = text.indexOf(".");
    return dot === -1 ? 0 : text.length - dot - 1;
  }

  // Stamps and GeoJSON keep up to 6 decimals (~11 cm). Print that value
  // without rounding to 4 or 5 — the list used to show 102.1878 for a
  // photo that reads 102.187755.
  function formatCoordNumber(n) {
    var num = Number(n);
    if (!isFinite(num)) {
      return "";
    }
    return num.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatCoordPair(lat, lon) {
    var latitude = formatCoordNumber(lat);
    var longitude = formatCoordNumber(lon);
    if (!latitude || !longitude) {
      return "";
    }
    return latitude + ", " + longitude;
  }

  // Floor at ~17 m so a 7-decimal Google paste still hits a 4-decimal survey
  // row. Widen with the query's own precision so "-1.49, 102.46" covers the
  // neighbourhood instead of demanding an exact pin.
  function coordinateTolerance(n) {
    return Math.max(0.00015, Math.pow(10, -decimalPlaces(n)) * 0.51);
  }

  function coordinatesMatch(item, coord) {
    if (!coord || !isFinite(item.latNum) || !isFinite(item.lonNum)) {
      return false;
    }
    return (
      Math.abs(item.latNum - coord.lat) <= coordinateTolerance(coord.lat) &&
      Math.abs(item.lonNum - coord.lon) <= coordinateTolerance(coord.lon)
    );
  }

  function itemMatchesQuery(item, normalizedQuery, coordQuery) {
    if (!normalizedQuery) {
      return true;
    }
    if (coordQuery && coordinatesMatch(item, coordQuery)) {
      return true;
    }
    return item.searchText.indexOf(normalizedQuery) !== -1;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // A strict Roman numeral: "XXIV", "VII", "III". Strict so that ordinary
  // words spelled from the same letters ("Dili", "Lim") stay title-cased;
  // "di" is a valid numeral (501) but far likelier to be the preposition.
  var ROMAN_NUMERAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  var NOT_A_NUMERAL = { DI: true };

  // Title case for place names. Kecamatan and desa names carry Roman
  // numerals -- Batin XXIV, VII Koto, Lambur I, Simpang III Sipin -- which
  // plain title case turns into "Xxiv" and "Vii".
  function toDisplayCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      })
      .replace(/\b[IVXLCDMivxlcdm]{2,}\b/g, function (token) {
        var upper = token.toUpperCase();
        return ROMAN_NUMERAL.test(upper) && !NOT_A_NUMERAL[upper] ? upper : token;
      });
  }

  // Titles and degrees keyed by their letters alone, so a survey typing
  // "S.KOM", "s.kom" or "SKom" all land on one spelling. Mapping to a
  // canonical form rather than uppercasing the token is what keeps the dots
  // in "S.Kom" -- uppercasing turned it into "S.KOM".
  var NAME_SUFFIXES = {
    ir: "Ir.", drs: "Drs.", dra: "Dra.", hj: "Hj.",
    sh: "SH", se: "SE", st: "ST", sp: "SP", sipl: "S.IP",
    spd: "S.Pd", skom: "S.Kom", ssos: "S.Sos", shut: "S.Hut",
    spt: "S.Pt", sag: "S.Ag", spsi: "S.Psi", sfili: "S.Fil.I", amd: "A.Md",
    mm: "MM", mh: "MH", me: "ME", mt: "MT", map: "MAP", ey: "EY",
    msi: "M.Si", mpd: "M.Pd", mkes: "M.Kes", mkom: "M.Kom", msos: "M.Sos",
    // Office abbreviations inside a pengusul label, e.g. "GM Geopark
    // Merangin", "Ketua RT 21", "Amin ADC".
    gm: "GM", rt: "RT", adc: "ADC"
  };

  function toDisplayName(value) {
    return String(value || "")
      .trim()
      .split(/\s+/)
      .map(function (word) {
        // Peel off punctuation that trails the token -- but not the dots
        // inside it -- so "S.Kom," matches on "skom" and still gets its
        // separating comma back.
        var trailing = (word.match(/[^A-Za-z.]+$/) || [""])[0];
        var core = trailing ? word.slice(0, word.length - trailing.length) : word;
        var canonical = NAME_SUFFIXES[core.replace(/[^a-z]/gi, "").toLowerCase()];
        if (canonical) {
          return canonical + trailing;
        }
        return toDisplayCase(word);
      })
      .join(" ");
  }

  // Two pengusul values name an office instead of a person. Both resolve
  // unambiguously in the survey data -- every Bupati point falls in Kerinci,
  // and the Gubernur points span four kabupaten, i.e. the province -- so they
  // are spelled out rather than left as bare job titles. Revisit if a future
  // export adds Bupati points outside Kerinci.
  var PENGUSUL_ALIASES = {
    gubernur: "Gubernur Jambi",
    bupati: "Bupati Kerinci"
  };

  function toPengusulName(value) {
    var name = toDisplayName(value);
    return PENGUSUL_ALIASES[name.toLowerCase()] || name;
  }

  function sanitizeMediaPath(value) {
    return String(value || "").replace(/[\\/:]/g, "_").trim();
  }

  // Surplus survey rows stay in the geojson with their photos, tagged Status
  // "Cadangan". They stay in the list (quieter than an SK point) and out of
  // every official count. On the map they draw on their own layer, off by
  // default; the "Titik Cadangan" checkbox in the layer switcher shows them.
  function isCadangan(feature) {
    return (
      String(feature.get("Status") || "").trim().toLowerCase() === "cadangan"
    );
  }

  // Belum Ditetapkan: the allocation sheet grants a unit the survey never
  // placed (RT 21 Rengas Condong: 3 granted, 2 surveyed). The row still counts
  // toward the pengusul's quota, but it has no photo and its pin is only an
  // estimate dropped near its siblings, so the crew knows a unit is still to
  // be sited — with the RT — rather than reading the map as complete.
  function isBelumDitetapkan(feature) {
    return (
      String(feature.get("Status") || "").trim().toLowerCase() ===
      "belum ditetapkan"
    );
  }

  // Duplikat: the phone GPS did not move between two real units, so two rows
  // share one coordinate. Both still count — the flag only says the pin is
  // provisional until the crew confirms which pole is which on site.
  function isDuplikat(feature) {
    var v = feature.get("Duplikat");
    if (v === true) {
      return true;
    }
    var s = String(v || "").trim().toLowerCase();
    return s === "true" || s === "ya" || s === "1";
  }

  // What each status is called wherever a reader sees it. The geojson keeps
  // its field names ("Duplikat", Status "Belum Ditetapkan"); these are the
  // words for the installer and for other offices reading the map, phrased
  // as what to do about the pin rather than what is wrong with the data.
  // "Duplikat" read as a double entry to be deleted, so it is gone from the
  // screen: the same flag now says the coordinate needs checking on site.
  //   tag    — capsule on a list row and in the card kicker
  //   legend — map legend and the layer switcher
  //   short  — map legend on phones, where the row must stay one line
  //   count  — after a number on a pengusul row ("2 perlu verifikasi")
  //   search — extra words a query may use; the old name stays a synonym
  var STATUS_LABEL = {
    duplikat: {
      tag: "Perlu verifikasi",
      legend: "Koordinat perlu verifikasi",
      short: "Perlu verifikasi",
      count: "perlu verifikasi",
      search: "perlu verifikasi duplikat"
    },
    belum: {
      tag: "Lokasi belum ditetapkan",
      legend: "Lokasi belum ditetapkan",
      short: "Belum ditetapkan",
      count: "lokasi belum ditetapkan",
      search: "lokasi belum ditetapkan"
    },
    cadangan: {
      tag: "Cadangan",
      legend: "Cadangan",
      short: "Cadangan",
      count: "cadangan",
      search: "cadangan"
    }
  };

  // One short line on the card, above the address: what the installer does
  // with this pin. When the geojson carries a "Catatan" for the row, that text
  // wins: it names the specific reason (which other point shares the stamp,
  // why the survey recorded it that way) followed by what to do about it.
  // Otherwise the generic instruction below stands in.
  function statusNote(item) {
    if (item.catatan && (item.belum || item.duplikat)) {
      return item.catatan;
    }
    if (item.belum) {
      return "Pin perkiraan. Lokasi pasti ditentukan di lapangan bersama RT.";
    }
    if (item.duplikat) {
      var n = item.sharedCoordinateCount || 1;
      return n > 1
        ? n + " unit di satu koordinat. Cek posisi tiap tiang di lapangan."
        : "Cek posisi tiang di lapangan.";
    }
    if (item.cadangan) {
      return "Di luar jatah. Dipasang hanya jika ada titik lain yang batal.";
    }
    return "";
  }

  // The hatch control writes the geojson. That path only exists on the
  // local dev server; production is a static host and must not show it.
  function isLocalEditor() {
    var host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1";
  }

  function getCollator() {
    return new Intl.Collator("id", {
      numeric: true,
      sensitivity: "base",
    });
  }

  // Keterangan doubles as the row's title, but some rows carry survey
  // bookkeeping in brackets — "(Foto pertama yang dikirim pak agung)",
  // "(Tanpa Foto (Tempat Pemandian 1,2,3))". That says nothing about the place
  // and wraps the label onto five lines, so it goes. Brackets that qualify the
  // landmark itself are kept: "Depan Rumah Pak Hambali (Dewan)" survives.
  //
  // The lookahead only fires when the bracket's own text mentions the photo
  // workflow; everything from that bracket to the end is then dropped, which
  // also disposes of nested brackets in one pass.
  var SURVEY_NOTE = /\s*\((?=[^)]*(?:foto|dikirim))[\s\S]*$/i;

  // One Kerinci surveyor pasted their GPS app's log in wholesale — "Titik (1)
  // — Survey Pemasangan PJUTS; alamat GPS: Kemantan Darat; Jumat, 19 Juni 2026
  // 09:26; elevasi 812.1 m". Only the "alamat GPS" segment names a place; the
  // rest is a timestamp and an altimeter reading already covered by the
  // Dokumentasi and Koordinat rows. Logs without that segment name nothing at
  // all, so they collapse to "" and let the desa take the title.
  var GPS_LOG = /survey pemasangan|alamat gps:|elevasi\s/i;
  var GPS_ADDRESS = /alamat gps:\s*([^;]+)/i;
  // Some addresses lead with a plus code: "3922+RMF Desa Talang Tinggi".
  var PLUS_CODE = /^[a-z0-9]{4}\+[a-z0-9]{2,3}[\s,]*/i;

  // Spellings that reached the sheet as the surveyor typed them. Whole-word so
  // "Smp" becomes "SMP" without touching a name that merely contains it.
  var SPELLING_FIXES = [
    [/\bmadrash\b/gi, "Madrasah"],
    [/\balternatip\b/gi, "Alternatif"],
    [/\brmh\b/gi, "Rumah"],
    [/\bsmp\b/gi, "SMP"],
    [/\bJl\.(?=\S)/g, "Jl. "]
  ];

  function cleanKeterangan(value) {
    var text = String(value || "").replace(SURVEY_NOTE, "").trim();
    if (GPS_LOG.test(text)) {
      var address = text.match(GPS_ADDRESS);
      text = address ? address[1].trim().replace(PLUS_CODE, "") : "";
    }
    for (var i = 0; i < SPELLING_FIXES.length; i++) {
      text = text.replace(SPELLING_FIXES[i][0], SPELLING_FIXES[i][1]);
    }
    return text.replace(/\s{2,}/g, " ").trim();
  }

  // "RT 11" / "Rt.05" is an address detail, not a place: 54 rows carry one as
  // their entire Keterangan and ten collide on "RT 12" alone. It stays in the
  // Keterangan row — where it reads correctly — but the desa takes the title.
  var BARE_RT = /^rt[\s.]*\d+$/i;

  function isUsableTitle(text) {
    return Boolean(text) && !BARE_RT.test(text);
  }

  // Nomor is "KABUPATEN-KECAMATAN-DESA-NNN". The desa repeats across most of a
  // group's points (223/230 rows would be identical on desa alone), so the
  // survey landmark in Keterangan is the primary label whenever it exists and
  // the desa drops to context. Every row also carries its coordinate so a
  // unique landmark does not hide the pin's position.
  function buildDisplayParts(nomor, keterangan) {
    var parts = String(nomor || "")
      .split("-")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    var lastPart = parts[parts.length - 1] || "";
    var code = /^\d+$/.test(lastPart) ? lastPart : "";

    if (code) {
      parts.pop();
    }

    var desa = parts.length ? toDisplayCase(parts[parts.length - 1]) : "";
    var kecamatan = parts.length > 1 ? toDisplayCase(parts[parts.length - 2]) : "";
    var landmark = cleanKeterangan(keterangan);

    var primary;
    var secondary;

    if (isUsableTitle(landmark)) {
      primary = landmark;
      secondary = [desa, kecamatan].filter(Boolean).join(" · ");
    } else {
      primary = desa || String(nomor || "Titik");
      secondary = kecamatan;
    }

    return {
      code: code || "—",
      primary: primary,
      secondary: secondary || "Lokasi survey lapangan",
      // Kept separately so the list can section a long group by kecamatan.
      desa: desa,
      kecamatan: kecamatan,
    };
  }

  // Google Maps Directions URL (Maps URLs API, /maps/dir/?api=1). No origin
  // on purpose: Google Maps then starts the route from the device's current
  // position, which is exactly what an installer driving out to the pole
  // needs. Opens the Maps app on Android/iOS and the web map on desktop. No
  // travelmode either — the installer's own default (car, motorbike) wins.
  function buildDirectionsUrl(item) {
    if (!isFinite(item.latNum) || !isFinite(item.lonNum)) {
      return "";
    }
    var destination = item.latNum.toFixed(6) + "," + item.lonNum.toFixed(6);
    return (
      "https://www.google.com/maps/dir/?api=1&destination=" +
      encodeURIComponent(destination)
    );
  }

  var ROUTE_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
      '<path d="M21.4 2.6a1 1 0 0 0-1.06-.23L3.3 8.87a1 1 0 0 0 .06 1.88l6.86 2.29 2.29 6.86a1 1 0 0 0 .93.68h.03a1 1 0 0 0 .92-.62l6.5-17.04a1 1 0 0 0-.49-1.32z" fill="currentColor"/>' +
    "</svg>";

  function buildRouteAction(item) {
    var url = buildDirectionsUrl(item);
    if (!url) {
      return "";
    }
    return (
      '<div class="feature-popup__actions">' +
        '<a class="feature-popup__route" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer"' +
          ' title="Buka Google Maps: rute dari posisi Anda ke titik ini">' +
          ROUTE_ICON +
          "<span>Rute ke titik ini</span>" +
        "</a>" +
      "</div>"
    );
  }

  function buildPopupHtml(item) {
    var rows = [];
    var photoPath = item.photo ? sanitizeMediaPath(item.photo) : "";
    var photoUrl = photoPath ? escapeHtml("images/" + encodeURI(photoPath)) : "";

    var fieldIcons = {
      nama: '<i class="fas fa-user-check"></i>',
      jalur: '<i class="fas fa-sitemap"></i>',
      alamat: '<i class="fas fa-map-marker-alt"></i>',
      koordinat: '<i class="fas fa-crosshairs"></i>',
      tanggal: '<i class="fas fa-calendar-alt"></i>',
      keterangan: '<i class="fas fa-info-circle"></i>'
    };

    function metaRow(icon, label, value) {
      return (
        '<div class="feature-popup__meta-row">' +
          '<div class="meta-icon">' + icon + '</div>' +
          '<div><dt>' + label + '</dt><dd>' + escapeHtml(value) + '</dd></div>' +
        "</div>"
      );
    }

    // The pengusul row is intentionally omitted: this build hides who
    // proposed each point (see branch backup/tampil-pengusul for the
    // version that showed it).
    // The jalur row is omitted for the same reason as pengusul: the section
    // of the sheet (Ketua DPRD / Komisi III / Gubernur) hints at who
    // proposed the point.
    if (item.alamat) {
      rows.push(metaRow(fieldIcons.alamat, "Alamat", item.alamat));
    }
    if (item.koordinat) {
      // An unplaced unit's coordinate is a guess, and the label must say so
      // before anyone reads the digits as a survey fix.
      rows.push(
        metaRow(
          fieldIcons.koordinat,
          item.belum ? "Koordinat perkiraan" : "Koordinat",
          item.koordinat
        )
      );
    }
    if (item.tanggal) {
      rows.push(metaRow(fieldIcons.tanggal, "Dokumentasi", item.tanggal));
    }
    // The landmark is now the popup's own title, so repeating it as a meta row
    // would just say the same thing twice.
    if (item.keterangan && item.keterangan !== item.display.primary) {
      rows.push(metaRow(fieldIcons.keterangan, "Keterangan", item.keterangan));
    }

    var kicker =
      "Titik " + escapeHtml(item.display.code) +
      (item.kabupaten ? " · " + escapeHtml(item.kabupaten) : "");
    // No status word in the kicker: each status has its note under the photo,
    // and the disc before the kicker already wears that status's ring.

    var popupClass = "feature-popup";
    if (item.cadangan) {
      popupClass += " is-cadangan";
    }
    if (item.duplikat) {
      popupClass += " is-duplikat";
    }
    if (item.belum) {
      popupClass += " is-belum";
    }

    // Every status gets its reason in plain words: what the installer has to
    // read before the address and the coordinate. An unplaced unit has no
    // photo, so the note takes the photo's place at the top; the others sit
    // between the photo and the title. The mark echoes the pin: "?" for a
    // spot nobody has chosen, "!" for a coordinate to check, hatch for reserve.
    var noteKind = item.belum
      ? "belum"
      : item.duplikat
        ? "duplikat"
        : item.cadangan
          ? "cadangan"
          : "";
    var noteText = statusNote(item);
    var noteMark = { belum: "?", duplikat: "!", cadangan: "" }[noteKind];
    var note = noteKind && noteText
      ? '<div class="feature-popup__note feature-popup__note--' + noteKind + '" role="note">' +
          '<span class="feature-popup__note-mark" aria-hidden="true">' + noteMark + "</span>" +
          "<p>" +
            '<strong class="feature-popup__note-title">' +
              escapeHtml(STATUS_LABEL[noteKind].legend) +
            "</strong> " +
            escapeHtml(noteText) +
          "</p>" +
        "</div>"
      : "";

    return (
      '<div class="' + popupClass + '">' +
      // No loading="lazy" here: the card is only built at the moment it opens,
      // so the photo is always already in view and lazy only defers the fetch
      // behind a visibility check it is guaranteed to pass. decoding="async"
      // does the useful work instead — source photos run to 1600x1200 and the
      // slot is 312px wide, so a synchronous decode would stall the frame.
      (photoPath
        ? '<a class="feature-popup__media" href="' + photoUrl + '" target="_blank" rel="noopener" aria-label="Buka foto lokasi ' + escapeHtml(item.nomor) + ' di tab baru">' +
          '<img src="' + photoUrl + '" alt="Foto lokasi ' + escapeHtml(item.nomor) + '" decoding="async" />' +
          '<span class="feature-popup__media-badge">Buka foto ↗</span>' +
          "</a>"
        : "") +
      note +
      '<div class="feature-popup__body">' +
      '<p class="feature-popup__eyebrow">' + kicker + "</p>" +
      '<h3 class="feature-popup__title">' + escapeHtml(item.display.primary) + "</h3>" +
      (rows.length ? '<dl class="feature-popup__meta">' + rows.join("") + "</dl>" : "") +
      '<div class="feature-popup__rule"></div>' +
      // No route to an estimate: a directions link would send the crew to a
      // spot nobody surveyed and make the guess look like a destination.
      (item.belum ? "" : buildRouteAction(item)) +
      "</div>" +
      "</div>"
    );
  }

  function hidePopup() {
    var popup = document.getElementById("popup");
    var popupContent = document.getElementById("popup-content");

    if (popup) {
      popup.style.display = "none";
    }
    document.body.classList.remove("is-popup-open");
    if (popupContent) {
      popupContent.innerHTML = "";
    }
    if (window.overlayPopup && typeof window.overlayPopup.setPosition === "function") {
      window.overlayPopup.setPosition(undefined);
    }
    if (typeof window.stopMediaInPopup === "function") {
      window.stopMediaInPopup();
    }
  }

  function setTextContent(id, value) {
    var node = document.getElementById(id);
    if (node) {
      node.textContent = value;
    }
  }

  function setDataControlsDisabled(isDisabled) {
    ["list-search", "fit-map", "atlas-region", "atlas-fit", "atlas-home"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) {
        node.disabled = isDisabled;
      }
    });
    // The grouping tabs only get their listeners inside init(), so before data
    // lands they are decoration — disable them too rather than leave dead
    // controls that look live.
    document.querySelectorAll(".group-mode__btn").forEach(function (node) {
      node.disabled = isDisabled;
    });
    document.body.classList.toggle("is-data-unavailable", isDisabled);
  }

  // Counts are unknown until the data lands. "0" is a claim; this is not.
  function setCountsUnknown() {
    setTextContent("list-summary", "Data titik belum tersedia");
    var overview = document.getElementById("atlas-overview");
    if (overview) {
      overview.innerHTML = '<div class="atlas-card-heading"><h2>Data belum tersedia</h2></div><p class="atlas-description">Buka daftar titik untuk memeriksa pemuatan data.</p>';
    }
  }

  function showDataLoading() {
    var listContainer = document.getElementById("list-data");

    setCountsUnknown();
    setDataControlsDisabled(true);
    setTextContent("atlas-overview", "Memuat data sebaran PJUTS…");

    if (!listContainer) {
      return;
    }

    var wrap = document.createElement("div");
    wrap.className = "data-loading";

    var note = document.createElement("p");
    note.className = "data-loading__note";
    note.textContent = "Memuat titik survey…";
    wrap.appendChild(note);

    // Skeleton rows mirror the real row shape so nothing jumps when they are
    // replaced by data.
    for (var i = 0; i < 6; i++) {
      var row = document.createElement("div");
      row.className = "skeleton-row";
      var code = document.createElement("span");
      code.className = "skeleton skeleton--code";
      var copy = document.createElement("span");
      copy.className = "skeleton-row__copy";
      var label = document.createElement("span");
      label.className = "skeleton skeleton--label";
      var sub = document.createElement("span");
      sub.className = "skeleton skeleton--sub";
      copy.appendChild(label);
      copy.appendChild(sub);
      row.appendChild(code);
      row.appendChild(copy);
      wrap.appendChild(row);
    }

    listContainer.replaceChildren(wrap);
  }

  function showDataLoadError(message, onRetry) {
    var listContainer = document.getElementById("list-data");

    setCountsUnknown();
    setDataControlsDisabled(true);
    hidePopup();
    // A failed load must expose its retry action even before init() binds
    // navigation, since the desktop atlas normally starts with the list closed.
    document.body.classList.remove("is-sidebar-collapsed");
    var failedSidebar = document.getElementById("sidebar");
    if (failedSidebar) failedSidebar.inert = false;
    if (isMobileViewport()) setPanelOpen(true);

    if (!listContainer) {
      return;
    }

    var errorNode = document.createElement("div");
    var title = document.createElement("p");
    var copy = document.createElement("p");
    var action = document.createElement("button");

    errorNode.className = "data-error";
    errorNode.setAttribute("role", "alert");

    title.className = "data-error__title";
    title.textContent = "Data titik belum bisa dimuat";

    copy.className = "data-error__copy";
    copy.textContent = message ||
      "Periksa koneksi dan file data/points.geojson, lalu coba lagi.";

    action.type = "button";
    action.className = "secondary-action data-error__action";
    action.textContent = onRetry ? "Coba lagi" : "Muat ulang halaman";
    action.addEventListener("click", function () {
      if (onRetry) {
        onRetry();
      } else {
        window.location.reload();
      }
    });

    errorNode.appendChild(title);
    errorNode.appendChild(copy);
    errorNode.appendChild(action);
    listContainer.replaceChildren(errorNode);
  }

  function isMobileViewport() {
    return window.innerWidth < 960;
  }

  function setPanelOpen(isOpen) {
    if (isOpen && window.layerSwitcher) window.layerSwitcher.hidePanel();
    if (isOpen && isMobileViewport()) {
      hidePopup();
    }
    document.body.classList.toggle("is-panel-open", isOpen);
    var toggle = document.getElementById("panel-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isMobileViewport()) toggle.setAttribute("aria-label", isOpen ? "Tutup daftar titik" : "Buka daftar titik");
    }
    var listPane = document.querySelector(".sidebar-scroll");
    if (listPane) listPane.inert = isMobileViewport() && !isOpen;
    if (isMobileViewport()) document.getElementById("atlas-home").classList.toggle("is-active", !isOpen);
    var handle = document.getElementById("sheet-handle");
    if (handle) {
      handle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      handle.title = isOpen
        ? "Ketuk atau geser ke bawah untuk lihat peta"
        : "Ketuk atau geser ke atas untuk lihat daftar";
      var hintText = handle.querySelector(".sheet-handle__text");
      if (hintText) {
        hintText.textContent = isOpen
          ? SHEET_HINT_CLOSE
          : SHEET_HINT_OPEN;
      }
    }
    if (isOpen) {
      // The reader has found the sheet; the nudges have done their job.
      stopSheetHints();
    }
  }

  // Short action labels stay readable even on a 320px phone; the title
  // keeps the alternative drag gesture available as a hint.
  var SHEET_HINT_OPEN = "Lihat daftar titik";
  var SHEET_HINT_CLOSE = "Kembali ke peta";

  var SHEET_NUDGE_KEY = "puts.sheetNudges";
  var SHEET_NUDGE_VISITS = 3;
  var sheetHintTimer = null;

  function readNudgeCount() {
    try {
      return parseInt(window.localStorage.getItem(SHEET_NUDGE_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function bumpNudgeCount() {
    try {
      window.localStorage.setItem(SHEET_NUDGE_KEY, String(readNudgeCount() + 1));
    } catch (e) {
      // Private mode / storage disabled: the nudge simply plays every visit.
    }
  }

  function stopSheetHints() {
    document.body.classList.remove("is-sheet-hinting", "is-sheet-nudging");
    if (sheetHintTimer) {
      clearTimeout(sheetHintTimer);
      sheetHintTimer = null;
    }
  }

  // Two cues for readers who do not know a bottom sheet can be pulled up:
  // the chevron on the handle bobs until the sheet is first touched (or 12s),
  // and on the first few visits the whole sheet lifts once and settles —
  // the gesture, demonstrated. Reduced-motion readers get the words only.
  function startSheetHints() {
    if (!isMobileViewport()) {
      return;
    }
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      return;
    }
    if (document.body.classList.contains("is-panel-open")) {
      return;
    }
    document.body.classList.add("is-sheet-hinting");
    sheetHintTimer = setTimeout(function () {
      document.body.classList.remove("is-sheet-hinting");
    }, 12000);

    if (readNudgeCount() >= SHEET_NUDGE_VISITS) {
      return;
    }
    var sheet = document.getElementById("sidebar");
    if (!sheet) {
      return;
    }
    var onEnd = function (event) {
      if (event.target !== sheet) {
        return;
      }
      sheet.removeEventListener("animationend", onEnd);
      document.body.classList.remove("is-sheet-nudging");
    };
    sheet.addEventListener("animationend", onEnd);
    // Belt and braces: if the class outlived the keyframes (a popup opening
    // mid-lift suppresses the animation and its end event), a later popup
    // close would replay the lift. 1.6s keyframes; clear at 2s regardless.
    setTimeout(function () {
      document.body.classList.remove("is-sheet-nudging");
    }, 2000);
    bumpNudgeCount();
    document.body.classList.add("is-sheet-nudging");
  }

  function configurePopupOverlayForViewport() {
    if (!window.overlayPopup) {
      return;
    }
    // Mobile popup is position:fixed and we pan manually — OL autoPan fights
    // that animation and makes the bottom sheet feel stuck.
    window.overlayPopup.autoPan = isMobileViewport()
      ? false
      : { animation: { duration: 300 }, margin: 60 };
  }

  // ---------- Map control chrome ----------

  // Native title tooltips are slow, unstyleable, and would sit next to ours.
  // The layer switcher re-adds its own on every panel toggle
  // (ol-layerswitcher.js:203,208), so strip on the way in, not once at setup.
  function stripNativeTitle(node) {
    node.removeAttribute("title");
    node.addEventListener("pointerenter", function () {
      if (node.hasAttribute("title")) {
        node.removeAttribute("title");
      }
    });
  }

  // "Alive when the cursor heads over there." A CSS-only version means
  // widening a pseudo-element to catch the pointer early, which also steals
  // pan and drag from the map inside that band — and 14px of reach would not
  // read as approach anyway. 90px does.
  function initControlProximity(targets) {
    if (!targets.length || !window.matchMedia) {
      return;
    }
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }

    var NEAR = 90;
    var rects = [];
    var stale = true;
    var queued = false;
    var pointerX = 0;
    var pointerY = 0;

    function apply() {
      queued = false;
      // Cached, because measuring on every frame forces a layout flush on
      // top of whatever the map is already painting.
      if (stale) {
        rects = targets.map(function (node) {
          return node.getBoundingClientRect();
        });
        stale = false;
      }
      for (var i = 0; i < targets.length; i++) {
        var rect = rects[i];
        if (!rect || !rect.width) {
          continue;
        }
        var dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
        var dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
        targets[i].classList.toggle("is-near", dx * dx + dy * dy <= NEAR * NEAR);
      }
    }

    function invalidate() {
      stale = true;
    }

    window.addEventListener(
      "pointermove",
      function (event) {
        if (event.pointerType && event.pointerType !== "mouse") {
          return;
        }
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (queued) {
          return;
        }
        queued = true;
        requestAnimationFrame(apply);
      },
      { passive: true }
    );

    // The controls only move on resize and when the sidebar collapse
    // animation repositions the panel toggle.
    window.addEventListener("resize", invalidate);
    targets.forEach(function (node) {
      node.addEventListener("transitionend", invalidate);
    });

    document.addEventListener("pointerleave", function () {
      targets.forEach(function (node) {
        node.classList.remove("is-near");
      });
    });
  }

  // Material-style press ripple. `trigger` takes the pointerdown; `host` is
  // where the clipped wave is drawn.
  // Pointer only: a keyboard press has no point to ripple from, and :active
  // still gives it the sink-and-spring.
  function initPressRipple(trigger, host) {
    var layer = document.createElement("span");
    layer.className = "ctl-ripple";
    layer.setAttribute("aria-hidden", "true");
    host.insertBefore(layer, host.firstChild);

    trigger.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }
      var rect = layer.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var y = event.clientY - rect.top;
      // Big enough to reach the farthest corner from wherever the press
      // landed, so an off-centre tap still floods the whole shape.
      var reach = Math.max(x, rect.width - x);
      var drop = Math.max(y, rect.height - y);
      var size = Math.ceil(Math.sqrt(reach * reach + drop * drop) * 2);

      var wave = document.createElement("span");
      wave.className = "ctl-ripple__wave";
      wave.style.width = size + "px";
      wave.style.height = size + "px";
      wave.style.left = x - size / 2 + "px";
      wave.style.top = y - size / 2 + "px";

      var done = false;
      function remove() {
        if (done) {
          return;
        }
        done = true;
        if (wave.parentNode) {
          wave.parentNode.removeChild(wave);
        }
      }
      wave.addEventListener("animationend", remove);
      // Reduced-motion sets animation:none, so animationend never fires.
      setTimeout(remove, 700);
      layer.appendChild(wave);
    });
  }

  // The zoom rail dips as one object when either half is pressed. CSS alone
  // cannot reach the parent from a child's :active without :has(), which the
  // older devices this audience carries do not all have yet.
  function initPressedRail(rail) {
    function release() {
      rail.classList.remove("is-pressed");
    }
    rail.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }
      rail.classList.add("is-pressed");
    });
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    rail.addEventListener("pointerleave", release);
  }

  // A custom select with a body-level menu: never clipped by the map canvas or
  // the rounded application frame. Native selects retain the filter state.
  var atlasSelects = [];

  function closeAtlasSelects(except) {
    atlasSelects.forEach(function (control) {
      if (control !== except) control.close();
    });
  }

  function syncAtlasSelect(select) {
    if (select && select.atlasControl) select.atlasControl.sync();
  }

  function enhanceAtlasSelect(select) {
    var host = select.parentElement;
    var label = host.querySelector('span').textContent;
    var trigger = document.createElement('button');
    var menu = document.createElement('div');
    var valueNode = document.createElement('span');
    var caption = document.createElement('span');
    trigger.type = 'button';
    trigger.className = 'atlas-select__trigger';
    trigger.id = select.id + '-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', select.id + '-menu');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
    caption.className = 'atlas-select__caption';
    caption.textContent = label;
    valueNode.className = 'atlas-select__value';
    trigger.append(caption, valueNode);
    var chevron = document.createElement('span');
    chevron.className = 'atlas-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.appendChild(chevron);
    menu.id = select.id + '-menu';
    menu.className = 'atlas-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label);
    menu.hidden = true;
    document.body.appendChild(menu);
    host.appendChild(trigger);
    host.classList.add('is-enhanced');
    select.hidden = true;
    var active = 0;
    var typed = '';
    var lastTyped = 0;

    function position() {
      var rect = trigger.getBoundingClientRect();
      var width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      var below = window.innerHeight - rect.bottom - 20;
      var above = rect.top - 20;
      var upward = below < 180 && above > below;
      menu.style.width = width + 'px';
      menu.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px';
      menu.style.maxHeight = Math.max(60, Math.min(390, upward ? above : below)) + 'px';
      menu.style.top = upward ? 'auto' : rect.bottom + 8 + 'px';
      menu.style.bottom = upward ? window.innerHeight - rect.top + 8 + 'px' : 'auto';
    }
    function highlight(index) {
      active = Math.max(0, Math.min(select.options.length - 1, index));
      Array.from(menu.children).forEach(function (option, i) {
        option.classList.toggle('is-focused', i === active);
      });
      var option = menu.children[active];
      if (option) {
        trigger.setAttribute('aria-activedescendant', option.id);
        if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
          menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
        }
      }
    }
    function sync() {
      trigger.disabled = select.disabled;
      var selected = select.options[select.selectedIndex];
      valueNode.textContent = selected ? selected.textContent : 'Memuat wilayah…';
      menu.replaceChildren();
      Array.from(select.options).forEach(function (option, index) {
        var row = document.createElement('div');
        row.className = 'atlas-select-option';
        row.id = select.id + '-option-' + index;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected));
        row.setAttribute('aria-label', option.textContent);
        var copy = document.createElement('span');
        var name = document.createElement('span');
        name.textContent = option.textContent;
        copy.appendChild(name);
        row.appendChild(copy);
        if (option.dataset.count) {
          var count = document.createElement('small');
          count.className = 'atlas-select-option__count';
          count.textContent = option.dataset.count + ' titik';
          row.appendChild(count);
        }
        var check = document.createElement('span');
        check.className = 'atlas-select-option__check';
        check.setAttribute('aria-hidden', 'true');
        row.appendChild(check);
        row.addEventListener('click', function () { choose(index); });
        menu.appendChild(row);
      });
      if (!menu.hidden) highlight(Math.max(0, select.selectedIndex));
    }
    function close() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
    }
    function open() {
      if (select.disabled) return;
      closeAtlasSelects(control);
      if (window.layerSwitcher) window.layerSwitcher.hidePanel();
      sync();
      position();
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      highlight(Math.max(0, select.selectedIndex));
    }
    function choose(index) {
      if (!select.options[index] || select.options[index].disabled) return;
      select.selectedIndex = index;
      close();
      select.dispatchEvent(new Event('change', {bubbles: true}));
      sync();
      trigger.focus({preventScroll: true});
    }
    var control = {close: close, sync: sync};
    select.atlasControl = control;
    atlasSelects.push(control);
    trigger.addEventListener('click', function () { if (menu.hidden) open(); else close(); });
    trigger.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'Tab') { close(); return; }
      if (key === 'Escape' && !menu.hidden) {
        event.preventDefault(); event.stopPropagation(); close(); return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
        event.preventDefault();
        if (menu.hidden) open();
        else highlight(key === 'Home' ? 0 : key === 'End' ? select.options.length - 1 : active + (key === 'ArrowDown' ? 1 : -1));
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (menu.hidden) open(); else choose(active);
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        typed = Date.now() - lastTyped > 700 ? key : typed + key;
        lastTyped = Date.now();
        if (menu.hidden) open();
        var index = Array.from(select.options).findIndex(function (option) {
          return option.textContent.replace(/^Kab\.\s*/, '').toLocaleLowerCase().startsWith(typed.toLocaleLowerCase());
        });
        if (index >= 0) highlight(index);
      }
    });
    document.addEventListener('pointerdown', function (event) {
      if (!host.contains(event.target) && !menu.contains(event.target)) close();
    });
    window.addEventListener('resize', close);
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, {childList: true, attributes: true, attributeFilter: ['disabled']});
    sync();
  }

  function enhanceMapControls() {
    var shell = document.querySelector(".map-frame");
    var zoom = document.querySelector(".ol-zoom");
    var scale = document.querySelector(".ol-scale-line");
    var attribution = document.querySelector(".bottom-attribution");
    var switcher = document.querySelector(".layer-switcher");

    // qgis2web docks zoom, scale and attribution as three separate fixed
    // boxes held in line by hand-tuned offsets. Re-parent them under one
    // anchor: the rail keeps full chrome, the metadata drops to a flat strip.
    if (shell && (zoom || scale || attribution)) {
      var footer = document.createElement("div");
      footer.className = "atlas-map-footer";
      // The fit button starts in its final rail in HTML, preventing a bare
      // browser-default button from flashing in the toolbar before startup.
      var navigation = shell.querySelector(".atlas-map-tools");
      var meta = document.createElement("div");
      meta.className = "map-meta";
      var info = document.createElement("div");
      info.className = "map-meta__info";
      if (zoom) {
        navigation.appendChild(zoom);
      }
      if (scale) {
        info.appendChild(scale);
      }
      if (attribution) {
        info.appendChild(attribution);
      }
      if (info.childNodes.length) {
        meta.appendChild(info);
      }
      footer.appendChild(meta);
      shell.appendChild(footer);
      if (scale) {
        // Refresh the distance when attribution or font sizing changes the card.
        new ResizeObserver(function () { map.render(); }).observe(scale);
      }
    }

    if (zoom) {
      // The vendor renders bare "+"/"−" text nodes. Wrap them so the glyph
      // can be scaled without scaling the button box along with it.
      [
        { selector: ".ol-zoom-in", label: "Perbesar" },
        { selector: ".ol-zoom-out", label: "Perkecil" }
      ].forEach(function (entry) {
        var button = zoom.querySelector(entry.selector);
        if (!button) {
          return;
        }
        var glyph = document.createElement("span");
        glyph.className = "ctl-glyph";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = button.textContent;
        button.textContent = "";
        button.appendChild(glyph);
        // Replaces the vendor's English title, which was the only label a
        // screen reader had beyond the bare "+" glyph.
        button.setAttribute("aria-label", entry.label);
        button.setAttribute("data-tooltip", entry.label);
        stripNativeTitle(button);
        initPressRipple(button, button);
      });
      initPressedRail(zoom);
    }

    if (switcher) {
      // The layer panel is a sibling of the canvas, so map clipping and
      // OpenLayers overlay stacking cannot cover it.
      document.querySelector(".app-shell").appendChild(switcher);
      switcher.id = "atlas-layer-panel";
      switcher.setAttribute("role", "region");
      switcher.setAttribute("aria-label", "Pengaturan layer peta");
      var heading = document.createElement("div");
      heading.className = "atlas-layer-heading";
      heading.innerHTML = '<h2>Layer peta</h2><p>Atur informasi yang ditampilkan.</p>';
      switcher.insertBefore(heading, switcher.querySelector('.panel'));
      var switcherButton = switcher.querySelector(":scope > button");
      if (switcherButton) {
        stripNativeTitle(switcherButton);
        switcherButton.addEventListener("click", function () {
          document.getElementById("atlas-layers").focus({preventScroll: true});
        });
      }
      var layerNav = document.getElementById("atlas-layers");
      layerNav.setAttribute("aria-controls", switcher.id);
      layerNav.setAttribute("aria-expanded", "false");
      window.layerSwitcher.on("show", function () {
        document.body.classList.add("is-layer-open");
        layerNav.setAttribute("aria-expanded", "true");
        closeAtlasSelects();
        if (isMobileViewport()) {
          hidePopup();
          setPanelOpen(false);
        }
        else {
          document.body.classList.add("is-sidebar-collapsed");
          document.getElementById("sidebar").inert = true;
          var listToggle = document.getElementById("panel-toggle");
          listToggle.setAttribute("aria-expanded", "false");
          listToggle.setAttribute("aria-label", "Buka daftar titik");
        }
        document.getElementById("atlas-home").classList.remove("is-active");
        if (switcherButton) switcherButton.focus({preventScroll: true});
      });
      window.layerSwitcher.on("hide", function () {
        document.body.classList.remove("is-layer-open");
        layerNav.setAttribute("aria-expanded", "false");
        document.getElementById("atlas-home").classList.toggle("is-active", isMobileViewport()
          ? !document.body.classList.contains("is-panel-open")
          : document.body.classList.contains("is-sidebar-collapsed"));
      });
      switcher.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.stopPropagation();
          window.layerSwitcher.hidePanel();
          layerNav.focus({preventScroll: true});
        }
      });
    }

    var panelToggle = document.getElementById("panel-toggle");
    if (panelToggle) {
      initPressRipple(panelToggle, panelToggle);
    }

    initControlProximity(
      [zoom, switcher, document.getElementById("panel-toggle")].filter(Boolean)
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    var hasInitialised = false;
    var loadWatchdog = null;

    if (!window.map || !window.lyr_260331_4) {
      // Nothing to retry against — the map itself never came up.
      showDataLoadError("Peta atau layer titik tidak berhasil diinisialisasi.");
      return;
    }

    // Control chrome does not depend on the point data, so it runs here
    // rather than in init() — which only fires once the GeoJSON lands.
    enhanceMapControls();
    document.querySelectorAll('.atlas-select select').forEach(enhanceAtlasSelect);
    var basemaps = { street: window.lyr_AtlasStreet_9, google: window.lyr_GoogleSatellite_0, esri: window.lyr_EsriWorldImagery_8 };
    Object.keys(basemaps).forEach(function (key) {
      basemaps[key].on("change:visible", function () {
        window.lyr_BatasKabupaten_1.changed();
        window.lyr_FokusProvinsi_7.changed();
      });
    });
    document.getElementById("atlas-layers").addEventListener("click", function () {
      if (!window.layerSwitcher) return;
      if (document.querySelector(".layer-switcher.shown")) window.layerSwitcher.hidePanel();
      else window.layerSwitcher.showPanel();
    });
    document.getElementById("atlas-help").addEventListener("click", function () {
      document.getElementById("atlas-guide").showModal();
    });

    var pointSource = window.lyr_260331_4.getSource();
    // Reserve pins draw on their own layer (same source) so the layer switcher
    // can hide them independently. Optional: an older layers.js without it
    // just keeps everything on the SK layer.
    var cadanganLayer = window.lyr_Cadangan_5 || null;
    // Unplaced-unit pins likewise get their own layer (visible by default).
    var belumLayer = window.lyr_BelumDitetapkan_6 || null;

    // init() installs the cluster refresh + legend update here once the data
    // and the lookup tables it needs exist.
    var pointsRedrawHook = null;

    function redrawPoints() {
      window.lyr_260331_4.changed();
      if (cadanganLayer) {
        cadanganLayer.changed();
      }
      if (belumLayer) {
        belumLayer.changed();
      }
      if (pointsRedrawHook) {
        pointsRedrawHook();
      }
    }

    function retryDataLoad() {
      showDataLoading();
      armWatchdog();
      pointSource.refresh();
    }

    function failDataLoad(message) {
      if (hasInitialised) {
        return;
      }
      disarmWatchdog();
      showDataLoadError(message, retryDataLoad);
    }

    // OpenLayers only runs a vector source's loader while the layer is being
    // rendered, and a hidden tab never renders. Counting wall-clock time would
    // therefore "time out" a page that is merely sitting in a background tab
    // with a perfectly healthy network — so the watchdog only runs while the
    // document is actually visible.
    function armWatchdog() {
      if (hasInitialised || loadWatchdog !== null || document.hidden) {
        return;
      }
      loadWatchdog = window.setTimeout(function () {
        loadWatchdog = null;
        if (!hasInitialised && !pointSource.getFeatures().length) {
          failDataLoad(
            "File data/points.geojson belum selesai dimuat setelah 20 detik."
          );
        }
      }, 20000);
    }

    function disarmWatchdog() {
      if (loadWatchdog !== null) {
        window.clearTimeout(loadWatchdog);
        loadWatchdog = null;
      }
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        disarmWatchdog();
        return;
      }
      if (hasInitialised) {
        return;
      }
      // Back in view: the layer will render and the loader will finally run.
      // Give it a fresh window, and pick up data that arrived meanwhile.
      runInit();
      armWatchdog();
    });

    if (typeof window.onSingleClickFeatures === "function") {
      window.map.un("singleclick", window.onSingleClickFeatures);
    }
    if (typeof window.onSingleClickWMS === "function") {
      window.map.un("singleclick", window.onSingleClickWMS);
    }

    function init() {
    var collator = getCollator();
    var loadedFeatures = pointSource.getFeatures().slice();
    var allFeatures = loadedFeatures;
    var listContainer = document.getElementById("list-data");
    var searchInput = document.getElementById("list-search");
    var fitButton = document.getElementById("fit-map");
    var panelToggle = document.getElementById("panel-toggle");
    var panelClose = document.getElementById("sidebar-close");
    var listSummary = document.getElementById("list-summary");
    var popup = document.getElementById("popup");
    var popupContent = document.getElementById("popup-content");

    var activeItemId = null;

    // All pins share a padded viewport. The tip at SVG (18,48) maps to the
    // 0.5/0.9 anchor, so padding never moves a marker off its coordinate.
    // Selected pins retain the enlarged silhouette and white ring.
    var selectedPinSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="45" viewBox="-6 -6 48 60">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23ffffff" stroke-width="3"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
      '</svg>';
    var pinStyle = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + selectedPinSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 10
    });

    // Cadangan pins: same silhouette, hatched slate instead of solid yellow,
    // a touch smaller so the SK set still reads as the live layer.
    var cadanganHatch =
      '<defs><pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<rect width="4" height="4" fill="%23e3e8ed"/>' +
        '<rect width="1.6" height="4" fill="%23293d50" fill-opacity="0.45"/>' +
      "</pattern></defs>";
    var cadanganPinSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="-6 -6 48 60">' +
        cadanganHatch +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="url(%23h)" stroke="%23293d50" stroke-width="2"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23ffffff" stroke="%23293d50" stroke-width="1.2"/>' +
      "</svg>";
    var cadanganPinStyle = [new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + cadanganPinSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 0.86
      }),
      zIndex: 1
    })];
    var cadanganSelectedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="45" viewBox="-6 -6 48 60">' +
        cadanganHatch +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="url(%23h)" stroke="%23ffffff" stroke-width="3"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
      "</svg>";
    var cadanganPinSelected = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + cadanganSelectedSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 10
    });

    // Duplikat pins: the normal yellow pin with a dashed orange ring around
    // the head. Still counts as SK; the ring says "position to be confirmed".
    var duplikatRing =
      '<circle cx="18" cy="18" r="15" fill="none" stroke="%23e8731a" stroke-width="2.4" stroke-dasharray="4 3"/>';
    var duplikatPinSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="-6 -6 48 60">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23293d50" stroke-width="2"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
        duplikatRing +
      "</svg>";
    var duplikatPinStyle = [new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + duplikatPinSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 2
    })];
    var duplikatSelectedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="45" viewBox="-6 -6 48 60">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23ffffff" stroke-width="3"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
        duplikatRing +
      "</svg>";
    var duplikatPinSelected = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + duplikatSelectedSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 10
    });

    // Belum Ditetapkan pins: pale pin with a dashed slate outline and a "?" in
    // the head — the position is a placeholder, not a fix. Nothing yellow, so
    // it never reads as one more surveyed unit.
    var belumGlyph =
      '<text x="18" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="19" fill="%23293d50">?</text>';
    var belumPinSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="-6 -6 48 60">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23f4f6f8" stroke="%236b7a8c" stroke-width="2.2" stroke-dasharray="4 3"/>' +
        belumGlyph +
      "</svg>";
    var belumPinStyle = [new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + belumPinSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 2
    })];
    var belumSelectedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="45" viewBox="-6 -6 48 60">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23f4f6f8" stroke="%23ffffff" stroke-width="3"/>' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="none" stroke="%236b7a8c" stroke-width="1.6" stroke-dasharray="4 3"/>' +
        belumGlyph +
      "</svg>";
    var belumPinSelected = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + belumSelectedSvg,
        anchor: [0.5, 0.9],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 10
    });

    // Ground halo under the selected pin, at its tip. The card is 312px of
    // white; the pin is 30px — this is what leads the eye back from one to the
    // other, the way a selected place lights up its footprint in Google Maps.
    function selectionHalo(color, ring) {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 15,
          fill: new ol.style.Fill({ color: color }),
          stroke: new ol.style.Stroke({ color: ring, width: 1.5 })
        }),
        zIndex: 9
      });
    }
    var haloYellow = selectionHalo("rgba(254, 229, 15, 0.26)", "rgba(255, 255, 255, 0.7)");
    var haloSlate = selectionHalo("rgba(107, 122, 140, 0.24)", "rgba(255, 255, 255, 0.7)");

    function selectedStyleFor(item) {
      if (item.cadangan) {
        return [haloSlate, cadanganPinSelected];
      }
      if (item.belum) {
        return [haloSlate, belumPinSelected];
      }
      if (item.duplikat) {
        return [haloYellow, duplikatPinSelected];
      }
      return [haloYellow, pinStyle];
    }

    // Resolve each point's kabupaten/kota by which boundary polygon contains it
    // (authoritative — avoids the messy Nomor prefix). Falls back to the Nomor
    // prefix, then "Lainnya".
    var kabupatenPolygons = window.lyr_BatasKabupaten_1
      ? window.lyr_BatasKabupaten_1.getSource().getFeatures()
      : [];

    function resolveKabupaten(feature) {
      var geom = feature.getGeometry();
      if (!geom) {
        return "Lainnya";
      }
      var ext = geom.getExtent();
      var coord = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
      for (var i = 0; i < kabupatenPolygons.length; i++) {
        var pg = kabupatenPolygons[i].getGeometry();
        if (pg && pg.intersectsCoordinate(coord)) {
          return toDisplayCase(String(kabupatenPolygons[i].get("KABUPATEN_") || ""));
        }
      }
      // Outside every polygon (a point sitting just off the boundary): snap to
      // the nearest kabupaten so it never forms a stray single-point group.
      var nearest = null;
      var nearestDist = Infinity;
      for (var j = 0; j < kabupatenPolygons.length; j++) {
        var pg2 = kabupatenPolygons[j].getGeometry();
        if (!pg2) {
          continue;
        }
        var cp = pg2.getClosestPoint(coord);
        var dx = cp[0] - coord[0];
        var dy = cp[1] - coord[1];
        var d = dx * dx + dy * dy;
        if (d < nearestDist) {
          nearestDist = d;
          nearest = kabupatenPolygons[j];
        }
      }
      if (nearest) {
        return toDisplayCase(String(nearest.get("KABUPATEN_") || ""));
      }
      var prefix = String(feature.get("Nomor") || "").split("-")[0].trim();
      return prefix ? toDisplayCase(prefix) : "Lainnya";
    }

    var mappedItems = allFeatures
      .map(function (feature, index) {
        var nomor = String(feature.get("Nomor") || "-").trim();
        var nama = toPengusulName(feature.get("Nama Anggota")) || "Tanpa Nama";
        // Jalur: which section of the allocation sheet the point came through
        // (Ketua DPRD, Komisi III, Gubernur). The pengusul stays the person;
        // this is the channel the sheet files them under.
        var jalur = String(feature.get("Jalur") || "").trim();
        var alamat = String(feature.get("Alamat") || "").trim();
        // Cleaned at the source, not just at the title: buildPopupHtml shows
        // Keterangan as its own meta row whenever it differs from the title,
        // so cleaning only the title would push the survey note down the popup
        // instead of removing it.
        var keterangan = cleanKeterangan(feature.get("Keterangan"));
        var tanggal = String(feature.get("Tanggal Dokumentasi") || "").trim();
        var photo = String(feature.get("Foto Survey Awal") || "").trim();
        var kabupaten = resolveKabupaten(feature);
        var cadangan = isCadangan(feature);
        var duplikat = isDuplikat(feature);
        var belum = isBelumDitetapkan(feature);
        var catatan = String(feature.get("Catatan") || "").trim();
        feature.set("kabupaten", kabupaten);

        // Koordinat: pakai field survey; kalau kosong, turunkan dari geometri
        var lon = feature.get("Longitude");
        var lat = feature.get("Latitude");
        if (lat === null || lat === undefined || lat === "" ||
            lon === null || lon === undefined || lon === "") {
          var ge = feature.getGeometry().getExtent();
          var ll = ol.proj.toLonLat([(ge[0] + ge[2]) / 2, (ge[1] + ge[3]) / 2]);
          lon = ll[0];
          lat = ll[1];
        }
        var latNum = Number(lat);
        var lonNum = Number(lon);
        var koordinat = formatCoordPair(latNum, lonNum);

        return {
          id: String(index),
          feature: feature,
          nomor: nomor,
          nama: nama,
          jalur: jalur,
          alamat: alamat,
          keterangan: keterangan,
          tanggal: tanggal,
          photo: photo,
          kabupaten: kabupaten,
          cadangan: cadangan,
          duplikat: duplikat,
          belum: belum,
          catatan: catatan,
          koordinat: koordinat,
          // No coordinate on the row for an unplaced unit: the digits are an
          // estimate, and the "Belum ditetapkan" tag needs the room. The card
          // still shows them, labelled as approximate.
          koordinatSingkat: belum ? "" : koordinat,
          latNum: latNum,
          lonNum: lonNum,
          display: buildDisplayParts(nomor, keterangan),
          searchText: getNormalizedText(
            [
              nomor,
              alamat,
              keterangan,
              tanggal,
              koordinat,
              lat + "," + lon,
              cadangan ? STATUS_LABEL.cadangan.search : "",
              duplikat ? STATUS_LABEL.duplikat.search : "",
              belum ? STATUS_LABEL.belum.search : ""
            ].join(" ")
          ),
        };
      })
      .sort(function (left, right) {
        return collator.compare(left.nomor, right.nomor);
      });

    // How many rows share a flagged point's exact stamp, so its card can say
    // "3 unit tercatat pada koordinat yang sama" instead of guessing at two.
    (function countSharedCoordinates() {
      var byCoord = {};
      mappedItems.forEach(function (item) {
        var key = item.latNum.toFixed(6) + "," + item.lonNum.toFixed(6);
        byCoord[key] = (byCoord[key] || 0) + 1;
      });
      mappedItems.forEach(function (item) {
        if (item.duplikat) {
          item.sharedCoordinateCount =
            byCoord[item.latNum.toFixed(6) + "," + item.lonNum.toFixed(6)] || 1;
        }
      });
    })();

    var items = mappedItems.filter(function (item) {
      return !item.cadangan;
    });
    var cadanganItems = mappedItems.filter(function (item) {
      return item.cadangan;
    });
    var cadanganLayerTitle = cadanganLayer && cadanganLayer.get("title");
    function updateCadanganCount() {
      if (!cadanganLayer) return;
      cadanganLayer.set("title", cadanganLayerTitle +
        ' <span class="layer-count">' + cadanganItems.length + ' titik</span>');
      if (window.layerSwitcher) window.layerSwitcher.renderPanel();
    }
    updateCadanganCount();

    var featureLookup = new Map();
    mappedItems.forEach(function (item) {
      featureLookup.set(item.feature, item);
    });

    function allGroupItems(group) {
      if (!group.cadangan.length) {
        return group.items;
      }
      return group.items.concat(group.cadangan).sort(function (left, right) {
        return collator.compare(left.nomor, right.nomor);
      });
    }

    function buildGroupedItems(mode) {
      var keyFn =
        mode === "kabupaten"
          ? function (item) { return item.kabupaten; }
          : function (item) { return item.nama; };
      var groups = items.reduce(function (result, item) {
        var key = keyFn(item) || "Lainnya";
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(item);
        return result;
      }, {});
      var reserve = cadanganItems.reduce(function (result, item) {
        var key = keyFn(item) || "Lainnya";
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(item);
        return result;
      }, {});
      return Object.keys(groups)
        .sort(function (left, right) {
          return collator.compare(left, right);
        })
        .map(function (name) {
          return {
            name: name,
            items: groups[name],
            cadangan: reserve[name] || []
          };
        });
    }

    // Kabupaten only: the Pengusul grouping was removed from this build so
    // no screen names who proposed a point.
    var groupMode = "kabupaten";
    var groupedItems = buildGroupedItems(groupMode);

    function groupNoun() {
      return groupMode === "kabupaten" ? "kabupaten / kota" : "pengusul";
    }

    // Every row on a pengusul's screen carries the kabupaten chip, even when
    // the whole group sits in one kabupaten and the header already says so.
    // An earlier version showed it only for groups spanning several
    // kabupaten; users read the rows without the chip as missing data. In
    // kabupaten mode the group name already is the kabupaten, so no chip.
    function showsKabupatenPerRow() {
      return groupMode !== "kabupaten";
    }

    // The kabupaten always wears the same chip wherever it appears, so the eye
    // learns one shape and finds it instantly among the desa/kecamatan text.
    // Chip-length names. "Tanjab" is the abbreviation the province itself
    // uses for Tanjung Jabung, so it reads as the name, not as a truncation.
    // Anything not listed is already short enough to print in full.
    var KABUPATEN_SHORT = [
      [/\bTanjung Jabung\b/i, "Tanjab"]
    ];

    function shortKabupaten(name) {
      var short = String(name || "");
      KABUPATEN_SHORT.forEach(function (rule) {
        short = short.replace(rule[0], rule[1]);
      });
      return short;
    }

    function buildKabupatenTag(name, count) {
      var tag = document.createElement("span");
      tag.className = "kab-tag";
      var short = shortKabupaten(name);
      var label = document.createElement("span");
      label.className = "kab-tag__name";
      label.textContent = short;
      tag.appendChild(label);
      if (short !== name) {
        // The full name stays one hover away, and is what gets read aloud.
        tag.title = name;
        label.setAttribute("aria-label", name);
      }
      if (count !== undefined) {
        var num = document.createElement("span");
        num.className = "kab-tag__count";
        num.textContent = formatCount(count);
        tag.appendChild(num);
      }
      return tag;
    }

    // One chip per kabupaten, biggest share first; the count only shows when
    // the group actually spans more than one kabupaten.
    // Jalur badge. Every pengusul sits in exactly one section of the sheet,
    // so the badge belongs to the pengusul row, not to each point. Neutral
    // grey on purpose: the blue capsule already means "kabupaten".
    function buildJalurTag(jalur) {
      var tag = document.createElement("span");
      tag.className = "jalur-tag";
      tag.textContent = jalur;
      tag.title = "Jalur rekapan: " + jalur;
      return tag;
    }

    // A group's jalur is its members' jalur; pick the first that carries one.
    function groupJalur(group) {
      var all = group.items.concat(group.cadangan);
      for (var i = 0; i < all.length; i++) {
        if (all[i].jalur) {
          return all[i].jalur;
        }
      }
      return "";
    }

    function buildGroupKabupatenTags(group) {
      var counts = {};
      group.items.forEach(function (item) {
        var key = item.kabupaten || "Lainnya";
        counts[key] = (counts[key] || 0) + 1;
      });
      var names = Object.keys(counts).sort(function (left, right) {
        return counts[right] - counts[left] || collator.compare(left, right);
      });
      var fragment = document.createDocumentFragment();
      names.forEach(function (name) {
        fragment.appendChild(
          buildKabupatenTag(name, names.length > 1 ? counts[name] : undefined)
        );
      });
      return fragment;
    }

    function formatCount(value) {
      return value.toLocaleString("id-ID");
    }

    var MONTHS_ID = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];

    // Tanggal Dokumentasi is dd/mm/yyyy. Returns a sortable yyyymmdd number.
    function dateKey(text) {
      var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || "").trim());
      return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
    }

    function formatDateKey(key) {
      var day = key % 100;
      var month = Math.floor(key / 100) % 100;
      var year = Math.floor(key / 10000);
      return day + " " + (MONTHS_ID[month - 1] || "") + " " + year;
    }

    // The footer used to say only the year. The newest survey date tells a
    // reader whether the batch they are waiting for has landed yet.
    function renderFooter() {
      var footer = document.querySelector(".sidebar-footer");
      if (!footer) {
        return;
      }
      var latest = 0;
      mappedItems.forEach(function (item) {
        latest = Math.max(latest, dateKey(item.tanggal));
      });
      if (!latest) {
        return;
      }
      footer.textContent = "";
      footer.appendChild(
        document.createTextNode("Survey lapangan s.d. " + formatDateKey(latest) + " ")
      );
      var dot = document.createElement("span");
      dot.setAttribute("aria-hidden", "true");
      dot.textContent = "\u00b7";
      footer.appendChild(dot);
      footer.appendChild(document.createTextNode(" Dinas ESDM Jambi"));
    }

    // One line that changes with the situation, instead of three numbers that
    // are usually identical and therefore unreadable.
    function renderSummary(matchCount, hasQuery) {
      if (!listSummary) {
        return;
      }
      var text;
      if (activeGroup && statusFilter) {
        var group = findGroup(activeGroup);
        var label = STATUS_LABEL[statusFilter].count;
        var flagged = group ? countGroupFlag(group, statusFilter) : matchCount;
        text = hasQuery
          ? formatCount(matchCount) + " dari " + formatCount(flagged) + " " +
            label
          : formatCount(matchCount) + " " + label + " dari " +
            formatCount(group ? group.items.length : 0) + " titik";
      } else if (activeGroup) {
        text = hasQuery
          ? formatCount(matchCount) + " dari " + formatCount(activeGroupSize()) +
            " titik · peta difilter ke grup ini"
          : formatCount(matchCount) + " titik · peta difilter ke grup ini";
      } else if (hasQuery) {
        text = matchCount
          ? formatCount(matchCount) + " titik cocok di " +
            formatCount(countMatchedGroups()) + " " + groupNoun()
          : "Tidak ada titik yang cocok";
      } else {
        text = formatCount(items.length) + " titik · " +
          formatCount(groupedItems.length) + " " + groupNoun();
      }
      listSummary.textContent = "";
      var total = document.createElement("span");
      var detail = document.createElement("span");
      total.className = "list-summary__total";
      detail.className = "list-summary__detail";
      if (!activeGroup && !hasQuery) {
        total.textContent = formatCount(items.length) + " titik";
        detail.textContent = formatCount(groupedItems.length) + " " + groupNoun();
      } else {
        // Keep the complete filter context together when searching or in a group.
        detail.textContent = text;
      }
      if (total.textContent) {
        listSummary.appendChild(total);
        listSummary.appendChild(document.createTextNode(" "));
      }
      listSummary.appendChild(detail);
    }

    function activeGroupSize() {
      for (var i = 0; i < groupedItems.length; i++) {
        if (groupedItems[i].name === activeGroup) {
          return groupedItems[i].items.length;
        }
      }
      return 0;
    }

    // How many groups contributed at least one row to the current result set.
    function countMatchedGroups() {
      var seen = 0;
      groupedItems.forEach(function (group) {
        var rows = allGroupItems(group);
        for (var i = 0; i < rows.length; i++) {
          if (visibleIds.has(rows[i].id)) {
            seen += 1;
            return;
          }
        }
      });
      return seen;
    }

    // ---- Single source of truth for "what is on the map right now" ----------
    // Both grouping modes behave identically: opening a group filters the map
    // to that group and zooms to it. Search narrows further, inside the active
    // group when there is one. The map layer, the list and the "tampil" counter
    // all read from visibleIds, so they can never disagree.
    var activeGroup = null;
    var visibleIds = new Set(mappedItems.map(function (item) { return item.id; }));
    var restoreFocusGroup = null;
    // Screen 2 only: "duplikat" | "belum" | "cadangan" narrows the group to
    // the rows carrying that flag, so the two pins that still need a field
    // check do not have to be hunted for across fifty rows. Cleared on every
    // screen change; search narrows further inside it.
    var statusFilter = null;

    // Only the statuses that still need a decision get a chip. Cadangan rows
    // are marked in place (hatch + capsule) rather than filtered for.
    var STATUS_FILTERS = ["belum", "duplikat"];

    function itemMatchesFilter(item) {
      return !statusFilter || Boolean(item[statusFilter]);
    }

    function findGroup(name) {
      for (var i = 0; i < groupedItems.length; i++) {
        if (groupedItems[i].name === name) {
          return groupedItems[i];
        }
      }
      return null;
    }

    // Counts SK units only, like the pengusul row on screen 1: a cadangan row
    // that carries the flag still shows under the filter (hatched), but it
    // is not a titik and the numbers must agree with the summary line.
    function countGroupFlag(group, flag) {
      var n = 0;
      group.items.forEach(function (item) {
        if (item[flag]) {
          n += 1;
        }
      });
      return n;
    }

    function updateHighlight(itemId) {
      var previous = listContainer.querySelector(".item.is-active");
      if (previous) {
        previous.classList.remove("is-active");
      }

      if (!itemId) {
        return;
      }

      var next = listContainer.querySelector('[data-item-id="' + itemId + '"]');
      if (next) {
        next.classList.add("is-active");
        scrollRowIntoPane(next);
      }
    }

    // block:"nearest" scoped to the list pane — scrollIntoView would also
    // scroll body/html and shift the fixed shell upward.
    function scrollRowIntoPane(row) {
      var scroller = document.querySelector(".sidebar-scroll");
      if (!scroller || !row) {
        return;
      }
      var scrollerRect = scroller.getBoundingClientRect();
      var rowRect = row.getBoundingClientRect();
      if (rowRect.top < scrollerRect.top) {
        scroller.scrollTop += rowRect.top - scrollerRect.top;
      } else if (rowRect.bottom > scrollerRect.bottom) {
        scroller.scrollTop += rowRect.bottom - scrollerRect.bottom;
      }
    }

    // Returns the card's laid-out height, which the caller needs to work out
    // where to pan the pin to.
    function openPopupForItem(item, coordinate) {
      renderAtlasDock();
      if (!isMobileViewport()) {
        hidePopup();
        document.body.classList.add("is-popup-open");
        return 0;
      }
      if (!popup || !popupContent) {
        return 0;
      }

      var ext = item.feature.getGeometry().getExtent();
      var defaultCoord = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
      var coord = coordinate || defaultCoord;

      popupContent.innerHTML = buildPopupHtml(item);
      attachHatchControl(item);
      popup.style.display = "block";

      // Position before measuring. OpenLayers owns the wrapper it puts around
      // this element and holds that wrapper at display:none for as long as the
      // overlay has no position, so reading offsetHeight any earlier came back
      // 0 out of an unrendered subtree -- but only on the first open after a
      // close, which is why the card landed correctly about half the time. The
      // 0 fell through to the 300px guess in getFocusTargetCenter, so any card
      // taller than that got framed ~200px too high and clipped off the map.
      if (window.overlayPopup && typeof window.overlayPopup.setPosition === "function") {
        window.overlayPopup.setPosition(coord);
      }

      // Flush layout so the browser registers the popup's pre-transition state:
      // going from display:none to display:block and gaining the class in one
      // frame gives the transition no starting point, so it would not animate.
      //
      // This reads the offset synchronously instead of deferring the class by
      // two requestAnimationFrames. That deferral was a real bug on mobile:
      // is-popup-open also tells the bottom sheet to drop out of the way, so
      // whenever those frames were throttled or dropped the class never landed
      // and the sheet stayed at its peek height, covering the popup it was
      // supposed to make room for.
      //
      // The height comes off this same flush. Measuring it after the class
      // instead would buy a second full layout for an identical number:
      // is-popup-open only animates transform and opacity, and outside the
      // mobile breakpoint it does not touch .ol-popup at all.
      var popupHeight = popup.offsetHeight;
      document.body.classList.add("is-popup-open");
      // After the flush above, so the scrollHeight/clientHeight it reads are
      // the laid-out ones and no second layout is forced.
      syncPopupScrollHint();

      return popupHeight;
    }

    var suppressMapClickUntil = 0;
    var flagInFlight = false;

    // Localhost-only controls under the survey fields: Arsir (reserve, not
    // counted) and Duplikat (still counted, pin to be confirmed on site).
    function attachHatchControl(item) {
      if (!isLocalEditor() || !popupContent) {
        return;
      }
      // Both flags share the Status field with "Belum Ditetapkan"; flipping
      // one on a placeholder would silently overwrite it. Placing the unit is
      // a data edit (a real coordinate and photo), not a toggle.
      if (item.belum) {
        return;
      }
      var body = popupContent.querySelector(".feature-popup__body");
      if (!body) {
        return;
      }
      var tools = document.createElement("div");
      tools.className = "feature-popup__tools";
      tools.appendChild(
        buildFlagButton(item, "cadangan", item.cadangan ? "Batal arsir" : "Arsir")
      );
      tools.appendChild(
        buildFlagButton(
          item,
          "duplikat",
          item.duplikat ? "Batal verifikasi" : "Perlu verifikasi"
        )
      );
      body.appendChild(tools);
    }

    function buildFlagButton(item, flag, label) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feature-popup__hatch feature-popup__hatch--" + flag;
      btn.textContent = label;
      btn.addEventListener("mousedown", function (event) {
        event.preventDefault();
        event.stopPropagation();
        suppressMapClickUntil = Date.now() + 500;
      });
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        suppressMapClickUntil = Date.now() + 500;
        toggleFlag(item, flag, btn);
      });
      return btn;
    }

    function rebuildSearchText(item) {
      return getNormalizedText(
        [
          item.nomor,
          item.alamat,
          item.keterangan,
          item.tanggal,
          item.koordinat,
          item.latNum + "," + item.lonNum,
          item.cadangan ? STATUS_LABEL.cadangan.search : "",
          item.duplikat ? STATUS_LABEL.duplikat.search : "",
          item.belum ? STATUS_LABEL.belum.search : ""
        ].join(" ")
      );
    }

    function applyFlagLocally(item, flag, next) {
      if (flag === "cadangan") {
        item.cadangan = next;
        if (next) {
          item.feature.set("Status", "Cadangan");
        } else {
          item.feature.unset("Status");
        }
      } else {
        item.duplikat = next;
        if (next) {
          item.feature.set("Duplikat", true);
        } else {
          item.feature.unset("Duplikat");
        }
      }
      item.searchText = rebuildSearchText(item);

      // Only the reserve flag moves a row between the counted and uncounted
      // sets; a duplicate stays exactly where it was.
      if (flag === "cadangan") {
        items = mappedItems.filter(function (row) {
          return !row.cadangan;
        });
        cadanganItems = mappedItems.filter(function (row) {
          return row.cadangan;
        });
        updateCadanganCount();
        groupedItems = buildGroupedItems(groupMode);
      }

      renderList(searchInput.value);
      if (window.featureOverlay) {
        window.featureOverlay.setStyle(selectedStyleFor(item));
      }
      // Rebuild the card on the next tick so the same pointer-up cannot
      // land on the new button and flag a neighbouring pin.
      window.setTimeout(function () {
        openPopupForItem(item);
      }, 0);
    }

    function toggleFlag(item, flag, btn) {
      if (flagInFlight) {
        return;
      }
      var next = flag === "cadangan" ? !item.cadangan : !item.duplikat;
      flagInFlight = true;
      btn.disabled = true;
      btn.classList.remove("is-error");
      fetch("/api/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomor: item.nomor, flag: flag, value: next })
      })
        .then(function (res) {
          if (!res.ok) {
            throw new Error("write failed");
          }
          return res.json();
        })
        .then(function (payload) {
          if (!payload || !payload.ok) {
            throw new Error("write failed");
          }
          applyFlagLocally(item, flag, next);
        })
        .catch(function () {
          btn.disabled = false;
          btn.classList.add("is-error");
          btn.textContent = "Gagal — jalankan scripts/dev-server.py";
        })
        .then(function () {
          flagInFlight = false;
        });
    }

    function clearSelection() {
      activeItemId = null;
      updateHighlight(activeItemId);

      if (window.collection && typeof window.collection.clear === "function") {
        window.collection.clear();
      }

      if (window.featureOverlay) {
        window.featureOverlay.setStyle(null);
      }

      hidePopup();
      renderAtlasDock();
    }

    var FOCUS_EASING = ol.easing.inAndOut;
    var mapFocusAnimUntil = 0;

    function markMapFocusAnimation(duration) {
      mapFocusAnimUntil = Date.now() + duration + 180;
    }

    function getFocusTargetCenter(view, featureCenter, targetZoom, popupHeight) {
      var animateCenter = featureCenter.slice();
      var size = window.map.getSize();
      if (!size || !size[1]) {
        return animateCenter;
      }

      var targetResolution = view.getResolutionForZoom(targetZoom);
      var pinTargetY;

      if (isMobileViewport()) {
        // Mobile: the card docks under the masthead, so the pin belongs in the
        // strip below it. The gap has to clear the marker itself — it anchors
        // at its tip and draws upward, so anything under ~40px tucks the pin's
        // head behind the card. Tall cards on short screens run out of room;
        // the floor keeps the pin on screen and lets the overlap happen there.
        var cardTop = 0;
        var markerGap = 56;
        var pinFloor = size[1] - 40;
        pinTargetY = Math.min(cardTop + (popupHeight || 300) + markerGap, pinFloor);
      } else {
        // Desktop details live below the map, so center the selected pin.
        pinTargetY = size[1] / 2 + 20;
      }

      var offsetPxDown = pinTargetY - size[1] / 2;
      animateCenter[1] = featureCenter[1] + offsetPxDown * targetResolution;
      return animateCenter;
    }

    function getFocusAnimationDuration(view, featureCenter, targetZoom) {
      var currentZoom = view.getZoom() || 0;
      var zoomDelta = Math.abs(targetZoom - currentZoom);
      var currentCenter = view.getCenter();
      var panPixels = 0;

      if (currentCenter) {
        var startPixel = window.map.getPixelFromCoordinate(currentCenter);
        var endPixel = window.map.getPixelFromCoordinate(featureCenter);
        if (startPixel && endPixel) {
          panPixels = Math.hypot(
            endPixel[0] - startPixel[0],
            endPixel[1] - startPixel[1]
          );
        }
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
      var base = isMobileViewport() ? 560 : 760;
      var zoomBoost = Math.min(zoomDelta * 42, 360);
      var panBoost = Math.min(panPixels * 0.22, 260);
      return Math.round(Math.max(base, Math.min(base + zoomBoost + panBoost, 1180)));
    }

    function animateMapFocus(view, featureCenter, targetZoom, popupHeight) {
      if (view.getAnimating()) {
        view.cancelAnimations();
      }

      var targetCenter = getFocusTargetCenter(
        view,
        featureCenter,
        targetZoom,
        popupHeight
      );
      var duration = getFocusAnimationDuration(view, featureCenter, targetZoom);
      var currentZoom = view.getZoom() || 0;
      var zoomDelta = Math.abs(targetZoom - currentZoom);

      markMapFocusAnimation(duration);

      function finishFocusAnimation() {
        mapFocusAnimUntil = Date.now() + 120;
      }

      if (zoomDelta <= 2.5) {
        view.animate(
          {
            center: targetCenter,
            zoom: targetZoom,
            duration: duration,
            easing: FOCUS_EASING,
          },
          finishFocusAnimation
        );
        return;
      }

      var isZoomingIn = targetZoom > currentZoom;
      var bridgeZoom = isZoomingIn
        ? Math.min(currentZoom + zoomDelta * 0.58, targetZoom - 0.4)
        : Math.max(currentZoom - zoomDelta * 0.58, targetZoom + 0.4);
      var phaseOne = Math.round(duration * 0.44);
      var phaseTwo = duration - phaseOne;

      view.animate(
        {
          center: targetCenter,
          zoom: bridgeZoom,
          duration: phaseOne,
          easing: FOCUS_EASING,
        },
        {
          center: targetCenter,
          zoom: targetZoom,
          duration: phaseTwo,
          easing: FOCUS_EASING,
        },
        finishFocusAnimation
      );
    }

    function focusItem(item, options) {
      var config = options || {};
      var ext = item.feature.getGeometry().getExtent();
      var featureCenter = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];

      activeItemId = item.id;
      updateHighlight(activeItemId);

      if (window.collection && typeof window.collection.clear === "function") {
        window.collection.clear();
        window.collection.push(item.feature);
      }

      if (window.featureOverlay) {
        window.featureOverlay.setStyle(selectedStyleFor(item));
      }
      // The card takes over from the hover tip; the tip would otherwise sit
      // there until the pointer moves.
      setHover(null);
      startSelectionPulse(featureCenter);

      if (isMobileViewport()) {
        setPanelOpen(false);
      } else if (config.closePanel) {
        setSidebarCollapsed(true);
      }

      // Always use the feature's actual center for everything to avoid shifting
      var popupHeight = openPopupForItem(item, featureCenter);

      // 17 is a floor, not a setpoint: it exists to get close enough to read a
      // pin, and once the view is already closer that job is done. Treating it
      // as a setpoint pulled the camera back out on every click, which broke
      // the one case that needs the zoom most -- points a few metres apart,
      // where you zoom in to tell them apart and clicking the second one undid
      // the zoom that made it clickable in the first place.
      var view = window.map.getView();
      var targetZoom = Math.max(config.zoom || 17, view.getZoom() || 0);
      animateMapFocus(view, featureCenter, targetZoom, popupHeight);
    }

    function renderList(query) {
      var normalizedQuery = getNormalizedText(query);
      var coordQuery = parseCoordinateQuery(query);
      var fragment = document.createDocumentFragment();

      visibleIds.clear();
      listContainer.innerHTML = "";

      var visibleCount = activeGroup
        ? renderItemScreen(fragment, normalizedQuery, coordQuery)
        : renderGroupScreen(fragment, normalizedQuery, coordQuery);

      renderPanelNav();
      searchInput.placeholder = activeGroup
        ? "Cari dalam kelompok"
        : "Cari lokasi atau kabupaten…";

      listContainer.appendChild(fragment);
      renderSummary(visibleCount, Boolean(normalizedQuery));
      if (activeItemId && !visibleIds.has(activeItemId)) clearSelection();
      redrawPoints();
      updateHighlight(activeItemId);
      renderAtlasDock();
    }

    // The dock and region selector use the same item IDs as the map and list.
    // Reserve rows never enter the allocation counts.
    function renderAtlasDock() {
      var overview = document.getElementById("atlas-overview");
      if (!overview) return;
      var current = mappedItems.find(function (item) { return item.id === activeItemId; });
      var visible = items.filter(function (item) { return visibleIds.has(item.id); });
      var dock = document.querySelector('.atlas-dock');
      var hasDetail = Boolean(current);
      var layoutChanged = document.body.classList.contains('is-detail-open') !== hasDetail;
      dock.hidden = !hasDetail;
      document.body.classList.toggle('is-detail-open', hasDetail);
      // Focus animations must use the canvas size after the dock opens.
      // Closing the dock preserves the user's current map center and zoom.
      if (layoutChanged) window.map.updateSize();
      setTextContent("atlas-map-region", activeGroup || "Provinsi Jambi");
      var regionSelect = document.getElementById("atlas-region");
      if (regionSelect) {
        regionSelect.value = activeGroup || "";
        syncAtlasSelect(regionSelect);
      }
      if (!current) {
        overview.replaceChildren();
        document.getElementById('atlas-photo').replaceChildren();
        document.getElementById('atlas-region-bars').replaceChildren();
        return;
      }
      overview.innerHTML =
        '<div class="atlas-detail-heading"><span>Titik ' + escapeHtml(current.display.code) + ' · ' + escapeHtml(current.kabupaten) + '</span><button class="atlas-detail-close" type="button" aria-label="Tutup detail lokasi">×</button></div>' +
        '<h2 class="atlas-location-title">' + escapeHtml(current.display.primary) + '</h2>' +
        '<p class="atlas-description">' + escapeHtml(current.alamat || current.display.secondary) + '</p>' +
        (statusNote(current) ? '<p class="atlas-status-note">' + escapeHtml(statusNote(current)) + '</p>' : '') +
        '<dl class="atlas-detail-meta"><div><dt>' + (current.belum ? 'Koordinat perkiraan' : 'Koordinat') + '</dt><dd>' + escapeHtml(current.koordinat) + '</dd></div>' +
        '<div><dt>Dokumentasi</dt><dd>' + escapeHtml(current.tanggal || 'Belum tersedia') + '</dd></div></dl>' +
        (current.belum ? '' : buildRouteAction(current));
      overview.querySelector('.atlas-detail-close').addEventListener('click', function () {
        clearSelection();
        document.getElementById('map').focus({preventScroll: true});
      });
      // Preserve the existing localhost-only editing controls.
      if (isLocalEditor() && !current.belum) {
        var localTools = document.createElement('div');
        localTools.className = 'feature-popup__tools';
        localTools.appendChild(buildFlagButton(current, 'cadangan', current.cadangan ? 'Batal arsir' : 'Arsir'));
        localTools.appendChild(buildFlagButton(current, 'duplikat', current.duplikat ? 'Batal verifikasi' : 'Perlu verifikasi'));
        overview.appendChild(localTools);
      }
      var photoItem = current;
      var photoCard = document.getElementById('atlas-photo');
      if (photoItem.photo && !photoItem.belum) {
        var url = 'images/' + encodeURI(sanitizeMediaPath(photoItem.photo));
        photoCard.innerHTML = '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" aria-label="Buka foto survei ' + escapeHtml(photoItem.nomor) + '"><img src="' + escapeHtml(url) + '" alt="Lokasi survei ' + escapeHtml(photoItem.display.primary) + '" decoding="async" /><span class="atlas-photo__arrow" aria-hidden="true">↗</span><div class="atlas-photo__caption"><span>Dokumentasi lokasi</span><strong>' + escapeHtml(photoItem.display.desa) + ', ' + escapeHtml(shortKabupatenInline(photoItem.kabupaten)) + '</strong></div></a>';
        photoCard.querySelector('img').addEventListener('error', function () {
          photoCard.innerHTML = '<div class="atlas-photo__empty">Foto lokasi belum dapat dimuat.</div>';
        });
      } else {
        photoCard.innerHTML = '<div class="atlas-photo__empty">' + (current.belum ? 'Lokasi belum ditetapkan.<br>Dokumentasi belum tersedia.' : 'Foto survei belum tersedia.') + '</div>';
      }
      var bars = document.getElementById('atlas-region-bars');
      bars.replaceChildren();
      var counts = {};
      visible.forEach(function (item) { counts[item.kabupaten] = (counts[item.kabupaten] || 0) + 1; });
      var ranked = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || collator.compare(a, b); });
      ranked.slice(0, 4).forEach(function (name) {
        var row = document.createElement('button');
        row.type = 'button'; row.className = 'atlas-region-row';
        row.setAttribute('aria-label', name + ', ' + counts[name] + ' titik, lihat wilayah');
        row.innerHTML = '<span>' + escapeHtml(shortKabupaten(name)) + '</span><strong>' + counts[name] + '</strong><span class="atlas-region-row__track" aria-hidden="true"><i style="width:' + (100 * counts[name] / counts[ranked[0]]) + '%"></i></span>';
        row.addEventListener('click', function () { setActiveGroup(name); });
        bars.appendChild(row);
      });
      if (!ranked.length) bars.innerHTML = '<p class="atlas-description">Tidak ada titik dalam hasil filter.</p>';
    }

    function initAtlasControls() {
      var region = document.getElementById('atlas-region');
      groupedItems.forEach(function (group) {
        var option = document.createElement('option');
        option.value = group.name; option.textContent = shortKabupaten(group.name);
        option.dataset.count = String(group.items.length);
        region.appendChild(option);
      });
      region.addEventListener('change', function () {
        setActiveGroup(region.value || null);
        if (isMobileViewport()) setPanelOpen(false);
      });
      document.getElementById('atlas-fit').addEventListener('click', function () { fitToVisible({ maxZoom: 16 }); });
      document.getElementById('atlas-home').addEventListener('click', function () {
        if (window.layerSwitcher) window.layerSwitcher.hidePanel();
        clearTimeout(searchDebounce);
        // Fit only after the list is closed, so its old footprint cannot
        // shift the destination of the full-map view.
        if (isMobileViewport()) setPanelOpen(false);
        else setSidebarCollapsed(true);
        setActiveGroup(null);
      });
      document.getElementById('atlas-all-regions').addEventListener('click', function () {
        setActiveGroup(null);
        setSidebarCollapsed(false);
      });
      // Reflow the canvas without resetting the current view when details close.
      new ResizeObserver(function () {
        window.map.updateSize();
      }).observe(document.getElementById('map'));
    }

    // Screen 1. With no query: one row per group, no points. With a query:
    // matching points across every group, flat — search is the shortcut past
    // the drill-down, so it must not make you pick a group first.
    function renderGroupScreen(fragment, normalizedQuery, coordQuery) {
      var visibleCount = 0;

      if (normalizedQuery) {
        var matched = [];
        groupedItems.forEach(function (group) {
          allGroupItems(group).forEach(function (item) {
            if (!itemMatchesQuery(item, normalizedQuery, coordQuery)) {
              return;
            }
            visibleIds.add(item.id);
            if (!item.cadangan) {
              visibleCount += 1;
            }
            matched.push({ item: item, groupName: group.name });
          });
        });

        matched.forEach(function (entry) {
          fragment.appendChild(buildItemRow(entry.item, entry.groupName));
        });

        if (!visibleCount) {
          fragment.appendChild(buildEmptyState(true));
        }
        return visibleCount;
      }

      groupedItems.forEach(function (group) {
        allGroupItems(group).forEach(function (item) {
          visibleIds.add(item.id);
          if (!item.cadangan) {
            visibleCount += 1;
          }
        });
        fragment.appendChild(buildGroupRow(group));
      });

      if (!groupedItems.length) {
        fragment.appendChild(buildEmptyState(false));
      }
      return visibleCount;
    }

    // Screen 2. Only the active group contributes rows.
    function renderItemScreen(fragment, normalizedQuery, coordQuery) {
      var group = findGroup(activeGroup);
      if (!group) {
        activeGroup = null;
        statusFilter = null;
        return renderGroupScreen(fragment, normalizedQuery, coordQuery);
      }

      // The local editor can clear the last flag of the kind being filtered;
      // an empty filter would then hide the whole group behind a chip that no
      // longer exists.
      if (statusFilter && !countGroupFlag(group, statusFilter)) {
        statusFilter = null;
      }

      var matchedItems = allGroupItems(group).filter(function (item) {
        return itemMatchesFilter(item) &&
          itemMatchesQuery(item, normalizedQuery, coordQuery);
      });

      matchedItems.forEach(function (item) {
        visibleIds.add(item.id);
      });

      // Rows sort by Nomor (KABUPATEN-KECAMATAN-DESA-NNN), so a group's
      // kecamatan already arrive in contiguous runs. When there is more than
      // one, a sticky label at the top of each run names it and says how many
      // units sit there -- the structure a 40-row list otherwise hides in the
      // sublines. One kecamatan needs no label: the rows already say it.
      var sections = sectionsByKecamatan(matchedItems);
      var showKabupaten = showsKabupatenPerRow();
      var sectioned = sections.length > 1;
      sections.forEach(function (section) {
        if (sectioned) {
          fragment.appendChild(buildSectionHeader(section));
        }
        section.items.forEach(function (item) {
          fragment.appendChild(buildItemRow(item, null, showKabupaten));
        });
      });

      if (!matchedItems.length) {
        fragment.appendChild(buildEmptyState(Boolean(normalizedQuery)));
      }
        var skCount = 0;
      matchedItems.forEach(function (item) {
        if (!item.cadangan) {
          skCount += 1;
        }
      });
      return skCount;
    }

    // One section per kecamatan, in order of first appearance. Keyed rather
    // than run-based so a stray Nomor prefix ("JAMBI-KOTA BARU-…" among
    // "KOTA JAMBI-KOTA BARU-…") joins its kecamatan instead of opening a
    // second header for it. Cadangan rows travel with their kecamatan but do
    // not count: the header total matches the summary line.
    function sectionsByKecamatan(rows) {
      var sections = [];
      var byKey = {};
      rows.forEach(function (item) {
        var key = item.display.kecamatan || "";
        var section = byKey[key];
        if (!section) {
          section = byKey[key] = { key: key, items: [], count: 0 };
          sections.push(section);
        }
        section.items.push(item);
        if (!item.cadangan) {
          section.count += 1;
        }
      });
      return sections;
    }

    function buildSectionHeader(section) {
      var header = document.createElement("div");
      var title = document.createElement("span");
      var count = document.createElement("span");

      header.className = "list-section";
      header.setAttribute("role", "heading");
      header.setAttribute("aria-level", "3");

      title.className = "list-section__title";
      title.textContent = section.key ? "Kec. " + section.key : "Kecamatan lain";

      count.className = "list-section__count";
      count.textContent = formatCount(section.count) + " titik";

      header.appendChild(title);
      header.appendChild(count);
      return header;
    }

    // Where a group's units sit and how many pins still need a field check.
    // Pengusul rows name the kabupaten (biggest share first); kabupaten rows
    // say how many pengusul share it. Duplikat and Belum Ditetapkan counts
    // follow only when non-zero, so a clean group stays a clean line.
    function buildGroupMeta(group) {
      var meta = document.createElement("span");
      meta.className = "group-row__meta";
      var parts = [];

      if (groupMode === "kabupaten") {
        // Was "N pengusul"; this build hides proposers, so the row counts
        // the kecamatan the kabupaten's points spread over instead.
        var kecamatan = {};
        group.items.forEach(function (item) {
          if (item.display.kecamatan) {
            kecamatan[item.display.kecamatan] = true;
          }
        });
        var n = Object.keys(kecamatan).length;
        if (n) {
          parts.push({ text: formatCount(n) + " kecamatan" });
        }
      } else {
        var counts = {};
        group.items.forEach(function (item) {
          var key = item.kabupaten || "Lainnya";
          counts[key] = (counts[key] || 0) + 1;
        });
        var names = Object.keys(counts).sort(function (left, right) {
          return counts[right] - counts[left] || collator.compare(left, right);
        });
        // No-break space before each dot: a long list may wrap, but the dot
        // then ends a line instead of opening the next one.
        parts.push({
          text: names.map(shortKabupatenInline).join("\u00a0· "),
          title: names.join(", ")
        });
      }

      var duplikat = 0;
      var belum = 0;
      group.items.forEach(function (item) {
        if (item.duplikat) {
          duplikat += 1;
        }
        if (item.belum) {
          belum += 1;
        }
      });
      if (duplikat) {
        parts.push({
          text: formatCount(duplikat) + " " + STATUS_LABEL.duplikat.count,
          flag: "duplikat"
        });
      }
      if (belum) {
        parts.push({
          text: formatCount(belum) + " " + STATUS_LABEL.belum.count,
          flag: "belum"
        });
      }

      parts.forEach(function (part) {
        var span = document.createElement("span");
        span.className = "group-row__meta-item";
        if (part.title) {
          span.title = part.title;
        }
        if (part.flag) {
          span.className += " group-row__flag group-row__flag--" + part.flag;
          var dot = document.createElement("span");
          dot.className = "group-row__dot";
          dot.setAttribute("aria-hidden", "true");
          span.appendChild(dot);
        }
        span.appendChild(document.createTextNode(part.text));
        meta.appendChild(span);
      });

      meta.dataset.text = parts
        .map(function (part) { return part.text; })
        .join(", ");
      return meta;
    }

    // "Kab. Merangin" is the polygon's name; on a line that already sits under
    // a pengusul it is the noun that matters, so the prefix goes. "Kota Jambi"
    // keeps its word: it distinguishes the city from the kabupaten around it.
    function shortKabupatenInline(name) {
      return shortKabupaten(name).replace(/^Kab\.\s+/i, "");
    }

    function buildGroupRow(group) {
      var row = document.createElement("button");
      var copy = document.createElement("span");
      var title = document.createElement("span");
      var count = document.createElement("span");
      var chevron = document.createElement("span");

      row.type = "button";
      row.className = "group-row";
      row.dataset.groupName = group.name;
      // Only pengusul rows carry a jalur; a kabupaten spans several.
      var jalur = groupMode === "kabupaten" ? "" : groupJalur(group);
      var meta = buildGroupMeta(group);

      // The visible count is a bare number so the column lines up; the
      // accessible name still spells out what it counts.
      row.setAttribute(
        "aria-label",
        group.name +
          (jalur ? ", jalur " + jalur : "") +
          ", " + meta.dataset.text +
          ", " + group.items.length + " titik, buka daftar"
      );

      copy.className = "group-row__copy";
      title.className = "group-row__title";
      title.textContent = group.name;
      copy.appendChild(title);
      // The jalur badge leads the second line rather than sitting in its own
      // column: that column cost the line half its width, and a kabupaten
      // list or a "belum ditetapkan" count ended in an ellipsis.
      if (jalur) {
        meta.insertBefore(buildJalurTag(jalur), meta.firstChild);
      }
      copy.appendChild(meta);

      // Status belongs on its own line so the location remains easy to scan.
      var flags = meta.querySelectorAll(".group-row__flag");
      if (flags.length) {
        var statuses = document.createElement("span");
        statuses.className = "group-row__statuses";
        flags.forEach(function (flag) { statuses.appendChild(flag); });
        copy.appendChild(statuses);
      }

      count.className = "group-row__count";
      count.textContent = String(group.items.length);

      chevron.className = "group-row__chevron";
      chevron.setAttribute("aria-hidden", "true");

      row.appendChild(copy);
      row.appendChild(count);
      row.appendChild(chevron);

      // A status count is a shortcut: it opens the group narrowed to those
      // rows. Spans inside a button cannot be buttons themselves, so the row
      // reads which part was hit; keyboard users reach the same filter from
      // the chips on screen 2.
      flags.forEach(function (flag) {
        var kind = flag.classList.contains("group-row__flag--belum")
          ? "belum"
          : "duplikat";
        flag.dataset.filter = kind;
        flag.title = "Tampilkan hanya " + STATUS_LABEL[kind].count;
      });
      row.addEventListener("click", function (event) {
        var hit = event.target.closest ? event.target.closest(".group-row__flag") : null;
        setActiveGroup(group.name, {
          filter: hit && row.contains(hit) ? hit.dataset.filter : null
        });
      });

      return row;
    }

    // groupName closes the subline on screen 1 search results, where the row
    // has to say which group it came from. withKabupaten adds the kabupaten
    // chip on a pengusul's screen 2.
    function buildItemRow(item, groupName, withKabupaten) {
      var button = document.createElement("button");
      var code = document.createElement("span");
      var copy = document.createElement("span");
      var headline = document.createElement("span");
      var label = document.createElement("span");
      var subline = document.createElement("span");

      button.type = "button";
      button.className = "item";
      if (item.cadangan) {
        button.classList.add("is-cadangan");
      }
      if (item.duplikat) {
        button.classList.add("is-duplikat");
      }
      if (item.belum) {
        button.classList.add("is-belum");
      }
      button.dataset.itemId = item.id;
      button.title = item.nomor;
      button.setAttribute(
        "aria-label",
        [
          "Titik " + item.display.code,
          item.cadangan ? STATUS_LABEL.cadangan.tag : "",
          item.duplikat ? STATUS_LABEL.duplikat.tag : "",
          item.belum ? STATUS_LABEL.belum.tag : "",
          item.display.primary,
          item.display.secondary,
          item.kabupaten
        ]
          .filter(Boolean)
          .join(". ")
      );

      code.className = "item-code";
      code.textContent = item.display.code;

      copy.className = "item-copy";
      headline.className = "item-headline";

      label.className = "item-label";
      label.textContent = item.display.primary;
      headline.appendChild(label);

      if (item.koordinatSingkat) {
        var coord = document.createElement("span");
        coord.className = "item-coord";
        coord.textContent = item.koordinatSingkat;
        headline.appendChild(coord);
      }

      // Status capsules get a line of their own under the title. In the
      // headline they left the title a few letters of width next to the
      // coordinate ("K a…"); on their own line the title and the location
      // line read exactly as they do on an unflagged row.
      var status = null;
      if (item.duplikat || item.belum || item.cadangan) {
        status = document.createElement("span");
        status.className = "item-status";
      }
      if (item.cadangan) {
        var cadanganFlag = document.createElement("span");
        cadanganFlag.className = "item-flag item-flag--cadangan";
        cadanganFlag.textContent = STATUS_LABEL.cadangan.tag;
        cadanganFlag.title = "Di luar jatah; dipasang hanya jika ada titik lain yang batal";
        status.appendChild(cadanganFlag);
      }
      if (item.duplikat) {
        var flag = document.createElement("span");
        flag.className = "item-flag";
        flag.textContent = STATUS_LABEL.duplikat.tag;
        flag.title = STATUS_LABEL.duplikat.legend;
        status.appendChild(flag);
      }
      if (item.belum) {
        var belumFlag = document.createElement("span");
        belumFlag.className = "item-flag item-flag--belum";
        belumFlag.textContent = STATUS_LABEL.belum.tag;
        status.appendChild(belumFlag);
      }

      subline.className = "item-subline";
      var sublineText = [item.display.secondary, groupName]
        .filter(Boolean)
        .join(" · ");
      if (sublineText) {
        subline.appendChild(document.createTextNode(sublineText));
      }
      if (withKabupaten && item.kabupaten) {
        subline.appendChild(buildKabupatenTag(item.kabupaten));
      }

      copy.appendChild(headline);
      if (status) {
        copy.appendChild(status);
      }
      copy.appendChild(subline);
      button.appendChild(code);
      button.appendChild(copy);

      if (item.id === activeItemId) {
        button.classList.add("is-active");
      }

      button.addEventListener("click", function () {
        focusItem(item, { closePanel: true, zoom: 17 });
      });

      return button;
    }

    // The context header above the list: back button + group name, on screen 2
    // only. Screen 1 has none.
    function renderPanelNav() {
      var header = document.querySelector(".sidebar-header");
      var existing = document.querySelector(".panel-context");
      if (existing) {
        existing.remove();
      }

      // Screen 2 hides two controls: the grouping toggle, because changing how
      // points are grouped from inside one group has no coherent meaning; and
      // "Lihat semua", because the back button already does that job and says
      // so more plainly.
      header.classList.toggle("is-detail", Boolean(activeGroup));
      var fitBtn = document.getElementById("fit-map");
      if (fitBtn) {
        fitBtn.hidden = Boolean(activeGroup);
      }

      if (!activeGroup) {
        return;
      }

      var wrap = document.createElement("div");
      var back = document.createElement("button");
      var title = document.createElement("p");

      wrap.className = "panel-context";

      back.type = "button";
      back.className = "panel-back";
      back.textContent = "Semua " + groupNoun();
      back.addEventListener("click", function () {
        setActiveGroup(null);
      });

      title.className = "panel-context__title";
      title.textContent = activeGroup;

      wrap.appendChild(back);
      wrap.appendChild(title);

      var group = findGroup(activeGroup);

      // Where this pengusul's points sit. The title alone answers "who";
      // this line answers "where", which is the question the list of desa
      // names underneath cannot settle by itself.
      if (groupMode !== "kabupaten") {
        if (group) {
          var meta = document.createElement("p");
          meta.className = "panel-context__meta";
          var jalur = groupJalur(group);
          if (jalur) {
            meta.appendChild(buildJalurTag(jalur));
          }
          meta.appendChild(buildGroupKabupatenTags(group));
          wrap.appendChild(meta);
        }
      }

      if (group) {
        var filters = buildStatusFilters(group);
        if (filters) {
          wrap.appendChild(filters);
        }
      }

      header.insertBefore(wrap, header.firstChild);
    }

    // One chip per status the group actually has, plus "Semua" to get back.
    // A clean group shows no row at all: there is nothing to jump to.
    function buildStatusFilters(group) {
      var counts = {};
      var any = false;
      STATUS_FILTERS.forEach(function (flag) {
        counts[flag] = countGroupFlag(group, flag);
        if (counts[flag]) {
          any = true;
        }
      });
      if (!any) {
        return null;
      }

      var row = document.createElement("div");
      row.className = "status-filters";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Saring menurut status");

      row.appendChild(
        buildStatusChip(null, "Semua", group.items.length, !statusFilter)
      );
      STATUS_FILTERS.forEach(function (flag) {
        if (!counts[flag]) {
          return;
        }
        row.appendChild(
          buildStatusChip(
            flag,
            STATUS_LABEL[flag].count,
            counts[flag],
            statusFilter === flag
          )
        );
      });
      return row;
    }

    function buildStatusChip(flag, label, count, isActive) {
      var chip = document.createElement("button");
      var num = document.createElement("span");
      chip.type = "button";
      chip.className = "status-chip" + (flag ? " status-chip--" + flag : "");
      chip.classList.toggle("is-active", isActive);
      chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (flag) {
        var dot = document.createElement("span");
        dot.className = "group-row__dot";
        dot.setAttribute("aria-hidden", "true");
        chip.appendChild(dot);
      }
      num.className = "status-chip__count";
      num.textContent = formatCount(count);
      chip.appendChild(num);
      chip.appendChild(document.createTextNode(" " + label));
      chip.addEventListener("click", function () {
        setStatusFilter(flag);
      });
      return chip;
    }

    // Flip the screen 2 filter. The chip that is already on turns back off
    // (same as "Semua"); the list scrolls to its top because the survivors
    // may all have sat below the fold.
    function setStatusFilter(flag) {
      var next = flag && flag !== statusFilter ? flag : null;
      if (next === statusFilter) {
        return;
      }
      statusFilter = next;
      clearSelection();
      renderList(searchInput.value);
      var scroller = document.querySelector(".sidebar-scroll");
      if (scroller) {
        scroller.scrollTop = 0;
      }
      var chip = document.querySelector(
        statusFilter
          ? ".status-chip--" + statusFilter
          : ".status-chip:not([class*=' status-chip--'])"
      );
      focusWithoutScroll(chip);
      fitToVisible({ maxZoom: 16, duration: 500 });
    }

    function buildEmptyState(hasQuery) {
      var wrap = document.createElement("div");
      wrap.className = "empty-state";

      var copy = document.createElement("p");
      copy.className = "empty-state__copy";
      wrap.appendChild(copy);

      if (hasQuery && activeGroup) {
        copy.textContent =
          "Tidak ada titik yang cocok di dalam " + activeGroup + ".";
        var widen = document.createElement("button");
        widen.type = "button";
        widen.className = "secondary-action";
        widen.textContent = "Cari di semua titik";
        widen.addEventListener("click", function () {
          // Keep the query: the point of this button is to widen the same
          // search, not to start over.
          var carried = searchInput.value;
          activeGroup = null;
          statusFilter = null;
          restoreFocusGroup = null;
          clearSelection();
          searchInput.value = carried;
          renderList(carried);
          fitToVisible({ maxZoom: 16, duration: 500 });
        });
        wrap.appendChild(widen);
      } else if (hasQuery) {
        copy.textContent =
          "Tidak ada titik yang cocok dengan pencarian. Coba nomor titik, nama kabupaten, patokan lokasi, nama desa, atau koordinat.";
      } else {
        copy.textContent = "Belum ada titik untuk ditampilkan.";
      }

      return wrap;
    }

    // ---- Map <-> list synchronisation --------------------------------------
    // The layers render exactly the ids the list is showing, so the "tampil"
    // counter is true by construction. SK, cadangan and belum share one source
    // but draw on three layers, each taking only its own status, so the
    // switcher can hide the reserve pins (the default) without touching the SK
    // set. Every point is drawn at every zoom — see the declutter note in
    // layers/layers.js; clustering into count badges was tried and rejected
    // too, for reading as a dashboard instead of a map of where the poles are.
    var INK = "#293d50";

    // sk | duplikat | belum | cadangan — the status a point is drawn as.
    function itemKind(item) {
      if (item.cadangan) {
        return "cadangan";
      }
      if (item.belum) {
        return "belum";
      }
      if (item.duplikat) {
        return "duplikat";
      }
      return "sk";
    }

    function layerForKind(kind) {
      if (kind === "cadangan" && cadanganLayer) {
        return cadanganLayer;
      }
      if (kind === "belum" && belumLayer) {
        return belumLayer;
      }
      return window.lyr_260331_4;
    }

    function isItemShown(item) {
      return visibleIds.has(item.id) && layerForKind(itemKind(item)).getVisible();
    }

    // Each layer paints only the status it owns, and only ids the list shows.
    // cadangan/belum fall back onto the SK layer when their own layer is
    // missing (an older layers.js).
    function layerStyleFor(kinds) {
      return function (feature, resolution) {
        var item = featureLookup.get(feature);
        if (!item || !visibleIds.has(item.id)) {
          return null;
        }
        return kinds.indexOf(itemKind(item)) === -1
          ? null
          : singleStyle(item, resolution);
      };
    }

    var skKinds = ["sk", "duplikat"];
    if (!cadanganLayer) {
      skKinds.push("cadangan");
    }
    if (!belumLayer) {
      skKinds.push("belum");
    }
    window.lyr_260331_4.setStyle(layerStyleFor(skKinds));
    if (cadanganLayer) {
      cadanganLayer.setStyle(layerStyleFor(["cadangan"]));
    }
    if (belumLayer) {
      belumLayer.setStyle(layerStyleFor(["belum"]));
    }

    var pointLayers = [window.lyr_260331_4, cadanganLayer, belumLayer].filter(Boolean);

    function isPointLayer(layer) {
      return pointLayers.indexOf(layer) !== -1;
    }

    // The legend lists only statuses currently on the map.
    pointLayers.forEach(function (layer) {
      layer.on("change:visible", function () {
        renderLegend();
      });
    });

    // ---- Point symbology ----------------------------------------------------
    // Bertin: at nine pixels the only visual variables that survive are hue and
    // lightness. The old dots told the statuses apart with dash patterns, which
    // do not exist at that size. Now: SK solid yellow; duplikat yellow with an
    // orange rim; belum a pale disc with a heavy slate rim (still nothing yellow
    // — it must never read as one more surveyed unit); cadangan grey.
    var DOT_FILL = {
      sk: "#efb32a",
      duplikat: "#efb32a",
      belum: "#f4f6f8",
      cadangan: "#c5cdd6"
    };
    var DOT_STROKE = {
      sk: { color: INK, width: 1.6 },
      duplikat: { color: "#e8731a", width: 2.2 },
      belum: { color: "#6b7a8c", width: 2.2 },
      cadangan: { color: INK, width: 1.4 }
    };
    // Belum/duplikat above SK so an estimate between its siblings stays seen.
    var DOT_Z = { sk: 1, duplikat: 2, belum: 2, cadangan: 1 };

    // 5px at the province extent, growing to 7px where the pins take over, so
    // the dot→pin handoff is a step of one size rather than a jump of four.
    function dotRadiusFor(resolution) {
      var t = (430 - resolution) / (430 - PIN_MAX_RESOLUTION_260331_4);
      t = Math.max(0, Math.min(1, t));
      return Math.round((5 + 2 * t) * 2) / 2;
    }

    var dotStyleCache = {};
    function dotStyleAt(kind, radius) {
      var key = kind + "|" + radius;
      if (!dotStyleCache[key]) {
        dotStyleCache[key] = [
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: radius,
              fill: new ol.style.Fill({ color: DOT_FILL[kind] }),
              stroke: new ol.style.Stroke(DOT_STROKE[kind])
            }),
            zIndex: DOT_Z[kind]
          })
        ];
      }
      return dotStyleCache[key];
    }

    function pinStyleFor(kind) {
      if (kind === "cadangan") {
        return cadanganPinStyle;
      }
      if (kind === "belum") {
        return belumPinStyle;
      }
      if (kind === "duplikat") {
        return duplikatPinStyle;
      }
      return pinStyle_260331_4;
    }

    function singleStyle(item, resolution) {
      var kind = itemKind(item);
      return resolution > PIN_MAX_RESOLUTION_260331_4
        ? dotStyleAt(kind, dotRadiusFor(resolution))
        : pinStyleFor(kind);
    }

    // Padding for every fit: clears the panel on the left and the chips on the
    // right, with enough air that the outermost pin is not kissing an edge.
    // On phones the panel is a bottom sheet instead, so the reserve moves to
    // the bottom edge (the peek height comes from the stylesheet).
    function fitPadding() {
      if (window.innerWidth < 960) {
        var peek =
          parseInt(
            getComputedStyle(document.body).getPropertyValue("--sheet-peek"),
            10
          ) || 240;
        return [52, 32, peek + 48, 32];
      }
      return [55, 78, 55, panelInset() + 78];
    }

    // ---- Hover --------------------------------------------------------------
    // qgis2web's own hover (doHover/doHighlight) is off; the only feedback a
    // pin gave was the cursor. Two things now: the symbol grows a step on its
    // own overlay, and a label names the point above it — the same dark pill
    // as the control tooltips. Pointer devices only; a finger never hovers.
    var HOVER_SCALE = 1.12;
    // Rendered pin heights (CSS px, scale 1). The tip has to clear the head.
    var PIN_HEIGHT = { sk: 32, duplikat: 34, belum: 35, cadangan: 32 * 0.86 };

    var hoverSource = new ol.source.Vector({ useSpatialIndex: false });
    var hoverLayer = new ol.layer.Vector({
      map: window.map,
      source: hoverSource,
      style: hoverStyle,
      zIndex: 4
    });

    var hoverTipEl = document.createElement("div");
    hoverTipEl.className = "pin-tip";
    hoverTipEl.setAttribute("aria-hidden", "true");
    var hoverTip = new ol.Overlay({
      element: hoverTipEl,
      positioning: "bottom-center",
      offset: [0, -10],
      stopEvent: false,
      insertFirst: false
    });
    window.map.addOverlay(hoverTip);
    var hoveredFeature = null;

    var hoverPinCache = {};
    function hoverPinStyle(kind) {
      if (!hoverPinCache[kind]) {
        var image = pinStyleFor(kind)[0].getImage().clone();
        var scale = image.getScale();
        image.setScale((typeof scale === "number" ? scale : 1) * HOVER_SCALE);
        hoverPinCache[kind] = [new ol.style.Style({ image: image, zIndex: 5 })];
      }
      return hoverPinCache[kind];
    }

    // The ghost on the hover overlay carries its item, so the style needs no
    // lookup and cannot disagree with the layer underneath about the status.
    function hoverStyle(feature, resolution) {
      var item = feature.get("item");
      if (!item) {
        return null;
      }
      var kind = itemKind(item);
      return resolution > PIN_MAX_RESOLUTION_260331_4
        ? dotStyleAt(kind, dotRadiusFor(resolution) + 2)
        : hoverPinStyle(kind);
    }

    function truncateLabel(text, max) {
      var value = String(text || "").trim();
      return value.length > max ? value.slice(0, max - 1).trim() + "…" : value;
    }

    function hoverLabel(item) {
      var title = truncateLabel(item.display.primary, 34);
      return "Titik " + item.display.code + (title ? " · " + title : "");
    }

    function hoverTipOffset(item, resolution) {
      if (resolution > PIN_MAX_RESOLUTION_260331_4) {
        return -(dotRadiusFor(resolution) + 2 + 8);
      }
      return -(PIN_HEIGHT[itemKind(item)] * HOVER_SCALE + 6);
    }

    function hideHoverTip() {
      hoverTipEl.classList.remove("is-visible");
      hoverTip.setPosition(undefined);
    }

    function setHover(feature) {
      if (feature === hoveredFeature) {
        return;
      }
      hoveredFeature = feature;
      hoverSource.clear();
      if (!feature) {
        hideHoverTip();
        return;
      }
      var item = featureLookup.get(feature);
      // The selected point already has the card saying everything the tip
      // would, and its own enlarged pin on the feature overlay.
      if (!item || item.id === activeItemId) {
        hideHoverTip();
        return;
      }
      hoverSource.addFeature(
        new ol.Feature({ geometry: feature.getGeometry(), item: item })
      );
      var resolution = window.map.getView().getResolution();
      hoverTipEl.textContent = hoverLabel(item);
      hoverTip.setOffset([0, hoverTipOffset(item, resolution)]);
      hoverTip.setPosition(feature.getGeometry().getCoordinates());
      hoverTipEl.classList.remove("is-visible");
      requestAnimationFrame(function () {
        if (hoveredFeature === feature) {
          hoverTipEl.classList.add("is-visible");
        }
      });
    }

    if (
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      window.map.on("pointermove", function (evt) {
        if (evt.dragging) {
          setHover(null);
          return;
        }
        var original = evt.originalEvent;
        if (original && original.pointerType && original.pointerType !== "mouse") {
          return;
        }
        var hit = window.map.forEachFeatureAtPixel(
          evt.pixel,
          function (feature) {
            return feature;
          },
          { layerFilter: isPointLayer, hitTolerance: 3 }
        );
        setHover(hit || null);
      });
      window.map.getViewport().addEventListener("pointerleave", function () {
        setHover(null);
      });
    }

    // ---- Selection pulse ----------------------------------------------------
    // One-shot: two rings run out from the pin's tip when a point is chosen,
    // then stop. A permanent pulse would mean re-rendering every layer at 60fps
    // for as long as the card is open; 1.4s of that on selection is the
    // "landed here" cue at a price that ends.
    var PULSE_DURATION = 1400;
    var pulse = null;
    var reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function startSelectionPulse(coordinate) {
      if (reduceMotion) {
        return;
      }
      pulse = { coordinate: coordinate, start: Date.now() };
      window.map.render();
    }

    // On the managed SK layer, so the rings draw under the selected pin
    // (feature overlay, unmanaged, always on top) — a ring on the ground, not
    // a ring over the marker.
    window.lyr_260331_4.on("postrender", function (event) {
      if (!pulse) {
        return;
      }
      var elapsed = Date.now() - pulse.start;
      if (elapsed > PULSE_DURATION) {
        pulse = null;
        return;
      }
      var context = ol.render.getVectorContext(event);
      var point = new ol.geom.Point(pulse.coordinate);
      for (var k = 0; k < 2; k++) {
        var t = elapsed / 800 - k * 0.45;
        if (t < 0 || t > 1) {
          continue;
        }
        var eased = 1 - Math.pow(1 - t, 3);
        context.setStyle(
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: 10 + 24 * eased,
              stroke: new ol.style.Stroke({
                color: "rgba(254, 229, 15, " + (0.6 * (1 - t)).toFixed(3) + ")",
                width: 2.5
              })
            })
          })
        );
        context.drawGeometry(point);
      }
      window.map.render();
    });

    // ---- Legend -------------------------------------------------------------
    // The statuses are told apart by colour on the map, and the only key to
    // those colours used to be inside the layer panel, one click away. A
    // legend that has to be opened is not a legend. This one lists only the
    // statuses currently on the map.
    // Band (positioned, pointer-transparent) + pill (the visible object). The
    // band's left/right edges are the panel and the scale/attribution block,
    // and the pill centres between them — see .map-legend in custom.css.
    var legendEl = document.createElement("div");
    legendEl.className = "map-legend";
    var legendPill = document.createElement("div");
    legendPill.className = "map-legend__pill";
    legendPill.setAttribute("role", "list");
    legendPill.setAttribute("aria-label", "Legenda simbol peta");
    legendEl.appendChild(legendPill);
    document.querySelector(".atlas-map-footer").prepend(legendEl);

    var LEGEND_LABEL = {
      sk: "Titik PJUTS",
      belum: STATUS_LABEL.belum.legend,
      duplikat: STATUS_LABEL.duplikat.legend,
      cadangan: STATUS_LABEL.cadangan.legend
    };
    // Phones: the pill must stay one row (see .map-legend__pill in the
    // mobile block of custom.css), so each entry carries a short label too
    // and CSS shows one or the other. Only the visible one is read aloud.
    var LEGEND_LABEL_SHORT = {
      sk: "Titik PJUTS",
      belum: STATUS_LABEL.belum.short,
      duplikat: STATUS_LABEL.duplikat.short,
      cadangan: STATUS_LABEL.cadangan.short
    };

    function legendSwatch(kind) {
      var stroke = DOT_STROKE[kind];
      return (
        '<svg class="map-legend__swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
        '<circle cx="7" cy="7" r="5" fill="' + DOT_FILL[kind] + '" stroke="' +
        stroke.color + '" stroke-width="' + stroke.width + '"/></svg>'
      );
    }

    function renderLegend() {
      var counts = { sk: 0, belum: 0, duplikat: 0, cadangan: 0 };
      mappedItems.forEach(function (item) {
        if (isItemShown(item)) {
          counts[itemKind(item)]++;
        }
      });
      var html = "";
      ["sk", "belum", "duplikat", "cadangan"].forEach(function (kind) {
        if (!counts[kind]) {
          return;
        }
        html +=
          '<span class="map-legend__item" role="listitem">' +
          legendSwatch(kind) +
          '<span class="map-legend__label map-legend__label--long">' +
          LEGEND_LABEL[kind] + "</span>" +
          '<span class="map-legend__label map-legend__label--short">' +
          LEGEND_LABEL_SHORT[kind] + "</span></span>";
      });
      legendPill.innerHTML = html;
      legendEl.hidden = !(counts.sk || counts.belum || counts.duplikat || counts.cadangan);
    }
    renderLegend();

    pointsRedrawHook = function () {
      // A filtered-out point may be the one under the pointer.
      setHover(null);
      renderLegend();
    };

    // ---- Popup scroll hint --------------------------------------------------
    // qgis2web caps #popup-content at 70vh and scrolls it; on a Mac with
    // overlay scrollbars nothing says so, and the last row ("Arsir", "Duplikat"
    // on the dev server; the route button on shorter screens) simply looked cut
    // in half. A sticky fade at the foot of whichever element scrolls (the
    // content on desktop, the whole card on mobile) says "more below", and
    // lifts once the user gets there.
    var popupScrollFade = document.createElement("div");
    popupScrollFade.className = "popup-scroll-fade";
    popupScrollFade.setAttribute("aria-hidden", "true");

    function popupScroller() {
      return isMobileViewport() ? popup : popupContent;
    }

    function updatePopupScrollHint() {
      var scroller = popupScroller();
      var canScroll = scroller.scrollHeight - scroller.clientHeight > 4;
      var atEnd =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      popup.classList.toggle("is-scrollable", canScroll);
      popup.classList.toggle("is-scroll-end", atEnd);
    }

    // Called after each innerHTML rebuild: the fade lives inside the scroller
    // (position: sticky needs that) so it is wiped with the content.
    function syncPopupScrollHint() {
      popupScroller().appendChild(popupScrollFade);
      updatePopupScrollHint();
    }

    if (popup && popupContent) {
      popup.addEventListener("scroll", updatePopupScrollHint, { passive: true });
      popupContent.addEventListener("scroll", updatePopupScrollHint, { passive: true });
    }

    function fitToVisible(options) {
      var config = options || {};
      var extent = null;

      mappedItems.forEach(function (item) {
        if (!visibleIds.has(item.id)) {
          return;
        }
        var e = item.feature.getGeometry().getExtent();
        extent = extent
          ? [
              Math.min(extent[0], e[0]),
              Math.min(extent[1], e[1]),
              Math.max(extent[2], e[2]),
              Math.max(extent[3], e[3])
            ]
          : e.slice();
      });

      if (!extent) {
        return;
      }

      // Details may just have closed and a previous point-focus animation
      // may still be running. Fit once against the current canvas geometry.
      window.map.updateSize();
      var view = window.map.getView();
      if (view.getAnimating()) view.cancelAnimations();
      view.fit(extent, {
        // Reserves the panel's real footprint (fitPadding), otherwise the
        // westernmost points land underneath it.
        padding: fitPadding(),
        maxZoom: config.maxZoom || 15,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : config.duration === undefined ? 700 : config.duration
      });
    }

    // Horizontal space the data panel steals from the map (0 when it is a
    // bottom sheet or collapsed).
    function panelInset() {
      if (window.innerWidth < 960) {
        return 0;
      }
      if (document.body.classList.contains("is-sidebar-collapsed")) {
        return 0;
      }
      var panel = document.getElementById("sidebar");
      return panel ? Math.max(0, Math.round(panel.getBoundingClientRect().right - document.getElementById("map").getBoundingClientRect().left)) : 0;
    }

    function setActiveGroup(name, options) {
      var config = options || {};
      clearTimeout(searchDebounce);
      // Remember the row we are leaving so Back can hand focus straight back
      // to it — innerHTML wiping destroys the node the user just activated.
      restoreFocusGroup = name ? null : activeGroup;
      activeGroup = name || null;
      // Screen 1's status counts open the group already narrowed to them.
      statusFilter = activeGroup && config.filter ? config.filter : null;
      // A query typed on one screen must not leak onto the other.
      searchInput.value = "";
      clearSelection();
      renderList("");
      // The scroller is shared by both screens, so a list scrolled to reach a
      // pengusul near the bottom would otherwise open that group mid-list.
      // Going back, moveFocusForScreen brings the row we left back into view.
      var scroller = document.querySelector(".sidebar-scroll");
      if (scroller && activeGroup) {
        scroller.scrollTop = 0;
      }
      if (!document.body.classList.contains("is-sidebar-collapsed") && (!isMobileViewport() || document.body.classList.contains("is-panel-open"))) moveFocusForScreen();
      if (config.fit !== false) {
        fitToVisible({ maxZoom: activeGroup ? 14 : 15 });
      }
    }

    // preventScroll is load-bearing on mobile, not a nicety. The focused
    // control lives inside the bottom sheet; when a point is picked the sheet
    // translates fully off-screen, and a plain focus() makes the browser scroll
    // the document to chase it — dragging the hidden sheet back over the popup.
    function focusWithoutScroll(node) {
      if (!node) {
        return;
      }
      try {
        node.focus({ preventScroll: true });
      } catch (err) {
        node.focus();
      }
    }

    function moveFocusForScreen() {
      if (activeGroup) {
        focusWithoutScroll(document.querySelector(".panel-back"));
        return;
      }
      if (!restoreFocusGroup) {
        return;
      }
      var rows = listContainer.querySelectorAll(".group-row");
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset.groupName === restoreFocusGroup) {
          focusWithoutScroll(rows[i]);
          scrollRowIntoPane(rows[i]);
          break;
        }
      }
      restoreFocusGroup = null;
    }

    function fitToAllPoints() {
      clearSelection();
      fitToVisible({ maxZoom: 15 });
    }

    function clickHitsPopup(event) {
      var el = document.getElementById("popup");
      if (!el || el.style.display === "none") {
        return false;
      }
      var oe = event.originalEvent;
      if (!oe) {
        return false;
      }
      var rect = el.getBoundingClientRect();
      var x = oe.clientX;
      var y = oe.clientY;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function handleMapClick(event) {
      if (Date.now() < suppressMapClickUntil || clickHitsPopup(event)) {
        return;
      }
      // The switcher lives inside the map viewport, so its own clicks also
      // arrive here — don't treat them as map clicks (it would re-close the
      // panel the button just opened, and clear the selection).
      var domTarget = event.originalEvent && event.originalEvent.target;
      if (
        domTarget &&
        domTarget.closest &&
        (domTarget.closest(".layer-switcher") ||
          domTarget.closest(".ol-popup") ||
          domTarget.closest("#popup"))
      ) {
        return;
      }
      // Click-activated layer panel has no auto-close of its own.
      if (window.layerSwitcher) {
        window.layerSwitcher.hidePanel();
      }
      var clickedFeature = window.map.forEachFeatureAtPixel(
        event.pixel,
        function (feature) {
          return feature;
        },
        { layerFilter: isPointLayer, hitTolerance: 4 }
      );

      if (!clickedFeature) {
        clearSelection();
        return;
      }

      var item = featureLookup.get(clickedFeature);
      if (!item) {
        return;
      }

      focusItem(item, { closePanel: true, zoom: 17, coordinate: event.coordinate });
    }

    var searchDebounce;
    searchInput.addEventListener("input", function (event) {
      var value = event.target.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        clearSelection();
        renderList(value);
        if (!isMobileViewport() && value) setSidebarCollapsed(false);
        // Search now narrows the map too, so bring the survivors into view
        // instead of leaving the user staring at an empty viewport.
        fitToVisible({ maxZoom: 16, duration: 500 });
      }, 250);
    });

    var searchClear = document.getElementById("list-search-clear");
    if (searchClear) {
      searchClear.addEventListener("click", function () {
        clearSelection();
        // Kill the pending debounce first: without this a clear that lands
        // within 250ms of the last keystroke gets overwritten by the stale
        // term the timer is still holding.
        clearTimeout(searchDebounce);
        searchInput.value = "";
        searchInput.focus();
        renderList("");
        fitToVisible({ maxZoom: 16, duration: 500 });
      });
    }

    fitButton.addEventListener("click", function () {
      clearTimeout(searchDebounce);
      searchInput.value = "";
      setActiveGroup(null);
      if (window.innerWidth < 960) {
        setPanelOpen(false);
      }
    });

    // Grouping toggle: Pengusul (default) <-> Kabupaten/Kota
    var groupModeButtons = Array.prototype.slice.call(
      document.querySelectorAll(".group-mode__btn")
    );

    function applyGroupMode(mode) {
      if (mode === groupMode) {
        return;
      }
      groupMode = mode;
      groupedItems = buildGroupedItems(groupMode);
      activeGroup = null;
      statusFilter = null;
      groupModeButtons.forEach(function (btn) {
        var on = btn.getAttribute("data-mode") === mode;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      renderList(searchInput.value);
    }

    groupModeButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyGroupMode(btn.getAttribute("data-mode"));
      });
    });

    // Keep the OpenLayers canvas filling its container while the sidebar
    // slides in/out (the map needs updateSize() after the box resizes).
    function refreshMapSizeDuring(duration) {
      var start = null;
      function step(timestamp) {
        if (window.map && typeof window.map.updateSize === "function") {
          window.map.updateSize();
        }
        if (start === null) {
          start = timestamp;
        }
        if (timestamp - start < duration) {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    }

    // Desktop: collapse the sidebar to a full-width map (mobile keeps its modal).
    function setSidebarCollapsed(collapsed) {
      if (!collapsed && window.layerSwitcher) window.layerSwitcher.hidePanel();
      document.body.classList.toggle("is-sidebar-collapsed", collapsed);
      var sidebarNode = document.getElementById("sidebar");
      if (sidebarNode) sidebarNode.inert = collapsed && !isMobileViewport();
      document.getElementById("atlas-home").classList.toggle("is-active", collapsed);
      if (panelToggle) {
        panelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        panelToggle.setAttribute("aria-label", collapsed ? "Buka daftar titik" : "Tutup daftar titik");
        panelToggle.setAttribute(
          "data-tooltip",
          collapsed ? "Tampilkan panel" : "Sembunyikan panel"
        );
      }
      refreshMapSizeDuring(380);
    }

    if (panelToggle) {
      panelToggle.addEventListener("click", function () {
        if (window.innerWidth >= 960) {
          setSidebarCollapsed(
            !document.body.classList.contains("is-sidebar-collapsed")
          );
        } else {
          setPanelOpen(!document.body.classList.contains("is-panel-open"));
        }
      });

      if (window.innerWidth >= 960) setSidebarCollapsed(true);
    }

    if (panelClose) {
      panelClose.addEventListener("click", function () {
        if (isMobileViewport()) setPanelOpen(false);
        else setSidebarCollapsed(true);
        panelToggle.focus({ preventScroll: true });
      });
    }

    // The mobile sheet is dragged, not tapped: it tracks the finger and snaps
    // on release. Click stays bound because Enter/Space on the handle
    // synthesises one — without it the sheet is unreachable by keyboard.
    var sheetHandle = document.getElementById("sheet-handle");
    var sheet = document.getElementById("sidebar");
    if (sheetHandle && sheet) {
      var TAP_SLOP = 6; // px of travel before a press counts as a drag
      var COMMIT_RATIO = 0.25; // share of the travel that commits the new state
      var FLING = 0.4; // px/ms that commits regardless of distance
      var drag = null;
      var suppressClick = false;

      // Measured live: --sheet-peek drops to 122px in landscape.
      function sheetTravel() {
        var peek = parseFloat(
          getComputedStyle(document.body).getPropertyValue(
            "--sheet-peek"
          )
        );
        return Math.max(sheet.offsetHeight - (peek || 0), 1);
      }

      function endDrag(commit) {
        if (!drag) {
          return;
        }
        var open = drag.wasOpen;
        if (commit) {
          var moved = drag.y - drag.from;
          if (Math.abs(drag.velocity) > FLING) {
            open = drag.velocity < 0;
          } else if (Math.abs(moved) > drag.travel * COMMIT_RATIO) {
            open = moved < 0;
          }
        }
        drag = null;
        // Order matters: the transition has to be back before the inline
        // transform clears, or the sheet jumps to its resting spot.
        document.body.classList.remove("is-sheet-dragging");
        sheet.style.transform = "";
        setPanelOpen(open);
      }

      sheetHandle.addEventListener("pointerdown", function (event) {
        if (!event.isPrimary) {
          return;
        }
        // A finger on the handle ends the demonstration at once: the nudge
        // keyframes would otherwise outrank the drag's inline transform.
        stopSheetHints();
        var travel = sheetTravel();
        var wasOpen = document.body.classList.contains("is-panel-open");
        drag = {
          id: event.pointerId,
          startY: event.clientY,
          lastY: event.clientY,
          lastT: event.timeStamp,
          velocity: 0,
          travel: travel,
          wasOpen: wasOpen,
          from: wasOpen ? 0 : travel,
          y: wasOpen ? 0 : travel,
          moved: false
        };
        sheetHandle.setPointerCapture(event.pointerId);
      });

      sheetHandle.addEventListener("pointermove", function (event) {
        if (!drag || event.pointerId !== drag.id) {
          return;
        }
        var dy = event.clientY - drag.startY;
        if (!drag.moved) {
          if (Math.abs(dy) < TAP_SLOP) {
            return;
          }
          drag.moved = true;
          document.body.classList.add("is-sheet-dragging");
        }
        var dt = event.timeStamp - drag.lastT;
        if (dt > 0) {
          drag.velocity = (event.clientY - drag.lastY) / dt;
        }
        drag.lastY = event.clientY;
        drag.lastT = event.timeStamp;
        drag.y = Math.min(Math.max(drag.from + dy, 0), drag.travel);
        sheet.style.transform = "translate3d(0, " + drag.y + "px, 0)";
      });

      sheetHandle.addEventListener("pointerup", function (event) {
        if (!drag || event.pointerId !== drag.id) {
          return;
        }
        // Touch fires a click after the drag; that must not re-toggle.
        suppressClick = drag.moved;
        endDrag(suppressClick);
      });

      sheetHandle.addEventListener("pointercancel", function (event) {
        if (drag && event.pointerId === drag.id) {
          endDrag(false);
        }
      });

      sheetHandle.addEventListener("click", function () {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        setPanelOpen(!document.body.classList.contains("is-panel-open"));
      });
    }

    // Focusing search from the peek sheet expands it so results are visible.
    searchInput.addEventListener("focus", function () {
      if (window.innerWidth < 960) {
        setPanelOpen(true);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") {
        return;
      }
      // Mid-search, Escape means "drop what I typed", not "close the panel":
      // the list and the map go back to the unfiltered set, focus stays put.
      if (document.activeElement === searchInput && searchInput.value) {
        clearTimeout(searchDebounce);
        searchInput.value = "";
        renderList("");
        fitToVisible({ maxZoom: 16, duration: 500 });
        return;
      }
      if (window.layerSwitcher) {
        window.layerSwitcher.hidePanel();
      }
      if (document.body.classList.contains("is-popup-open")) {
        clearSelection();
      } else {
        setPanelOpen(false);
      }
    });

    window.addEventListener("resize", function () {
      configurePopupOverlayForViewport();
      if (activeItemId) {
        var resizedItem = mappedItems.find(function (item) { return item.id === activeItemId; });
        if (resizedItem) openPopupForItem(resizedItem);
      }
      if (window.innerWidth >= 960) {
        setPanelOpen(false);
        setSidebarCollapsed(document.body.classList.contains("is-sidebar-collapsed"));
      } else {
        document.body.classList.remove("is-sidebar-collapsed");
        document.getElementById("sidebar").inert = false;
        setPanelOpen(document.body.classList.contains("is-panel-open"));
      }
      window.map.updateSize();
      if (!activeItemId) fitToVisible({ maxZoom: 15, duration: 0 });
    });

    configurePopupOverlayForViewport();

    // Override qgis2web's closer so it also clears the map selection & sidebar highlight
    var popupCloser = document.getElementById("popup-closer");
    if (popupCloser) {
      popupCloser.onclick = function (e) {
        e.preventDefault();
        clearSelection();
        popupCloser.blur();
        return false;
      };
    }

    // Bind to "click", not "singleclick": OpenLayers defers singleclick behind a
    // hardcoded 250ms timeout so it can tell a single tap from a double one, and
    // since the popup is the only visible response to tapping a pin, that wait
    // was the entire interaction latency (INP 248ms, of which 245ms was the
    // timeout doing nothing). Both events are dispatched from the same
    // emulateClick_ path under the same !dragging_ guard, so panning the map
    // still won't open a popup.
    //
    // The trade is that a double-click now runs this twice and would also zoom,
    // so DoubleClickZoom has to go. Nothing here listens for dblclick, and
    // scroll, pinch, and the zoom buttons all still zoom.
    window.map
      .getInteractions()
      .getArray()
      .slice()
      .forEach(function (interaction) {
        if (interaction instanceof ol.interaction.DoubleClickZoom) {
          window.map.removeInteraction(interaction);
        }
      });

    window.map.on("click", handleMapClick);

    // Keep popup in view after user zooms/pans — re-trigger autoPan
    // (skip on mobile: popup is position:fixed and no longer anchored to
    // the feature, so panIntoView would fight our intentional offset)
    var panGuard = false;
    window.map.on("moveend", function () {
      if (panGuard) {
        panGuard = false;
        return;
      }
      if (Date.now() < mapFocusAnimUntil) {
        return;
      }
      if (isMobileViewport()) {
        return;
      }
      if (window.overlayPopup && window.overlayPopup.getPosition()) {
        panGuard = true;
        window.overlayPopup.panIntoView({
          animation: { duration: 300 },
          margin: 60
        });
      }
    });

    initAtlasControls();
    if (isMobileViewport()) {
      document.body.classList.remove("is-sidebar-collapsed");
      setPanelOpen(false);
    }
    renderList("");
    renderFooter();

    // qgis2web's start view fits the bare province bbox to the full map size,
    // so the westernmost points (Kerinci, Merangin, Bungo) open underneath the
    // panel — the reader's first impression is a coverage map with a quarter
    // missing. Refit to the points with the panel reserved. Instant: the data
    // has only just arrived, there is no "before" worth animating from.
    fitToVisible({ maxZoom: 15, duration: 0 });

    // The sheet's "pull me up" demonstration waits for a drawn map, so the
    // lift reads as part of the page settling rather than a glitch mid-load.
    // The timer is the fallback for a slow tile server.
    var hintsStarted = false;
    function kickSheetHints() {
      if (hintsStarted) {
        return;
      }
      hintsStarted = true;
      startSheetHints();
    }
    window.map.once("rendercomplete", function () {
      setTimeout(kickSheetHints, 600);
    });
    setTimeout(kickSheetHints, 3000);
    }

    // Data titik dimuat async dari data/points.geojson — jalankan init
    // begitu fitur selesai dimuat (atau langsung kalau sudah ada).
    function runInit() {
      if (hasInitialised) {
        return;
      }
      if (!pointSource.getFeatures().length) {
        return;
      }
      hasInitialised = true;
      disarmWatchdog();
      setDataControlsDisabled(false);
      init();
    }

    pointSource.on("featuresloaderror", function () {
      failDataLoad(
        "File data/points.geojson gagal dimuat. Periksa path, format GeoJSON, dan koneksi server."
      );
    });

    // featuresloadend can fire more than once (a retry re-runs the loader), so
    // listen continuously rather than once — a late success must still be able
    // to replace a previously shown error.
    pointSource.on("featuresloadend", runInit);

    showDataLoading();
    armWatchdog();
    runInit();
  });
})();
