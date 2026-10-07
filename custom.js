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
    var queryWords = searchWords(normalizedQuery);
    var hasRtNumber = queryWords.some(function (word) {
      return RT_WORD.test(word);
    });
    // A plain substring would let "rt 3" through on "RT 34" and "RT 31".
    if (!hasRtNumber && item.searchText.indexOf(normalizedQuery) !== -1) {
      return true;
    }
    if (!queryWords.length) {
      return false;
    }
    if (item.searchWordsFor !== item.searchText) {
      item.searchWords = searchWords(item.searchText);
      item.searchWordsFor = item.searchText;
    }
    return queryWords.every(function (word) {
      return item.searchWords.some(function (candidate) {
        return RT_WORD.test(word) ? candidate === word : candidate.indexOf(word) === 0;
      });
    });
  }

  // The fallback when the query is not one run of the row's text: word by
  // word, in any order, so "kasang rt 3" finds the row titled "RT 03 Kasang".
  // Punctuation splits words ("Rt.05", "Jl.Pondok"), RT/RW numbers lose their
  // leading zeros, and a word only has to start a word of the row ("kasa"
  // finds Kasang). An RT number must match whole, or "rt 1" would also list
  // RT 10 to RT 19.
  var RT_WORD = /^r[tw]\d+$/;

  function searchWords(value) {
    return String(value || "")
      .replace(/\b(r[tw])[\s.]*0*(\d+)/g, "$1$2")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
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
    // Merangin", "Ketua RT 21", "<nama> ADC".
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
  // bookkeeping in brackets — "(Foto pertama yang dikirim pak <nama>)",
  // "(Tanpa Foto (Tempat Pemandian 1,2,3))". That says nothing about the place
  // and wraps the label onto five lines, so it goes. Brackets that qualify the
  // landmark itself are kept: "Depan Rumah Pak <nama> (Dewan)" survives.
  //
  // The lookahead only fires when the bracket's own text mentions the photo
  // workflow; everything from that bracket to the end is then dropped, which
  // also disposes of nested brackets in one pass.
  var SURVEY_NOTE = /\s*\((?=[^)]*(?:foto|dikirim))[\s\S]*$/i;

  // One Kerinci surveyor pasted their GPS app's log in wholesale — "Titik (1)
  // — Survey Pemasangan PUTS; alamat GPS: Kemantan Darat; Jumat, 19 Juni 2026
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

  // "RT 11" / "Rt.05" / "RT 01 RW 03" is an address detail, not a place: 57
  // rows carry one as their entire Keterangan and ten collide on "RT 12"
  // alone. On its own it cannot be the title, so it is joined to the desa —
  // "RT 11 Bedaro Rampak" — the same shape the surveyors themselves wrote as
  // "RT 21 Rawasari", and the RT stays visible in the list.
  var BARE_RT = /^rt[\s.]*\d+(?:[\s,]*rw[\s.]*\d+)?$/i;

  function formatRt(text) {
    return text
      .replace(/^rt[\s.]*(\d+)/i, "RT $1")
      .replace(/[\s,]*rw[\s.]*(\d+)$/i, " RW $1");
  }

  // Loose "does a already say b": case and punctuation ignored, whole words.
  function saysAlready(text, part) {
    var key = function (value) {
      return " " + String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    };
    return key(text).indexOf(key(part)) !== -1;
  }

  // Nomor is "KABUPATEN-KECAMATAN-DESA-NNN". The desa repeats across most of a
  // group's points (223/230 rows would be identical on desa alone), so the
  // survey landmark in Keterangan is the primary label whenever it exists and
  // the desa drops to context. Every row also carries its coordinate so a
  // unique landmark does not hide the pin's position.
  //
  // A point granted under a line of the allocation sheet (REKAPAN PJUTS 2026,
  // written into the geojson by scripts/apply_rekapan.py, now archived on
  // backup/tampil-pengusul because it names the proposers) takes that line as
  // its title instead, verbatim: it is what the field crew holds in hand and
  // searches for. The survey's own landmark and whatever part of the desa and
  // kecamatan the line does not already say drop to the second line.
  function buildDisplayParts(nomor, keterangan, rekapan) {
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
    var sheetLine = String(rekapan || "").trim();

    var primary;
    var secondary;

    if (sheetLine) {
      var note = landmark && BARE_RT.test(landmark) ? formatRt(landmark) : landmark;
      var said = [sheetLine];
      primary = sheetLine;
      secondary = [note, desa, kecamatan]
        .filter(function (part) {
          if (!part || said.some(function (text) { return saysAlready(text, part); })) {
            return false;
          }
          said.push(part);
          return true;
        })
        .join(" · ");
    } else if (landmark && BARE_RT.test(landmark)) {
      primary = [formatRt(landmark), desa].filter(Boolean).join(" ");
      secondary = kecamatan || "Lokasi survey lapangan";
    } else if (landmark) {
      primary = landmark;
      secondary = [desa, kecamatan].filter(Boolean).join(" · ") || "Lokasi survey lapangan";
    } else {
      primary = desa || String(nomor || "Titik");
      secondary = kecamatan || "Lokasi survey lapangan";
    }

    return {
      code: code || "—",
      primary: primary,
      secondary: secondary,
      // True when the title already carries the Keterangan, so the popup
      // (which has no second line) does not repeat it as a meta row.
      showsKeterangan: Boolean(landmark) && saysAlready(
        primary,
        BARE_RT.test(landmark) ? formatRt(landmark) : landmark
      ),
      // Kept separately so the list can section a long group by kecamatan.
      desa: desa,
      kecamatan: kecamatan,
    };
  }

  // What the row shows must be findable as it reads: "RT 11 Bedaro Rampak"
  // is built from two fields that sit apart in the raw text. The desa is also
  // indexed without its spaces, because the surveyors write "Rawasari" for
  // Rawa Sari and "Kenali Asam" both ways.
  function displaySearchText(display) {
    return [
      display.primary,
      display.secondary,
      String(display.desa || "").replace(/\s+/g, "")
    ].join(" ");
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

  // Trailing hint on the route button: says the tap leaves the page.
  var EXTERNAL_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">' +
      '<path d="M7 17 17 7M8 7h9v9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
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
          '<span class="feature-popup__route-icon">' + ROUTE_ICON + "</span>" +
          '<span class="feature-popup__route-text">' +
            "<strong>Rute ke titik ini</strong>" +
            "<small>Buka di Google Maps</small>" +
          "</span>" +
          '<span class="feature-popup__route-ext">' + EXTERNAL_ICON + "</span>" +
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
    if (item.keterangan && !item.display.showsKeterangan) {
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
          // Centred on the photo, where the eye already is: the whole image
          // is the link, and the pill says so in plain words.
          '<span class="feature-popup__media-badge">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
              '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />' +
            "</svg>" +
            "<span>Lihat foto</span>" +
          "</span>" +
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

  function setDataControlsDisabled(isDisabled) {
    ["list-search", "fit-map"].forEach(function (id) {
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
    var meta = document.getElementById("panel-meta");
    if (meta) {
      meta.innerHTML = '<p class="atlas-summary" role="status">Data titik belum tersedia</p>';
    }
  }

  function showDataLoading() {
    var listContainer = document.getElementById("list-data");

    setCountsUnknown();
    setDataControlsDisabled(true);

    if (!listContainer) {
      return;
    }

    // Skeleton bars of uneven width, a title over a subline, so the panel
    // reads as a list settling in rather than one flashing block.
    var html = '<div class="panel-loading" role="status" aria-label="Memuat data titik">' +
      '<p class="panel-loading__note">Memuat titik survey…</p>';
    for (var i = 0; i < 7; i++) {
      html +=
        '<div class="panel-skel-row"><span class="panel-skel" style="width:' + (48 + ((i * 17) % 38)) +
        '%"></span><span class="panel-skel panel-skel--sub" style="width:' + (28 + ((i * 23) % 30)) +
        '%"></span></div>';
    }
    listContainer.innerHTML = html + "</div>";
  }

  function showDataLoadError(message, onRetry) {
    var listContainer = document.getElementById("list-data");

    setCountsUnknown();
    setDataControlsDisabled(true);
    hidePopup();

    if (!listContainer) {
      return;
    }

    var errorNode = document.createElement("div");
    var title = document.createElement("p");
    var copy = document.createElement("p");
    var actions = document.createElement("div");
    var action = document.createElement("button");

    errorNode.className = "panel-empty";
    errorNode.setAttribute("role", "alert");

    title.className = "panel-empty__title";
    title.textContent = "Data titik belum bisa dimuat";

    copy.textContent = message ||
      "Periksa koneksi dan file data/points.geojson, lalu coba lagi.";

    actions.className = "panel-empty__actions";
    action.type = "button";
    action.textContent = onRetry ? "Coba lagi" : "Muat ulang halaman";
    action.addEventListener("click", function () {
      if (onRetry) {
        onRetry();
      } else {
        window.location.reload();
      }
    });

    actions.appendChild(action);
    errorNode.appendChild(title);
    errorNode.appendChild(copy);
    errorNode.appendChild(actions);
    listContainer.replaceChildren(errorNode);
  }

  function isMobileViewport() {
    return window.innerWidth < 960;
  }

  function setPanelOpen(isOpen) {
    if (isOpen && isMobileViewport()) {
      hidePopup();
    }
    document.body.classList.toggle("is-panel-open", isOpen);
    var toggle = document.getElementById("panel-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
    var handle = document.getElementById("sheet-handle");
    if (handle) {
      handle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      handle.title = isOpen
        ? "Ketuk atau geser ke bawah untuk lihat peta"
        : "Ketuk atau geser ke atas untuk lihat daftar";
      var hintLabel = isOpen ? SHEET_HINT_CLOSE : SHEET_HINT_OPEN;
      handle.setAttribute("aria-label", hintLabel);
      var hintText = handle.querySelector(".sheet-handle__text");
      if (hintText) {
        hintText.textContent = hintLabel;
      }
    }
    if (isOpen) {
      // The reader has found the sheet; the nudges have done their job.
      stopSheetHints();
    }
  }

  // Shown as the caption under the grabber and read out as its aria-label;
  // the title keeps the drag gesture available as a hint.
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
  // the handle's grabber and caption call out until the sheet is first
  // touched (or 12s), then hop now and then,
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

  // First-visit map gesture hint (phones only). The sheet has its own cues;
  // nothing told a first-time reader the map itself pinches and pans, and a
  // still satellite image reads as a picture. The map blurs behind a clear
  // layer while a hand shows two fingertips spreading apart, then the layer
  // gets out of the way: it
  // fades after two loops, or at once on the first touch of the map. It never
  // takes the pointer, so it cannot block the very gesture it teaches.
  var GESTURE_HINT_KEY = "puts.gestureHints";
  var GESTURE_HINT_VISITS = 3;
  // Two pinch loops (1.6s each), then gone.
  var GESTURE_HINT_MS = 3300;

  function readGestureHintCount() {
    try {
      return parseInt(window.localStorage.getItem(GESTURE_HINT_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function bumpGestureHintCount() {
    try {
      window.localStorage.setItem(GESTURE_HINT_KEY, String(readGestureHintCount() + 1));
    } catch (e) {
      // Storage disabled: the hint simply shows every visit.
    }
  }

  var GESTURE_HINT_ICON =
    '<svg class="gesture-hint__icon" viewBox="0 0 64 64" width="84" height="84" aria-hidden="true" focusable="false">' +
      // Two fingertips moving apart along a diagonal: the pinch-open.
      '<g class="gesture-hint__track">' +
        '<path d="M19 27 45 9" />' +
      "</g>" +
      '<circle class="gesture-hint__tip gesture-hint__tip--a" cx="27" cy="21.5" r="4.5" />' +
      '<circle class="gesture-hint__tip gesture-hint__tip--b" cx="37" cy="14.5" r="4.5" />' +
      // Hand (Lucide "pointer", ISC), scaled under the fingertips.
      '<g class="gesture-hint__hand" transform="translate(14 22) scale(1.55)">' +
        '<path d="M22 14a8 8 0 0 1-8 8" />' +
        '<path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />' +
        '<path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />' +
        '<path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />' +
        '<path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />' +
      "</g>" +
    "</svg>";

  // Returns whether it showed; onDone runs once the hint has gone.
  function startGestureHint(onDone) {
    if (!isMobileViewport() || readGestureHintCount() >= GESTURE_HINT_VISITS) {
      return false;
    }
    var body = document.body;
    if (body.classList.contains("is-panel-open") || body.classList.contains("is-popup-open")) {
      return false;
    }
    var mapEl = document.getElementById("map");
    if (!mapEl) {
      return false;
    }
    bumpGestureHintCount();

    var hint = document.createElement("div");
    hint.className = "gesture-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.innerHTML =
      GESTURE_HINT_ICON +
      '<p class="gesture-hint__title">Cubit untuk memperbesar</p>' +
      '<p class="gesture-hint__text">Geser satu jari untuk menjelajah peta</p>';
    document.body.appendChild(hint);

    var gone = false;
    function dismiss() {
      if (gone) {
        return;
      }
      gone = true;
      mapEl.removeEventListener("pointerdown", dismiss, true);
      hint.classList.remove("is-visible");
      setTimeout(function () {
        if (hint.parentNode) {
          hint.parentNode.removeChild(hint);
        }
        if (onDone) {
          onDone();
        }
      }, 400);
    }

    // Next frame, so the fade-in has a starting state to run from.
    requestAnimationFrame(function () {
      hint.classList.add("is-visible");
    });
    mapEl.addEventListener("pointerdown", dismiss, true);
    setTimeout(dismiss, GESTURE_HINT_MS);
    return true;
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

  var LAYER_ICON =
    '<svg class="ctl-layers" xmlns="http://www.w3.org/2000/svg" ' +
    'viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<path class="ctl-layers__top" d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>' +
    '<path class="ctl-layers__mid" d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>' +
    '<path class="ctl-layers__bottom" d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>' +
    "</svg>";

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
  // where the clipped wave is drawn — usually the trigger itself, but the
  // layer chip has to draw into its sibling overlay because the vendor wipes
  // the button's children on every toggle (see LAYER_ICON note below).
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

  // Layer switches, after Arc UI's Switch (custom.css, .ctl-switch).
  // ol-layerswitcher draws each layer as a bare checkbox and rebuilds the
  // whole panel on every toggle, which would cut any transition off before it
  // starts. So each checkbox is wrapped in a track and thumb after every
  // rebuild, and a switch whose state differs from what it showed after the
  // last rebuild starts where it was and travels. (Read at rebuild time, the
  // old checkbox already says the new state: the click flips it before the
  // change handler rebuilds.) A flip that followed a press already showed the
  // stretch; any other flip gets the brief bump instead, as in Arc UI.
  function decorateLayerSwitches(panel) {
    var shown = {};
    var pressedAt = -Infinity;
    var reduce =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function layerKey(input) {
      var label = input.closest("li").querySelector("label");
      return label ? label.textContent.trim() : "";
    }

    function release() {
      panel.querySelectorAll(".ctl-switch.is-pressed").forEach(function (wrap) {
        wrap.classList.remove("is-pressed");
      });
    }

    function wrapSwitches() {
      var fromPress = performance.now() - pressedAt < 250;
      panel.querySelectorAll("li.layer > input[type='checkbox']").forEach(function (input) {
        var wrap = document.createElement("span");
        var track = document.createElement("span");
        var thumb = document.createElement("span");
        wrap.className = "ctl-switch";
        track.className = "ctl-switch__track";
        track.setAttribute("aria-hidden", "true");
        thumb.className = "ctl-switch__thumb";
        track.appendChild(thumb);
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        wrap.appendChild(track);

        var key = layerKey(input);
        var was = shown[key];
        shown[key] = input.checked;
        if (reduce || was === undefined || was === input.checked) {
          return;
        }
        wrap.classList.add(was ? "is-from-on" : "is-from-off");
        void wrap.offsetWidth;
        wrap.classList.remove("is-from-on", "is-from-off");
        if (!fromPress) {
          thumb.classList.add("is-bumping");
          thumb.addEventListener("animationend", function () {
            thumb.classList.remove("is-bumping");
          }, { once: true });
        }
      });
    }

    panel.addEventListener("rendercomplete", wrapSwitches);

    // The whole row toggles (the label is the checkbox's), so a press
    // anywhere on it stretches its thumb.
    panel.addEventListener("pointerdown", function (event) {
      var li = event.button === 0 && event.target.closest ? event.target.closest("li.layer") : null;
      var wrap = li ? li.querySelector(".ctl-switch") : null;
      if (wrap) {
        wrap.classList.add("is-pressed");
      }
    });
    panel.addEventListener("pointerup", function () {
      if (panel.querySelector(".ctl-switch.is-pressed")) {
        pressedAt = performance.now();
      }
      release();
    });
    panel.addEventListener("pointercancel", release);
    panel.addEventListener("pointerleave", release);
    // Space toggles a checkbox on release; holding it stretches the thumb.
    panel.addEventListener("keydown", function (event) {
      var wrap = event.key === " " && event.target.closest ? event.target.closest(".ctl-switch") : null;
      if (wrap) {
        wrap.classList.add("is-pressed");
      }
    });
    panel.addEventListener("keyup", function (event) {
      if (event.key === " " && panel.querySelector(".ctl-switch.is-pressed")) {
        pressedAt = performance.now();
      }
      release();
    });
    panel.addEventListener("focusout", release);

    wrapSwitches();
  }

  function enhanceMapControls() {
    var shell = document.querySelector(".app-shell");
    var zoom = document.querySelector(".ol-zoom");
    var scale = document.querySelector(".ol-scale-line");
    var attribution = document.querySelector(".bottom-attribution");
    var switcher = document.querySelector(".layer-switcher");

    // qgis2web docks zoom, scale and attribution as three separate fixed
    // boxes held in line by hand-tuned offsets. Re-parent them under one
    // anchor: the rail keeps full chrome, the metadata drops to a flat strip.
    if (shell && (zoom || scale || attribution)) {
      var meta = document.createElement("div");
      meta.className = "map-meta";
      var info = document.createElement("div");
      info.className = "map-meta__info";
      if (zoom) {
        meta.appendChild(zoom);
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
      shell.appendChild(meta);
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
      var watermark = document.createElement("img");
      watermark.className = "layer-switcher__watermark";
      watermark.src = "./assets/logo-esdm.png";
      watermark.alt = "Logo ESDM";
      watermark.draggable = false;
      switcher.appendChild(watermark);
      var switcherButton = switcher.querySelector(":scope > button");
      if (switcherButton) {
        switcherButton.setAttribute("data-tooltip", "Layer peta");
        // aria-label is left alone here — the vendor keeps it in sync with
        // the open/closed state and its tipLabels are already Indonesian.
        stripNativeTitle(switcherButton);
        var slot = document.createElement("span");
        slot.className = "ctl-layers-slot";
        slot.setAttribute("aria-hidden", "true");
        slot.innerHTML = LAYER_ICON;
        switcherButton.insertAdjacentElement("afterend", slot);
        initPressRipple(switcherButton, slot);
      }
      var layerPanel = switcher.querySelector(".panel");
      if (layerPanel) {
        decorateLayerSwitches(layerPanel);
      }
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
    var panelToggle = document.getElementById("panel-toggle");
    var panelClose = document.getElementById("sidebar-close");
    var panelEl = document.getElementById("sidebar");
    var panelTop = document.getElementById("panel-top");
    var panelMeta = document.getElementById("panel-meta");
    var panelSearch = document.querySelector(".panel-search");
    var listScroller = document.querySelector(".sidebar-scroll");
    // The header is rewritten on every screen change; the lambang keeps the
    // cache-busted src index.html gave it.
    var lambangImg = panelTop ? panelTop.querySelector("img") : null;
    var lambangSrc = lambangImg ? lambangImg.getAttribute("src") : "./assets/lambang-jambi.png";
    var popup = document.getElementById("popup");
    var popupContent = document.getElementById("popup-content");

    var activeItemId = null;
    var restorePanelAfterPopup = false;
    var panelScrollBeforePopup = 0;

    // Selected pin: enlarged with a white ring, drawn on the feature overlay
    // above the layer's yellow pin.
    var selectedPinSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="43" viewBox="-2 -4 40 52">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23ffffff" stroke-width="3"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
      '</svg>';
    var pinStyle = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + selectedPinSvg,
        anchor: [0.5, 1],
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
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 36 48">' +
        cadanganHatch +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="url(%23h)" stroke="%23293d50" stroke-width="2"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23ffffff" stroke="%23293d50" stroke-width="1.2"/>' +
      "</svg>";
    var cadanganPinStyle = [new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + cadanganPinSvg,
        anchor: [0.5, 1],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 0.86
      }),
      zIndex: 1
    })];
    var cadanganSelectedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="43" viewBox="-2 -4 40 52">' +
        cadanganHatch +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="url(%23h)" stroke="%23ffffff" stroke-width="3"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
      "</svg>";
    var cadanganPinSelected = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + cadanganSelectedSvg,
        anchor: [0.5, 1],
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
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="-3 -3 42 51">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23293d50" stroke-width="2"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
        duplikatRing +
      "</svg>";
    var duplikatPinStyle = [new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + duplikatPinSvg,
        anchor: [0.5, 1],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 2
    })];
    var duplikatSelectedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="45" viewBox="-4 -6 44 56">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23ffffff" stroke-width="3"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
        duplikatRing +
      "</svg>";
    var duplikatPinSelected = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + duplikatSelectedSvg,
        anchor: [0.5, 1],
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
      '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="35" viewBox="-2 -2 40 52">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23f4f6f8" stroke="%236b7a8c" stroke-width="2.2" stroke-dasharray="4 3"/>' +
        belumGlyph +
      "</svg>";
    var belumPinStyle = [new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + belumPinSvg,
        anchor: [0.5, 1],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        scale: 1
      }),
      zIndex: 2
    })];
    var belumSelectedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="-3 -5 42 54">' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23f4f6f8" stroke="%23ffffff" stroke-width="3"/>' +
        '<path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="none" stroke="%236b7a8c" stroke-width="1.6" stroke-dasharray="4 3"/>' +
        belumGlyph +
      "</svg>";
    var belumPinSelected = new ol.style.Style({
      image: new ol.style.Icon({
        src: "data:image/svg+xml," + belumSelectedSvg,
        anchor: [0.5, 1],
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
        var display = buildDisplayParts(
          nomor,
          keterangan,
          feature.get("Lokasi Rekapan")
        );

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
          display: display,
          searchText: getNormalizedText(
            [
              displaySearchText(display),
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
      return groupMode === "kabupaten" ? "kabupaten" : "pengusul";
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
      var date = footer.querySelector(".sidebar-footer__date");
      if (date) {
        date.textContent = "s.d. " + formatDateKey(latest);
      }
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

    // Only the statuses that still need a decision get a pill. Cadangan
    // tiles are marked in place (the hatch) rather than filtered for.
    var STATUS_FILTERS = ["duplikat", "belum"];

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
      var previous = listContainer.querySelector(".atlas-unit.is-active");
      if (previous) {
        previous.classList.remove("is-active");
      }

      if (!itemId) {
        return;
      }

      var next = listContainer.querySelector('.atlas-pt[data-item-id="' + itemId + '"]');
      if (next) {
        next.querySelector(".atlas-unit").classList.add("is-active");
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
      if (!popup || !popupContent) {
        return 0;
      }

      var ext = item.feature.getGeometry().getExtent();
      var defaultCoord = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
      var coord = coordinate || defaultCoord;

      popupContent.innerHTML = buildPopupHtml(item);
      addPopupInset(item);
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
      // A labelled tray, so the editor-only controls read as a separate tool
      // group rather than as more actions for the field crews.
      var tools = document.createElement("div");
      var label = document.createElement("p");
      var row = document.createElement("div");
      tools.className = "feature-popup__tools";
      label.className = "feature-popup__tools-label";
      label.textContent = "Tandai titik";
      row.className = "feature-popup__tools-row";
      row.appendChild(
        buildFlagButton(item, "cadangan", item.cadangan ? "Batal arsir" : "Arsir", item.cadangan)
      );
      row.appendChild(
        buildFlagButton(
          item,
          "duplikat",
          item.duplikat ? "Batal verifikasi" : "Perlu verifikasi",
          item.duplikat
        )
      );
      tools.appendChild(label);
      tools.appendChild(row);
      body.appendChild(tools);
    }

    var FLAG_ICONS = {
      // Archive box: set aside, not counted.
      cadangan:
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">' +
          '<rect x="3" y="4" width="18" height="5" rx="1.5"/>' +
          '<path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>' +
        "</svg>",
      // Warning triangle: the pin needs checking on site.
      duplikat:
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">' +
          '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' +
          '<path d="M12 9v4M12 17h.01"/>' +
        "</svg>"
    };

    function buildFlagButton(item, flag, label, active) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feature-popup__hatch feature-popup__hatch--" + flag;
      btn.classList.toggle("is-active", Boolean(active));
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.innerHTML = FLAG_ICONS[flag] + "<span>" + escapeHtml(label) + "</span>";
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
          displaySearchText(item.display),
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
      restorePanelAfterPopup = false;
      updateHighlight(activeItemId);

      if (window.collection && typeof window.collection.clear === "function") {
        window.collection.clear();
      }

      if (window.featureOverlay) {
        window.featureOverlay.setStyle(null);
      }

      hidePopup();
    }

    function dismissPopup() {
      var reopenPanel = isMobileViewport() && restorePanelAfterPopup;
      var selectedUnit = listContainer.querySelector(".atlas-unit.is-active");
      var returnRow = selectedUnit ? selectedUnit.closest(".atlas-pt") : null;
      clearSelection();
      if (reopenPanel) {
        setPanelOpen(true);
        // Hiding the sheet's footer can clamp its scroll position while the
        // detail is open. Restore it after the expanded layout is back.
        listScroller.scrollTop = panelScrollBeforePopup;
        focusWithoutScroll(returnRow || document.getElementById("sheet-handle"));
      }
    }

    var FOCUS_EASING = ol.easing.inAndOut;
    var mapFocusAnimUntil = 0;

    function markMapFocusAnimation(duration) {
      mapFocusAnimUntil = Date.now() + duration + 180;
    }

    function getMastheadBottomOffset() {
      var masthead = document.querySelector(".masthead");
      var mapEl = document.getElementById("map");
      if (!masthead || !mapEl) {
        return 80;
      }
      var mapRect = mapEl.getBoundingClientRect();
      var mastheadRect = masthead.getBoundingClientRect();
      return Math.max(0, Math.ceil(mastheadRect.bottom - mapRect.top));
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
        var cardTop = 70;
        var markerGap = 56;
        var pinFloor = size[1] - 40;
        pinTargetY = Math.min(cardTop + (popupHeight || 300) + markerGap, pinFloor);
      } else {
        // The sidebar overlays the map. Centre the pin and its card in the
        // remaining map area, rather than the full canvas underneath it.
        animateCenter[0] -= (panelInset() / 2) * targetResolution;

        // Desktop: popup docks above the pin (bottom: 48px). Guarantee the
        // card top clears the masthead at every desktop height.
        var mastheadBottom = getMastheadBottomOffset();
        var topPadding = 8;
        var pinGap = 48;
        var bottomMargin = 56;
        var popupH = popupHeight || 300;
        var minPinY = mastheadBottom + topPadding + pinGap + popupH;
        var maxPinY = size[1] - bottomMargin;
        var preferredPinY = minPinY + 16;

        if (minPinY > maxPinY) {
          // Cramped viewport: keep the popup top visible even if the pin
          // sits lower than the ideal bottom margin.
          pinTargetY = minPinY;
        } else {
          pinTargetY = Math.min(preferredPinY, maxPinY);
        }
      }

      var offsetPxDown = pinTargetY - size[1] / 2;
      animateCenter[1] = featureCenter[1] + offsetPxDown * targetResolution;
      return animateCenter;
    }

    var popupReframeTimer = null;

    function schedulePopupReframe(delay) {
      clearTimeout(popupReframeTimer);
      popupReframeTimer = setTimeout(function () {
        var item = itemsById[activeItemId];
        if (!item || !document.body.classList.contains("is-popup-open")) {
          return;
        }
        window.map.updateSize();
        var view = window.map.getView();
        view.cancelAnimations();
        markMapFocusAnimation(260);
        view.animate({
          center: getFocusTargetCenter(view, itemCenter(item), view.getZoom(), popup.offsetHeight),
          duration: 260,
          easing: FOCUS_EASING
        });
      }, delay);
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

      // Remember the list's state for this detail session. Selecting another
      // pin while the popup is open must not overwrite the return state.
      if (!document.body.classList.contains("is-popup-open")) {
        restorePanelAfterPopup = isMobileViewport() &&
          document.body.classList.contains("is-panel-open");
      }

      activeItemId = item.id;
      updateHighlight(activeItemId);
      if (restorePanelAfterPopup && !document.body.classList.contains("is-popup-open")) {
        panelScrollBeforePopup = listScroller.scrollTop;
      }

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
        setPanelOpen(false);
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

    // ---- The atlas panel ------------------------------------------------------
    // The list reads as an atlas index (see the Data panel block in custom.css).
    // Screen 1 is a grid with every kabupaten drawn as its own outline and its
    // poles dotted in; screen 2 is one kabupaten: its kecamatan as sticky
    // heads, the desa under them, and each unit as a numbered tile beside its
    // coordinate. The header (renderTop), the counts line (renderMeta) and the
    // list are written on the same pass, so the three never disagree. Every
    // control in them carries a data-action read by one click handler on the
    // panel, because each render replaces the nodes.

    var PANEL_ICONS = {
      back: '<path d="m14.5 6-6 6 6 6"/>',
      frame:
        '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>' +
        '<circle cx="12" cy="12" r="2.2"/>',
      collapse: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/>'
    };

    function panelIcon(name, size) {
      return (
        '<svg class="panel-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size +
        '" aria-hidden="true" focusable="false">' + PANEL_ICONS[name] + "</svg>"
      );
    }

    function collapseButtonHtml() {
      return (
        '<button class="panel-collapse" type="button" data-action="collapse" aria-label="Sembunyikan daftar" title="Sembunyikan daftar">' +
        panelIcon("collapse", 20) + "</button>"
      );
    }

    // "KAB. MERANGIN", "Kab. Merangin" and "Merangin" are one key: the boundary
    // layer's name and the kabupaten resolved onto each point differ in case
    // and prefix.
    function normKey(name) {
      return String(name || "")
        .toUpperCase()
        .replace(/^KAB(UPATEN)?\.?\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Under a "kabupaten/kota" heading the prefix is noise; "Kota" stays
    // because it tells the city from the kabupaten around it.
    function shortName(name) {
      return String(name || "").replace(/^Kab\.\s+/i, "");
    }

    function itemCenter(item) {
      var e = item.feature.getGeometry().getExtent();
      return [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
    }

    var itemsById = {};
    mappedItems.forEach(function (item) {
      itemsById[item.id] = item;
    });

    // Counted units only: a kabupaten's figures, like every count in the panel,
    // leave Cadangan out.
    function groupStats(group) {
      var stats = { count: group.items.length, kecamatan: 0, duplikat: 0, belum: 0 };
      var kecamatan = {};
      group.items.forEach(function (item) {
        if (item.display.kecamatan) {
          kecamatan[item.display.kecamatan] = true;
        }
        if (item.duplikat) {
          stats.duplikat += 1;
        }
        if (item.belum) {
          stats.belum += 1;
        }
      });
      stats.kecamatan = Object.keys(kecamatan).length;
      return stats;
    }

    // ---- Geography for the atlas ----------------------------------------------
    // Outlines come from the boundary layer, dots from the counted units, and
    // both are drawn small: a vertex closer than a fraction of a pixel to the
    // last one kept adds nothing at thumbnail size (ringPath). Paths are cached
    // per size; dots are not, so a unit flagged on the local editor moves
    // between dot kinds on the next render.
    var geo = (function () {
      var polys = {};
      var extent = null;
      kabupatenPolygons.forEach(function (f) {
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
      return extent ? { polys: polys, extent: extent, cache: {} } : null;
    })();

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

    // Belum and duplikat drawn last, so an estimate or a pin to be checked
    // stays seen among its neighbours.
    var DOT_ORDER = { sk: 0, belum: 1, duplikat: 2 };

    function dotsByKabupaten() {
      var out = {};
      items.forEach(function (item) {
        var key = normKey(item.kabupaten);
        (out[key] = out[key] || []).push(item);
      });
      Object.keys(out).forEach(function (key) {
        out[key].sort(function (a, b) {
          return DOT_ORDER[itemKind(a)] - DOT_ORDER[itemKind(b)];
        });
      });
      return out;
    }

    function shapeSvg(key, dots, w, h, r) {
      if (!geo || !geo.polys[key]) {
        return "";
      }
      var geometry = geo.polys[key].getGeometry();
      // Left-aligned, so the outline starts on the same edge as the name.
      var tx = fitTransform(geometry.getExtent(), w, h, r + 1.5, true);
      var ck = "shape|" + key + "|" + w + "x" + h;
      var d = geo.cache[ck] || (geo.cache[ck] = ringPath(ringsOf(geometry), tx, 0.6));
      var circles = (dots || [])
        .map(function (item) {
          var q = tx(itemCenter(item));
          return (
            '<circle class="atlas-dot atlas-dot--' + itemKind(item) + '" cx="' + q[0].toFixed(1) +
            '" cy="' + q[1].toFixed(1) + '" r="' + r + '"/>'
          );
        })
        .join("");
      return (
        '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">' +
        '<path class="atlas-shape" fill-rule="evenodd" d="' + d + '"/>' + circles + "</svg>"
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
            return '<path class="atlas-loc' + (k === activeKey ? " is-on" : "") + '" fill-rule="evenodd" d="' + d + '"/>';
          })
          .join("") +
        "</svg>"
      );
    }

    // The point card's locator: where in the kabupaten this pole stands, the
    // kabupaten's other poles faint around it.
    function insetSvg(key, here) {
      var w = 70;
      var h = 52;
      var geometry = geo.polys[key].getGeometry();
      var tx = fitTransform(geometry.getExtent(), w, h, 4);
      var ck = "inset|" + key;
      var d = geo.cache[ck] || (geo.cache[ck] = ringPath(ringsOf(geometry), tx, 0.5));
      var dots = (dotsByKabupaten()[key] || [])
        .map(function (item) {
          var q = tx(itemCenter(item));
          return '<circle class="popup-inset__dot" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="1.3"/>';
        })
        .join("");
      var at = tx(here);
      var x = at[0].toFixed(1);
      var y = at[1].toFixed(1);
      return (
        '<svg viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false">' +
        '<path class="popup-inset__shape" fill-rule="evenodd" d="' + d + '"/>' + dots +
        '<circle class="popup-inset__here-ring" cx="' + x + '" cy="' + y + '" r="6"/>' +
        '<circle class="popup-inset__here" cx="' + x + '" cy="' + y + '" r="3.2"/></svg>'
      );
    }

    // Built inside openPopupForItem's write, before the card is measured, so
    // the map frames the card at its real height.
    function addPopupInset(item) {
      var key = normKey(item.kabupaten);
      if (!geo || !geo.polys[key] || !popupContent) {
        return;
      }
      var body = popupContent.querySelector(".feature-popup__body");
      var media = popupContent.querySelector(".feature-popup__media");
      if (!body) {
        return;
      }
      var inset = document.createElement("span");
      // No photo (lokasi belum ditetapkan): the inset leads the body instead.
      inset.className = "popup-inset" + (media ? "" : " popup-inset--block");
      inset.setAttribute("aria-hidden", "true");
      inset.innerHTML = insetSvg(key, itemCenter(item));
      if (media) {
        media.appendChild(inset);
      } else {
        body.insertBefore(inset, body.firstChild);
      }
    }

    // ---- Desa groups and landmarks --------------------------------------------
    // One group per place name and desa. The per-point note is not part of the
    // key: keying on it split a place in two whenever only some of its points
    // had one (RT 04 Tanjung Raden). Each unit shows it above its coordinate
    // instead (unitInfo). The desa from Nomor stays in the key because the
    // 3-digit code only runs within one desa: "Distrik Center HKBP Jambi"
    // covers Pelempang 001-003 and Tempino 001-002, and one group read 001 002
    // 003 001 002. Only a place name that spans two desa gets the desa named on
    // its groups (groupHead; three places as of Oct 2026, the others being
    // Kec. Tanah Tumbuh and Muara Siau). Naming the desa wherever the place
    // name didn't contain it flagged 16 groups, mostly spelling drift ("Sei.
    // Kayu Aro" against SUNGAI KAYU ARO) that only added noise.
    function desaGroups(rows) {
      var desaPerPlace = {};
      rows.forEach(function (item) {
        var place = plain(item.display.primary);
        (desaPerPlace[place] = desaPerPlace[place] || {})[desaOf(item.nomor)] = true;
      });
      var out = [];
      var byKey = {};
      rows.forEach(function (item) {
        var place = plain(item.display.primary);
        var desa = desaOf(item.nomor);
        var key = place + "|" + desa.toLowerCase();
        var group = byKey[key];
        if (!group) {
          var split = Object.keys(desaPerPlace[place]).length > 1;
          group = byKey[key] = { label: item.display.primary, desa: split ? desa : "", items: [] };
          out.push(group);
        }
        group.items.push(item);
      });
      return out;
    }

    // "MUARO JAMBI-MESTONG-TEMPINO-001": back 1 -> "Tempino", back 2 -> "Mestong".
    function nomorPart(nomor, back) {
      var parts = String(nomor || "").split("-");
      if (parts.length < 3 || !/^\d+$/.test(parts[parts.length - 1].trim())) {
        return "";
      }
      return parts[parts.length - 1 - back]
        .trim()
        .toLowerCase()
        .replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
    }

    function desaOf(nomor) {
      return nomorPart(nomor, 1);
    }

    // "RT 02 Desa Embacang Gedang, Kec. Muara Tabir" under a "Kec. Muara Tabir"
    // head: the head already says where, so the group drops the repeat. The
    // full wording stays searchable and in the point card.
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

    // A sheet line that names nothing below the kecamatan only repeats the
    // section head: "Kec. Tanah Tumbuh" (seven Bungo units in two desa) read
    // "Kec. Tanah Tumbuh · Lubuk Niur" under a "Kec. Tanah Tumbuh" head, and
    // "Muara Siau, Kec. Muara Siau" read "Muara Siau · Muara Siau". Such a
    // group is headed by its desa instead, Desa or Kel. as its Alamat says;
    // the sheet line stays the point card's title. Three groups as of Oct
    // 2026. Nor does a split place repeat a desa its line already names
    // ("…, Desa Pelempang · Pelempang").
    //
    // The HKBP line also covers two units whose photo stamps put them in
    // Tempino, next to Pelempang, and "Distrik Center HKBP Jambi, Desa
    // Pelempang · Tempino" named two desa at once. That group is headed by
    // where its units are, with the sheet line under it. Review (Oct 2026)
    // chose this for the HKBP line alone; four other lines that name a
    // different desa than their units keep the heading (Desa Muara Siau over
    // Sungai Ulas, Desa Tenam over Simpang Terusan, Kel. Rengas Condong over
    // Teratai, Kel. Pematang Sulur over Telanaipura).
    var LINE_ELSEWHERE = ["Distrik Center HKBP Jambi, Desa Pelempang, Kec. Mestong"];

    function desaTitle(item) {
      return (/^\s*kel(\.|urahan)/i.test(item.alamat) ? "Kel. " : "Desa ") + desaOf(item.nomor);
    }

    // { title, line }: line is the sheet line to show under a title that
    // isn't it.
    function groupHead(grp, section) {
      var label = underSection(grp.label, section);
      var first = grp.items[0];
      var area = function (text) { return words(text).join(" ").replace(/^kec(amatan)? /, ""); };
      if (area(label) === area(section)) {
        return { title: desaTitle(first), line: "" };
      }
      var named = (" " + words(label).join(" ") + " ").indexOf(" " + words(desaOf(first.nomor)).join(" ") + " ") !== -1;
      if (!named && LINE_ELSEWHERE.indexOf(grp.label) !== -1) {
        return { title: desaTitle(first), line: label };
      }
      return { title: label + (grp.desa && !named ? " · " + grp.desa : ""), line: "" };
    }

    // A tile carries the unit's coordinate, lat over lon, and above it the
    // survey landmark ("Depan Musholla RT 01", "Belakang SMP 7") when the unit
    // has one of its own: 138 of the 500 units carry a Keterangan that says
    // more than their desa. A landmark the whole group shares sits once under
    // the group's heading instead, and one that only restates the heading is
    // not shown (restates). The landmark is read off the row's second line
    // (display.secondary), so the cleaning of GPS-app logs and survey
    // bookkeeping applies unchanged, and then tidied for the list
    // (tidyLandmark).
    //
    // Tried and turned down in review (Oct 2026): the distance to the nearest
    // unit ("30 m dari 005") in place of the coordinate. The coordinate stays.
    // Measured and left out: a compass side within the group ("sisi utara")
    // put 3 of Durian Luncuk's 5 units on the same side; the road name in the
    // photo stamp is there in about 1 photo in 6 and OCRs badly; the photo
    // shows people's faces and is already on the point card. The map says the
    // rest: a hovered tile lights its pin (setUnitHover), and close in every
    // pin carries its number (pin labels).
    //
    // The landmark is whatever is left of the second line once the desa, the
    // kecamatan and the place name are taken out: "Kemantan Darat · Air
    // Hangat Timur" keeps "Kemantan Darat".
    function landmarkOf(item) {
      var place = plain(item.display.primary);
      var drop = [plain(desaOf(item.nomor)), plain(nomorPart(item.nomor, 2)), plain(item.kabupaten)];
      var parts = String(item.display.secondary || "").split(" · ");
      for (var i = 0; i < parts.length; i++) {
        var p = plain(parts[i]);
        if (p && drop.indexOf(p) === -1 && place.indexOf(p) === -1) {
          return parts[i].trim();
        }
      }
      return "";
    }

    // The surveyors typed these by hand, and the 129 shown in Oct 2026 read
    // untidy side by side: "RT.12", "rt 12" and "Rt.01" in one desa,
    // "Simpg.lapangan" and "H.Muzar" without a space, a GPS app's plus code
    // "(Hv7c+2vm)", and one in capitals ("JL. PUSKESMAS PAMENANG PASAR ...").
    // Display only: the point card keeps the cleaned Keterangan as it is.
    var ACRONYM = /\b(Rt|Rw|Pnpm|Sd|Sdn|Smp|Smpn|Sma|Smk|Tk|Kud)\b/g;

    function tidyLandmark(text) {
      var t = String(text || "").replace(/\s*\([a-z0-9]{4}\+[a-z0-9]{2,3}\)/gi, "");
      if (!/[a-z]/.test(t) && /[A-Z]{4}/.test(t)) {
        t = t
          .toLowerCase()
          .replace(/(^|[\s(,.\/-])([a-z])/g, function (m, before, c) { return before + c.toUpperCase(); })
          .replace(ACRONYM, function (a) { return a.toUpperCase(); });
      }
      return t
        .replace(/\b(rt|rw)\s*\.?\s*(\d+)/gi, function (m, key, n) { return key.toUpperCase() + " " + n; })
        .replace(/\b([A-Za-z]{1,6}\.)(?=[A-Za-z])/g, "$1 ")
        .replace(/\bNo\.(?=\d)/g, "No. ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    // Words of a phrase, numbers without leading zeros: "RT 001" and "RT 01"
    // are one RT.
    function words(text) {
      return String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(function (w) { return /^\d+$/.test(w) ? String(Number(w)) : w; });
    }

    // "RT 01 Bakung Jaya 1" under "RT 001 Bakung Jaya", "RT 21 Rawasari" under
    // "RT 21, Kel. Rawasari", "HKBP Desa Pelempang 4" under "Distrik Center
    // HKBP Jambi, Desa Pelempang": every word is already in the heading but
    // the surveyor's running number, so the landmark says nothing new (29
    // rows). A number after RT, RW or No. is part of an address, not a running
    // number.
    function restates(landmark, heading) {
      var w = words(landmark);
      if (w.length > 1 && /^\d+$/.test(w[w.length - 1]) && ["rt", "rw", "no"].indexOf(w[w.length - 2]) === -1) {
        w.pop();
      }
      var seen = words(heading);
      return w.every(function (x) { return seen.indexOf(x) !== -1; });
    }

    // The landmark a tile shows: tidied, and none when it only restates the
    // heading above it, the kabupaten included ("... Kota Jambi 1").
    function landmarkFor(item, heading) {
      var landmark = tidyLandmark(landmarkOf(item));
      return landmark && !restates(landmark, heading + " " + item.kabupaten) ? landmark : "";
    }

    function plain(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\b(desa|kel\.|kelurahan)\s+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function unitFlags(item) {
      var out = [];
      if (item.cadangan) {
        out.push(STATUS_LABEL.cadangan.tag);
      }
      if (item.duplikat) {
        out.push(STATUS_LABEL.duplikat.tag);
      }
      if (item.belum) {
        out.push(STATUS_LABEL.belum.tag);
      }
      return out;
    }

    function unitClass(item) {
      return (
        (item.cadangan ? " is-cadangan" : "") +
        (item.duplikat ? " is-duplikat" : "") +
        (item.belum ? " is-belum" : "") +
        (item.id === activeItemId ? " is-active" : "")
      );
    }

    // The tile's coordinate, lat over lon. An unplaced unit shows none: its
    // digits are an estimate (koordinatSingkat); the card still has them.
    function unitCoord(item) {
      var c = String(item.koordinatSingkat || "").split(/,\s*/);
      if (c.length !== 2 || !c[0]) {
        return '<span class="atlas-pt__coord atlas-pt__coord--none">Belum ada koordinat</span>';
      }
      return '<span class="atlas-pt__coord">' + escapeHtml(c[0]) + "<br>" + escapeHtml(c[1]) + "</span>";
    }

    function unitInfo(item, landmark) {
      if (!landmark) {
        return unitCoord(item);
      }
      return (
        '<span class="atlas-pt__info"><span class="atlas-pt__note">' + escapeHtml(landmark) + "</span>" +
        unitCoord(item) + "</span>"
      );
    }

    function unitHtml(item, landmark) {
      var flags = unitFlags(item);
      var aria = ["Titik " + item.display.code]
        .concat(flags, [item.display.primary, item.display.secondary])
        .filter(Boolean)
        .join(". ");
      var title = ["Titik " + item.display.code]
        .concat(flags.map(function (f) { return f.toLowerCase(); }))
        .join(", ");
      return (
        '<button class="atlas-pt" type="button" data-action="point" data-item-id="' + item.id +
        '" aria-label="' + escapeHtml(aria) + '" title="' + escapeHtml(title) + '"><span class="atlas-unit' +
        unitClass(item) + '">' + escapeHtml(item.display.code) + "</span>" + unitInfo(item, landmark) + "</button>"
      );
    }

    // Sections are { title, items }: a kecamatan head when a kabupaten spans
    // several, untitled otherwise (and for search results across kabupaten).
    // Each section is its own .atlas-group so its sticky head is held to its
    // own rows: the next kecamatan pushes it out of the top instead of
    // stacking over it.
    function sectionsHtml(sections) {
      return sections
        .map(function (s) {
          var count = s.items.filter(function (item) { return !item.cadangan; }).length;
          return (
            '<div class="atlas-group">' +
            (s.title
              ? '<div class="atlas-section" role="heading" aria-level="3">' + escapeHtml(s.title) +
                "<span>" + formatCount(count) + " titik</span></div>"
              : "") +
            desaGroups(s.items)
              .map(function (grp) {
                var head = groupHead(grp, s.title);
                var marks = grp.items.map(function (item) {
                  return landmarkFor(item, head.title + " " + head.line + " " + s.title);
                });
                // A landmark every unit shares goes under the heading once,
                // not on each tile: "Dusun Teluk Bengkah" five times over, or
                // a lone unit's landmark wrapped into half a row.
                var shared = marks.every(function (mk) { return mk && mk === marks[0]; }) ? marks[0] : "";
                // Hatched reserve tiles stay listed but never count: Desa
                // Pulau Betung has 15 tiles and 10 titik, so its count agrees
                // with the kecamatan head's.
                var counted = grp.items.filter(function (item) { return !item.cadangan; }).length;
                return (
                  '<div class="atlas-desa"><div class="atlas-desa__head"><span class="atlas-desa__title">' +
                  escapeHtml(head.title) + '</span><span class="atlas-desa__count">' + formatCount(counted) +
                  " titik</span></div>" +
                  (head.line ? '<p class="atlas-desa__note">Rekapan: ' + escapeHtml(head.line) + "</p>" : "") +
                  (shared ? '<p class="atlas-desa__note">' + escapeHtml(shared) + "</p>" : "") +
                  '<div class="atlas-units">' +
                  grp.items
                    .map(function (item, i) {
                      return unitHtml(item, shared ? "" : marks[i]);
                    })
                    .join("") +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          );
        })
        .join("");
    }

    var FLAG_SHORTCUT = { duplikat: "perlu verifikasi", belum: "belum ditetapkan" };

    function cellHtml(group, dots) {
      var key = normKey(group.name);
      var stats = groupStats(group);
      var flags = ["duplikat", "belum"].filter(function (flag) { return stats[flag]; });
      var aria = [group.name, formatCount(stats.count) + " titik", formatCount(stats.kecamatan) + " kecamatan"]
        .concat(flags.map(function (flag) { return formatCount(stats[flag]) + " " + STATUS_LABEL[flag].count; }))
        .concat("buka daftar")
        .join(", ");
      // A status count is also a shortcut into the filtered kabupaten. Spans
      // inside a button cannot be buttons themselves, so the click handler
      // reads which part was hit; keyboard users reach the same filter from
      // the pills on screen 2.
      var flagSpans = flags
        .map(function (flag) {
          return (
            '<span class="status-flag status-flag--' + flag + '" data-shortcut="' + flag +
            '" title="Tampilkan hanya ' + FLAG_SHORTCUT[flag] + '">' + formatCount(stats[flag]) + " " +
            FLAG_SHORTCUT[flag] + "</span>"
          );
        })
        .join("");
      return (
        '<button class="atlas-cell" type="button" data-action="open" data-group="' + escapeHtml(group.name) +
        '" data-key="' + escapeHtml(key) + '" aria-label="' + escapeHtml(aria) + '">' +
        '<span class="atlas-cell__shape">' + shapeSvg(key, dots[key], 160, 54, 2) + "</span>" +
        '<span class="atlas-cell__name">' + escapeHtml(shortName(group.name)) + "</span>" +
        '<span class="atlas-cell__meta"><b>' + formatCount(stats.count) + "</b> titik di " +
        formatCount(stats.kecamatan) + " kecamatan</span>" + flagSpans + "</button>"
      );
    }

    function emptyHtml(hasQuery) {
      var copy;
      var actions = "";
      if (hasQuery && activeGroup) {
        copy = "Tidak ada titik yang cocok di dalam " + activeGroup + ".";
        actions += '<button type="button" data-action="widen">Cari di semua titik</button>';
      } else if (hasQuery) {
        copy = "Tidak ada titik yang cocok dengan pencarian. Coba nomor titik, nama kabupaten, patokan lokasi, nama desa, atau koordinat.";
      } else {
        copy = "Belum ada titik untuk ditampilkan.";
      }
      if (hasQuery) {
        actions += '<button type="button" data-action="clear-search">Hapus pencarian</button>';
      }
      return (
        '<div class="panel-empty"><p>' + escapeHtml(copy) + "</p>" +
        (actions ? '<div class="panel-empty__actions">' + actions + "</div>" : "") + "</div>"
      );
    }

    // ---- Writing the panel ----------------------------------------------------

    function renderList(query) {
      var normalizedQuery = getNormalizedText(query);
      var coordQuery = parseCoordinateQuery(query);

      visibleIds.clear();

      var screen = activeGroup
        ? renderItemScreen(normalizedQuery, coordQuery)
        : renderGroupScreen(normalizedQuery, coordQuery);

      renderTop();
      searchInput.placeholder = activeGroup
        ? "Cari dalam " + activeGroup + "…"
        : "Cari lokasi atau kabupaten…";

      listContainer.innerHTML = screen.html;
      renderMeta(screen.count, Boolean(normalizedQuery));
      markScreenChange();
      redrawPoints();
      updateHighlight(activeItemId);
      syncScrolled();
      measurePeek();
    }

    // Screen 1. With no query: one cell per kabupaten, Kota Jambi first. With a
    // query: matching points across every kabupaten — search is the shortcut
    // past the drill-down, so it must not make you pick a kabupaten first.
    function renderGroupScreen(normalizedQuery, coordQuery) {
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
            matched.push(item);
          });
        });
        return {
          count: visibleCount,
          html: visibleCount ? sectionsHtml([{ title: "", items: matched }]) : emptyHtml(true)
        };
      }

      groupedItems.forEach(function (group) {
        allGroupItems(group).forEach(function (item) {
          visibleIds.add(item.id);
          if (!item.cadangan) {
            visibleCount += 1;
          }
        });
      });

      if (!groupedItems.length) {
        return { count: 0, html: emptyHtml(false) };
      }
      // Kota before the kabupaten, as asked in review (Oct 2026). The sort is
      // stable, so each side keeps its alphabetical order.
      var kotaFirst = groupedItems.slice().sort(function (a, b) {
        return /^Kota\s/i.test(b.name) - /^Kota\s/i.test(a.name);
      });
      var dots = dotsByKabupaten();
      return {
        count: visibleCount,
        html:
          '<div class="atlas-grid">' +
          kotaFirst.map(function (group) { return cellHtml(group, dots); }).join("") +
          "</div>"
      };
    }

    // Screen 2. Only the active group contributes rows.
    function renderItemScreen(normalizedQuery, coordQuery) {
      var group = findGroup(activeGroup);
      if (!group) {
        activeGroup = null;
        statusFilter = null;
        return renderGroupScreen(normalizedQuery, coordQuery);
      }

      // The local editor can clear the last flag of the kind being filtered;
      // an empty filter would then hide the whole group behind a pill that no
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

      if (!matchedItems.length) {
        return { count: 0, html: emptyHtml(Boolean(normalizedQuery)) };
      }

      // Rows sort by Nomor (KABUPATEN-KECAMATAN-DESA-NNN), so a group's
      // kecamatan already arrive in contiguous runs. When there is more than
      // one, each run gets a sticky head naming it and saying how many units
      // sit there. One kecamatan needs no head: the header already says where.
      var sections = sectionsByKecamatan(matchedItems);
      var sectioned = sections.length > 1;
      var skCount = 0;
      matchedItems.forEach(function (item) {
        if (!item.cadangan) {
          skCount += 1;
        }
      });
      return {
        count: skCount,
        html: sectionsHtml(sections.map(function (section) {
          return {
            title: sectioned ? (section.key ? "Kec. " + section.key : "Kecamatan lain") : "",
            items: section.items
          };
        }))
      };
    }

    // One section per kecamatan, in order of first appearance. Keyed rather
    // than run-based so a stray Nomor prefix ("JAMBI-KOTA BARU-…" among
    // "KOTA JAMBI-KOTA BARU-…") joins its kecamatan instead of opening a
    // second head for it. Cadangan rows travel with their kecamatan.
    function sectionsByKecamatan(rows) {
      var sections = [];
      var byKey = {};
      rows.forEach(function (item) {
        var key = item.display.kecamatan || "";
        var section = byKey[key];
        if (!section) {
          section = byKey[key] = { key: key, items: [] };
          sections.push(section);
        }
        section.items.push(item);
      });
      return sections;
    }

    // Each region is rewritten only when its markup changes, so a control the
    // reader is on survives a render that did not touch it.
    function setRegion(el, html) {
      if (el && el.getAttribute("data-html") !== html) {
        el.innerHTML = html;
        el.setAttribute("data-html", html);
      }
    }

    function renderTop() {
      if (!activeGroup) {
        setRegion(
          panelTop,
          '<div class="atlas-head"><img src="' + escapeHtml(lambangSrc) +
          '" alt="Lambang Provinsi Jambi" width="38" height="39" decoding="async">' +
          '<div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p>' +
          '<h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div>' + collapseButtonHtml() + "</div>"
        );
        return;
      }
      var group = findGroup(activeGroup);
      var stats = group ? groupStats(group) : null;
      setRegion(
        panelTop,
        '<div class="atlas-detail"><div class="atlas-detail__bar">' +
        '<button class="atlas-back" type="button" data-action="back" aria-label="Kembali ke semua wilayah">' +
        panelIcon("back", 16) + "Semua wilayah</button>" + collapseButtonHtml() + "</div>" +
        '<div class="atlas-detail__main"><div><h1>' + escapeHtml(activeGroup) + "</h1>" +
        (stats
          ? "<p><b>" + formatCount(stats.count) + "</b> titik di <b>" + formatCount(stats.kecamatan) + "</b> kecamatan</p>"
          : "") +
        '</div><div class="atlas-locator" role="img" aria-label="Letak ' + escapeHtml(activeGroup) +
        ' di Provinsi Jambi">' + locatorSvg(normKey(activeGroup), 112, 84) + "</div></div></div>"
      );
    }

    // One line that changes with the situation, instead of three numbers that
    // are usually identical and therefore unreadable.
    function summaryText(matchCount, hasQuery) {
      if (activeGroup && statusFilter) {
        var group = findGroup(activeGroup);
        var label = STATUS_LABEL[statusFilter].count;
        var flagged = group ? countGroupFlag(group, statusFilter) : matchCount;
        return hasQuery
          ? formatCount(matchCount) + " dari " + formatCount(flagged) + " " + label
          : formatCount(matchCount) + " " + label + " dari " +
            formatCount(group ? group.items.length : 0) + " titik";
      }
      if (activeGroup) {
        return hasQuery
          ? formatCount(matchCount) + " dari " + formatCount(activeGroupSize()) + " titik"
          : formatCount(matchCount) + " titik";
      }
      if (hasQuery) {
        return matchCount
          ? formatCount(matchCount) + " titik cocok di " +
            formatCount(countMatchedGroups()) + " " + groupNoun()
          : "Tidak ada titik yang cocok";
      }
      return formatCount(items.length) + " titik · " +
        formatCount(groupedItems.length) + " " + groupNoun();
    }

    var PILL_LABEL = { duplikat: "Perlu verifikasi", belum: "Belum ditetapkan" };

    // One pill per status the kabupaten actually has, plus "Semua" to get
    // back. A clean kabupaten shows no pills at all: there is nothing to jump
    // to.
    function pillsHtml(group) {
      var flags = STATUS_FILTERS.filter(function (flag) {
        return countGroupFlag(group, flag);
      });
      if (!flags.length) {
        return "";
      }
      var pill = function (flag, label, count) {
        var on = (statusFilter || "") === flag;
        return (
          '<button class="atlas-pill" type="button" data-action="filter" data-flag="' + flag +
          '" aria-pressed="' + on + '">' +
          (flag ? '<span class="atlas-pill__swatch atlas-pill__swatch--' + flag + '" aria-hidden="true"></span>' : "") +
          label + " <b>" + formatCount(count) + "</b></button>"
        );
      };
      return (
        '<div class="atlas-pills" role="group" aria-label="Saring menurut status">' +
        pill("", "Semua", group.items.length) +
        flags.map(function (flag) { return pill(flag, PILL_LABEL[flag], countGroupFlag(group, flag)); }).join("") +
        "</div>"
      );
    }

    // Flip the screen 2 filter. The pill that is already on turns back off
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
      listScroller.scrollTop = 0;
      focusWithoutScroll(
        panelMeta.querySelector('.atlas-pill[data-flag="' + (statusFilter || "") + '"]')
      );
      fitToVisible({ maxZoom: 16, duration: 500 });
    }

    function renderMeta(matchCount, hasQuery) {
      var text = summaryText(matchCount, hasQuery);
      if (activeGroup) {
        var group = findGroup(activeGroup);
        setRegion(
          panelMeta,
          (group ? pillsHtml(group) : "") + '<p class="atlas-hint" role="status">' +
          escapeHtml(hasQuery || statusFilter ? text : "Pilih nomor titik untuk melihatnya di peta.") + "</p>"
        );
        return;
      }
      if (hasQuery) {
        setRegion(panelMeta, '<p class="atlas-summary" role="status">' + escapeHtml(text) + "</p>");
        return;
      }
      setRegion(
        panelMeta,
        '<div class="atlas-summary atlas-summary--total"><p class="atlas-total" role="status"><b class="atlas-total__num">' +
        formatCount(items.length) + '</b> <span class="atlas-total__label"><span>titik PUTS</span> ' +
        "<span>di <b>" + formatCount(groupedItems.length) + "</b> kabupaten/kota</span></span></p>" +
        '<button id="fit-map" type="button" data-action="fit" title="Tampilkan semua titik di peta">' +
        panelIcon("frame", 16) + "<span>Lihat semua</span></button></div>"
      );
    }

    // Screen changes answer a click: the new screen slides in from the side
    // the reader is travelling toward (custom.css, #sidebar[data-enter]).
    var lastScreen = null;
    var enterTimer = null;

    function markScreenChange() {
      var screen = activeGroup || "";
      if (lastScreen !== null && screen !== lastScreen) {
        panelEl.removeAttribute("data-enter");
        void panelEl.offsetWidth;
        panelEl.setAttribute("data-enter", activeGroup ? "fwd" : "back");
        clearTimeout(enterTimer);
        enterTimer = setTimeout(function () {
          panelEl.removeAttribute("data-enter");
        }, 320);
        setUnitHover(null);
      }
      lastScreen = screen;
      setRegionHover(regionHoverKey);
    }

    // A list scrolled under the header gets a soft shadow at the cut (the
    // grid's ::before), and the kecamatan head in view turns navy.
    function syncScrolled() {
      panelEl.classList.toggle("is-scrolled", listScroller.scrollTop > 2);
      syncStuck();
    }

    // The kecamatan head in view turns navy (.is-stuck) so the kecamatan the
    // rows belong to is spotted at a glance. Measured here because CSS only
    // learns "stuck" from scroll-state container queries, which only Chromium
    // has. One head at a time: the head stuck at the top with its rows passing
    // under it, or the next head once it starts pushing that one out, so the
    // colour moves to the incoming kecamatan as it takes the top instead of
    // flipping when it lands. Nothing is navy at rest: a head that merely sits
    // at the top with no rows under it yet stays plain.
    function syncStuck() {
      var heads = listContainer.querySelectorAll(".atlas-section");
      if (!heads.length) {
        return;
      }
      var top = listScroller.getBoundingClientRect().top;
      var current = null;
      Array.prototype.forEach.call(heads, function (head) {
        var box = head.getBoundingClientRect();
        var next = head.nextElementSibling;
        var stuck = box.top <= top + 1 && !!next && next.getBoundingClientRect().top < box.bottom - 1;
        var pushing = !!current && box.top > top + 1 && box.top < top + box.height - 1;
        if (stuck || pushing) {
          current = head;
        }
      });
      Array.prototype.forEach.call(heads, function (head) {
        head.classList.toggle("is-stuck", head === current);
      });
    }

    listScroller.addEventListener("scroll", syncScrolled, { passive: true });

    // Phones: the closed sheet peeks down to its search field, whatever the
    // header above it holds on this screen, so the fit padding and the
    // control stack (both read --sheet-peek) follow the screen too.
    function measurePeek() {
      if (!isMobileViewport() || !panelSearch) {
        return;
      }
      var peek = Math.round(panelSearch.offsetTop + panelSearch.offsetHeight + 14);
      document.documentElement.style.setProperty("--sheet-peek", peek + "px");
    }

    window.addEventListener("resize", measurePeek);

    // ---- Panel controls -------------------------------------------------------

    panelEl.addEventListener("click", function (event) {
      var el = event.target.closest ? event.target.closest("[data-action]") : null;
      if (!el || !panelEl.contains(el)) {
        return;
      }
      var action = el.getAttribute("data-action");
      if (action === "open") {
        var shortcut = event.target.closest("[data-shortcut]");
        setActiveGroup(el.getAttribute("data-group"), {
          filter: shortcut && el.contains(shortcut) ? shortcut.getAttribute("data-shortcut") : null
        });
      } else if (action === "back") {
        setActiveGroup(null);
      } else if (action === "filter") {
        setStatusFilter(el.getAttribute("data-flag") || null);
      } else if (action === "point") {
        var item = itemsById[el.getAttribute("data-item-id")];
        if (item) {
          setUnitHover(null);
          focusItem(item, { closePanel: true, zoom: 17 });
        }
      } else if (action === "fit") {
        searchInput.value = "";
        setActiveGroup(null);
        if (window.innerWidth < 960) {
          setPanelOpen(false);
        }
      } else if (action === "collapse") {
        setSidebarCollapsed(true);
        focusWithoutScroll(panelToggle);
      } else if (action === "clear-search") {
        clearTimeout(searchDebounce);
        searchInput.value = "";
        searchInput.focus();
        renderList("");
        fitToVisible({ maxZoom: 16, duration: 500 });
      } else if (action === "widen") {
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
      }
    });

    // ---- The kabupaten under the pointer, outlined on the map -----------------
    // Hovering a cell (or focusing it) outlines its kabupaten on the map in
    // yellow over a dark halo; with one kabupaten open, its outline stays.
    var regionSource = new ol.source.Vector();
    var regionLayer = new ol.layer.Vector({
      source: regionSource,
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
    (function insertRegionLayer() {
      var layers = window.map.getLayers();
      var arr = layers.getArray();
      var holds = function (layer, target) {
        return layer === target || (layer.getLayers
          ? layer.getLayers().getArray().some(function (child) { return holds(child, target); })
          : false);
      };
      for (var i = 0; i < arr.length; i++) {
        if (holds(arr[i], window.lyr_260331_4)) {
          layers.insertAt(i, regionLayer);
          return;
        }
      }
      layers.push(regionLayer);
    })();

    var regionHoverKey = null;
    var regionShown;

    function setRegionHover(key) {
      regionHoverKey = key;
      var show = key || (activeGroup ? normKey(activeGroup) : null);
      if (show === regionShown) {
        return;
      }
      regionShown = show;
      regionSource.clear();
      var f = show && geo && geo.polys[show];
      if (f) {
        regionSource.addFeature(new ol.Feature(f.getGeometry()));
      }
    }

    // ---- A tile's pin, lit from the list --------------------------------------
    // Hovering a unit tile lights its pin the way the map lights a pin under
    // the cursor: the symbol a step bigger and the same dark pill. Here the eye
    // is on the list, not the map, so the pin also gets the ground halo of a
    // selected point, and a dot (zoomed out past pins) grows by 40% rather than
    // 2px, which nobody would spot from the list. Pointer hover and keyboard
    // focus only: a finger never hovers, and a tap selects the point.
    var canHover = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    var grownCache = new WeakMap();
    var unitHoverSource = new ol.source.Vector({ useSpatialIndex: false });
    var unitHoverHalos = {
      yellow: selectionHalo("rgba(254, 229, 15, 0.26)", "rgba(255, 255, 255, 0.7)"),
      slate: selectionHalo("rgba(107, 122, 140, 0.24)", "rgba(255, 255, 255, 0.7)")
    };
    new ol.layer.Vector({
      map: window.map,
      source: unitHoverSource,
      zIndex: 4,
      style: function (ghost, resolution) {
        var styles = grownStyle(ghost.get("item"), resolution);
        return styles ? [unitHoverHalos[ghost.get("halo")]].concat(styles) : null;
      }
    });
    var unitTipEl = document.createElement("div");
    unitTipEl.className = "pin-tip";
    unitTipEl.setAttribute("aria-hidden", "true");
    var unitTip = new ol.Overlay({ element: unitTipEl, positioning: "bottom-center", stopEvent: false, insertFirst: false });
    window.map.addOverlay(unitTip);
    var unitHoverId = null;

    // The pin as drawn right now, a step bigger; null when no layer draws it
    // (filtered out, or its layer switched off).
    function grownStyle(item, resolution) {
      if (!isItemShown(item)) {
        return null;
      }
      var base = singleStyle(item, resolution);
      var hit = grownCache.get(base);
      if (!hit) {
        hit = base.map(function (s) {
          var image = s.getImage().clone();
          var scale = image.getScale();
          image.setScale((typeof scale === "number" ? scale : 1) * (image instanceof ol.style.Icon ? 1.12 : 1.4));
          return new ol.style.Style({ image: image, zIndex: 5 });
        });
        grownCache.set(base, hit);
      }
      return hit;
    }

    // Pill above the symbol: clear of a pin's head, or of a dot's edge.
    function unitTipOffset(styles) {
      var image = styles[0].getImage();
      var scale = image.getScale();
      scale = typeof scale === "number" ? scale : 1;
      if (image instanceof ol.style.Icon) {
        var size = image.getSize();
        return -((size ? size[1] : 32) * scale + 6);
      }
      return -(image.getRadius() * scale + 8);
    }

    function setUnitHover(id) {
      if (id === unitHoverId) {
        return;
      }
      unitHoverId = id;
      unitHoverSource.clear();
      unitTipEl.classList.remove("is-visible");
      unitTip.setPosition(undefined);
      var item = id ? itemsById[id] : null;
      // The selected point already has its card and its own enlarged pin.
      if (!item || item.id === activeItemId) {
        return;
      }
      var styles = grownStyle(item, window.map.getView().getResolution());
      if (!styles) {
        return;
      }
      unitHoverSource.addFeature(new ol.Feature({
        geometry: item.feature.getGeometry(),
        item: item,
        halo: item.belum || item.cadangan ? "slate" : "yellow"
      }));
      // The tile's own landmark, not the place line: the heading already
      // says the place, and the pill has to tell this pin from its neighbours.
      var label = truncateLabel(landmarkFor(item, item.display.primary) || desaOf(item.nomor), 34);
      unitTipEl.textContent = "Titik " + item.display.code + (label ? " · " + label : "");
      unitTip.setOffset([0, unitTipOffset(styles)]);
      unitTip.setPosition(item.feature.getGeometry().getCoordinates());
      requestAnimationFrame(function () {
        if (unitHoverId === id) {
          unitTipEl.classList.add("is-visible");
        }
      });
    }

    function unitIdAt(target) {
      var unit = target && target.closest ? target.closest(".atlas-pt[data-item-id]") : null;
      return unit && panelEl.contains(unit) ? unit.getAttribute("data-item-id") : null;
    }

    function regionKeyAt(target) {
      var cell = target && target.closest ? target.closest("[data-key]") : null;
      return cell && panelEl.contains(cell) ? cell.getAttribute("data-key") : null;
    }

    panelEl.addEventListener("mouseover", function (event) {
      setRegionHover(regionKeyAt(event.target));
      if (canHover) {
        setUnitHover(unitIdAt(event.target));
      }
    });

    panelEl.addEventListener("mouseleave", function () {
      setRegionHover(null);
      setUnitHover(null);
    });

    // Keyboard focus lights the pin too; a mouse click focuses the tile as
    // well, and the click itself selects the point.
    panelEl.addEventListener("focusin", function (event) {
      setRegionHover(regionKeyAt(event.target));
      if (event.target.matches && event.target.matches(":focus-visible")) {
        setUnitHover(unitIdAt(event.target));
      }
    });

    panelEl.addEventListener("focusout", function (event) {
      if (!panelEl.contains(event.relatedTarget)) {
        setRegionHover(null);
        setUnitHover(null);
      }
    });

    // ---- Numbers on the pins ----------------------------------------------------
    // From about zoom 15 in, every pin carries its 3-digit number, so a tile
    // and its pin match without hovering, which a phone cannot do. Units on
    // one coordinate share a label ("002–008") instead of stacking seven. A
    // label names only the pins actually drawn (isItemShown), so a hidden
    // kabupaten or a layer switched off leaves no orphan numbers. The labels
    // declutter among themselves, so where two would overlap one waits for the
    // next zoom step; the pins underneath never declutter (layers/layers.js).
    var LABEL_MAX_RESOLUTION = 4.8;

    function codeList(codes) {
      var sorted = codes.slice().sort();
      var nums = sorted.map(Number);
      var run = nums.every(function (n, i) { return i === 0 || n === nums[i - 1] + 1; });
      return run && sorted.length >= 3 ? sorted[0] + "–" + sorted[sorted.length - 1] : sorted.join(", ");
    }

    var pinLabelLayer = (function () {
      var spots = {};
      mappedItems.forEach(function (item) {
        var at = item.feature.getGeometry().getCoordinates();
        var key = Math.round(at[0] * 2) + "," + Math.round(at[1] * 2);
        (spots[key] = spots[key] || { at: at, units: [] }).units.push(item);
      });
      var cache = {};
      var layer = new ol.layer.Vector({
        source: new ol.source.Vector({
          features: Object.keys(spots).map(function (k) {
            return new ol.Feature({ geometry: new ol.geom.Point(spots[k].at), units: spots[k].units });
          })
        }),
        declutter: true,
        maxResolution: LABEL_MAX_RESOLUTION,
        style: function (f) {
          var codes = f.get("units")
            .filter(isItemShown)
            .map(function (item) { return item.display.code; });
          if (!codes.length) {
            return null;
          }
          var text = codeList(codes);
          if (!cache[text]) {
            // Beside the pin's head (20px above its tip), not over the pin.
            cache[text] = new ol.style.Style({
              text: new ol.style.Text({
                text: text,
                font: "700 11px Figtree, system-ui, sans-serif",
                textAlign: "left",
                textBaseline: "middle",
                offsetX: 14,
                offsetY: -20,
                padding: [3, 5, 2, 5],
                fill: new ol.style.Fill({ color: INK }),
                backgroundFill: new ol.style.Fill({ color: "rgba(255, 255, 255, 0.92)" }),
                backgroundStroke: new ol.style.Stroke({ color: "rgba(41, 61, 80, 0.28)", width: 1 })
              })
            });
          }
          return cache[text];
        }
      });
      window.map.addLayer(layer);
      return layer;
    })();

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
        pinLabelLayer.changed();
      });
    });

    // ---- Point symbology ----------------------------------------------------
    // Bertin: at nine pixels the only visual variables that survive are hue and
    // lightness. The old dots told the statuses apart with dash patterns, which
    // do not exist at that size. Now: SK solid yellow; duplikat yellow with an
    // orange rim; belum a pale disc with a heavy slate rim (still nothing yellow
    // — it must never read as one more surveyed unit); cadangan grey.
    var DOT_FILL = {
      sk: "#fee50f",
      duplikat: "#fee50f",
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
            getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek"),
            10
          ) || 240;
        return [72, 24, peek + 24, 24];
      }
      return [56, 72, 72, panelInset() + 48];
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
    (document.querySelector(".app-shell") || document.body).appendChild(legendEl);

    // The right bound: the viewport's right edge to the scale/attribution
    // block's left edge (its width plus its 16px margin). Measured, because
    // the attribution text is whatever the tile source declares, and
    // re-measured whenever that block changes size.
    var metaBlock = document.querySelector(".map-meta");
    function syncLegendBounds() {
      if (!metaBlock) {
        return;
      }
      var width = metaBlock.getBoundingClientRect().width;
      document.documentElement.style.setProperty(
        "--map-meta-inset",
        Math.round(width + 16) + "px"
      );
    }
    if (metaBlock && window.ResizeObserver) {
      new ResizeObserver(syncLegendBounds).observe(metaBlock);
    } else {
      window.addEventListener("resize", syncLegendBounds);
    }
    syncLegendBounds();

    var LEGEND_LABEL = {
      sk: "Titik PUTS",
      belum: STATUS_LABEL.belum.legend,
      duplikat: STATUS_LABEL.duplikat.legend,
      cadangan: STATUS_LABEL.cadangan.legend
    };
    // Phones: the pill must stay one row (see .map-legend__pill in the
    // mobile block of custom.css), so each entry carries a short label too
    // and CSS shows one or the other. Only the visible one is read aloud.
    var LEGEND_LABEL_SHORT = {
      sk: "Titik PUTS",
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
      pinLabelLayer.changed();
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

      window.map.getView().fit(extent, {
        // Reserves the panel's real footprint (fitPadding), otherwise the
        // westernmost points land underneath it.
        padding: fitPadding(),
        maxZoom: config.maxZoom || 15,
        duration: config.duration === undefined ? 700 : config.duration
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
      return panel ? Math.round(panel.getBoundingClientRect().right) : 0;
    }

    function setActiveGroup(name, options) {
      var config = options || {};
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
      moveFocusForScreen();
      if (config.fit !== false) {
        fitToVisible({ maxZoom: activeGroup ? 14 : 15 });
      }
    }

    // preventScroll is load-bearing on mobile, not a nicety. The focused
    // control lives inside the bottom sheet; when a point is picked the sheet
    // translates fully off-screen, and a plain focus() makes the browser scroll
    // the document to chase it — dragging the hidden sheet back over the popup.
    //
    // Script focus after a click lands on a control the click just re-rendered
    // away, and browsers then treat the new focus as :focus-visible — so the
    // back pill, a chip or a row kept a keyboard ring after a plain mouse or
    // touch press. Mark those nodes quiet; the first key press gives the ring
    // back, so keyboard users still see where they are.
    function focusWithoutScroll(node) {
      if (!node) {
        return;
      }
      if (!lastInputWasKeyboard) {
        node.classList.add("is-quiet-focus");
        node.addEventListener(
          "blur",
          function () {
            node.classList.remove("is-quiet-focus");
          },
          { once: true }
        );
      }
      try {
        node.focus({ preventScroll: true });
      } catch (err) {
        node.focus();
      }
    }

    var lastInputWasKeyboard = false;
    document.addEventListener(
      "keydown",
      function () {
        lastInputWasKeyboard = true;
        var active = document.activeElement;
        if (active && active.classList) {
          active.classList.remove("is-quiet-focus");
        }
      },
      true
    );
    document.addEventListener(
      "pointerdown",
      function () {
        lastInputWasKeyboard = false;
      },
      true
    );

    function moveFocusForScreen() {
      if (activeGroup) {
        focusWithoutScroll(panelTop.querySelector(".atlas-back"));
        return;
      }
      if (!restoreFocusGroup) {
        return;
      }
      var rows = listContainer.querySelectorAll(".atlas-cell");
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute("data-group") === restoreFocusGroup) {
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
        dismissPopup();
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
        renderList(value);
        // Search now narrows the map too, so bring the survivors into view
        // instead of leaving the user staring at an empty viewport.
        fitToVisible({ maxZoom: 16, duration: 500 });
      }, 250);
    });

    var searchClear = document.getElementById("list-search-clear");
    if (searchClear) {
      searchClear.addEventListener("click", function () {
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
      document.body.classList.toggle("is-sidebar-collapsed", collapsed);
      if (panelToggle) {
        panelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
      refreshMapSizeDuring(380);
      schedulePopupReframe(400);
    }

    if (panelToggle) {
      panelToggle.addEventListener("click", function () {
        if (window.innerWidth >= 960) {
          setSidebarCollapsed(
            !document.body.classList.contains("is-sidebar-collapsed")
          );
          if (!document.body.classList.contains("is-sidebar-collapsed")) {
            focusWithoutScroll(panelTop.querySelector(".panel-collapse"));
          }
        } else {
          setPanelOpen(!document.body.classList.contains("is-panel-open"));
        }
      });

      // On desktop the sidebar starts open, so reflect that on the toggle.
      if (window.innerWidth >= 960) {
        panelToggle.setAttribute("aria-expanded", "true");
      }
    }

    if (panelClose) {
      panelClose.addEventListener("click", function () {
        setPanelOpen(false);
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
          getComputedStyle(document.documentElement).getPropertyValue(
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
        dismissPopup();
      } else {
        setPanelOpen(false);
      }
    });

    window.addEventListener("resize", function () {
      configurePopupOverlayForViewport();
      if (window.innerWidth >= 960) {
        setPanelOpen(false);
      } else {
        document.body.classList.remove("is-sidebar-collapsed");
      }
      schedulePopupReframe(160);
    });

    configurePopupOverlayForViewport();

    // Override qgis2web's closer so it also clears the map selection & sidebar highlight
    var popupCloser = document.getElementById("popup-closer");
    if (popupCloser) {
      popupCloser.onclick = function (e) {
        e.preventDefault();
        popupCloser.blur();
        dismissPopup();
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

    // The gesture hint goes first and at once: it does not wait for tiles
    // (rendercomplete can take seconds on a phone connection) because its
    // blur hides a half-drawn map anyway. The sheet's lift follows once the
    // hint has gone, so the two cues take turns instead of moving together.
    // One frame's grace lets the fitted view paint underneath first.
    var gestureShown = false;
    requestAnimationFrame(function () {
      gestureShown = startGestureHint(function () {
        setTimeout(kickSheetHints, 250);
      });
      if (gestureShown) {
        return;
      }
      window.map.once("rendercomplete", function () {
        setTimeout(kickSheetHints, 600);
      });
      setTimeout(kickSheetHints, 3000);
    });
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
