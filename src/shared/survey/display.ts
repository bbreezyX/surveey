import type { DisplayParts } from './types';
const ROMAN_NUMERAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const NOT_A_NUMERAL: Record<string, boolean> = { DI: true };
  export function toDisplayCase(value: unknown) {
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
  var NAME_SUFFIXES: Record<string, string> = {
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

  export function toDisplayName(value: unknown) {
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
  var PENGUSUL_ALIASES: Record<string, string> = {
    gubernur: "Gubernur Jambi",
    bupati: "Bupati Kerinci"
  };

  export function toPengusulName(value: unknown) {
    var name = toDisplayName(value);
    return PENGUSUL_ALIASES[name.toLowerCase()] || name;
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
  var SPELLING_FIXES: [RegExp, string][] = [
    [/\bmadrash\b/gi, "Madrasah"],
    [/\balternatip\b/gi, "Alternatif"],
    [/\brmh\b/gi, "Rumah"],
    [/\bsmp\b/gi, "SMP"],
    [/\bJl\.(?=\S)/g, "Jl. "]
  ];

  export function cleanKeterangan(value: unknown) {
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

  export function formatRt(text: string) {
    return text
      .replace(/^rt[\s.]*(\d+)/i, "RT $1")
      .replace(/[\s,]*rw[\s.]*(\d+)$/i, " RW $1");
  }

  // Loose "does a already say b": case and punctuation ignored, whole words.
  export function saysAlready(text: unknown, part: unknown) {
    var key = function (value: unknown) {
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
  export function buildDisplayParts(nomor: string, keterangan: unknown, rekapan: unknown): DisplayParts {
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
