import type { SurveyPoint } from '../../shared/survey/types';
export interface VillageGroup { label: string; desa: string; items: SurveyPoint[] }
const LINE_ELSEWHERE = ['Distrik Center HKBP Jambi, Desa Pelempang, Kec. Mestong'];
const ACRONYM = /\b(Rt|Rw|Pnpm|Sd|Sdn|Smp|Smpn|Sma|Smk|Tk|Kud)\b/g;
export function desaGroups(rows: SurveyPoint[]) {
      var desaPerPlace: Record<string, Record<string, boolean>> = {};
      rows.forEach(function (item) {
        var place = plain(item.display.primary);
        (desaPerPlace[place] = desaPerPlace[place] || {})[desaOf(item.nomor)] = true;
      });
      var out: VillageGroup[] = [];
      var byKey: Record<string, VillageGroup> = {};
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
export function nomorPart(nomor: string, back: number) {
      var parts = String(nomor || "").split("-");
      if (parts.length < 3 || !/^\d+$/.test(parts[parts.length - 1].trim())) {
        return "";
      }
      return parts[parts.length - 1 - back]
        .trim()
        .toLowerCase()
        .replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
    }
export function desaOf(nomor: string) {
      return nomorPart(nomor, 1);
    }
export function underSection(label: string, section: string) {
      var kec = String(section || "").trim();
      if (!/^Kec\.\s/i.test(kec)) {
        return label;
      }
      var tail = ", " + kec;
      return label.length > tail.length && label.slice(-tail.length).toLowerCase() === tail.toLowerCase()
        ? label.slice(0, -tail.length)
        : label;
    }
export function groupHead(grp: VillageGroup, section: string) {
      var label = underSection(grp.label, section);
      var first = grp.items[0];
      var area = function (text: string) { return words(text).join(" ").replace(/^kec(amatan)? /, ""); };
      if (area(label) === area(section)) {
        return { title: desaTitle(first), line: "" };
      }
      var named = (" " + words(label).join(" ") + " ").indexOf(" " + words(desaOf(first.nomor)).join(" ") + " ") !== -1;
      if (!named && LINE_ELSEWHERE.indexOf(grp.label) !== -1) {
        return { title: desaTitle(first), line: label };
      }
      return { title: label + (grp.desa && !named ? " · " + grp.desa : ""), line: "" };
    }
export function landmarkOf(item: SurveyPoint) {
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
export function tidyLandmark(text: string) {
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
export function words(text: string) {
      return String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(function (w) { return /^\d+$/.test(w) ? String(Number(w)) : w; });
    }
export function restates(landmark: string, heading: string) {
      var w = words(landmark);
      if (w.length > 1 && /^\d+$/.test(w[w.length - 1]) && ["rt", "rw", "no"].indexOf(w[w.length - 2]) === -1) {
        w.pop();
      }
      var seen = words(heading);
      return w.every(function (x) { return seen.indexOf(x) !== -1; });
    }
export function landmarkFor(item: SurveyPoint, heading: string) {
      var landmark = tidyLandmark(landmarkOf(item));
      return landmark && !restates(landmark, heading + " " + item.kabupaten) ? landmark : "";
    }
export function plain(value: unknown) {
      return String(value || "")
        .toLowerCase()
        .replace(/\b(desa|kel\.|kelurahan)\s+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

function desaTitle(item: SurveyPoint): string { return (/^\s*kel(\.|urahan)/i.test(item.alamat) ? "Kel. " : "Desa ") + desaOf(item.nomor); }
