// Login page entry. Anonymous visitors may load this bundle, so it must
// never import admin screens or API code: only the map backdrop.
import 'ol/ol.css';
import './sheet.css';
import { createBackdrop } from './backdrop';
import { UNFOLD_KEY } from './unfold';

const backdrop = document.getElementById('backdrop');
if (backdrop) createBackdrop(backdrop);

// Tell the dashboard to grow out of this card. The height lets it start
// from exactly the card's size. A failed login re-renders this page, which
// clears the flag again.
try { sessionStorage.removeItem(UNFOLD_KEY); } catch { /* storage blocked */ }
const sheet = document.querySelector<HTMLElement>('.sheet');
document.querySelector('form')?.addEventListener('submit', () => {
  try { sessionStorage.setItem(UNFOLD_KEY, String(sheet?.offsetHeight ?? 0)); } catch { /* storage blocked */ }
});
