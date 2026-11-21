import type { SheetSnap } from './survey.svelte';

// Preserve the established finger tracking, distance and velocity thresholds across three resting stops:
// collapsed peek (or compact bar during detail), half-sheet list, and full-sheet list.
export function createSheetGesture(
  sheet: () => HTMLElement,
  snap: () => SheetSnap,
  setSnap: (next: SheetSnap) => void,
  stopHints: () => void,
  popupOpen: () => boolean = () => false,
) {
  let drag: { id: number; startY: number; lastY: number; lastT: number; velocity: number; restY: number; halfY: number; wasSnap: SheetSnap; from: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;
  function finish(commit: boolean) {
    if (!drag) return;
    let next: SheetSnap = drag.wasSnap;
    if (commit) {
      const { velocity, y, from, halfY, restY, wasSnap } = drag, dy = y - from;
      if (wasSnap === 'closed') {
        if (velocity < -0.4 || -dy > restY * 0.2) next = 'full';
      } else if (wasSnap === 'half') {
        if (velocity < -0.4 || -dy > halfY * 0.25) next = 'full';
        else if (velocity > 0.4 || dy > (restY - halfY) * 0.25) next = 'closed';
      } else {
        if (velocity > 0.4 || dy > restY * 0.25) next = 'closed';
      }
    }
    drag = null; document.body.classList.remove('is-sheet-dragging'); sheet().style.transform = ''; setSnap(next);
  }
  return {
    down(event: PointerEvent) {
      // Main button only: a right or middle press would otherwise start a drag the context menu then strands.
      if (!event.isPrimary || event.button !== 0) return;
      stopHints();
      const styles = getComputedStyle(document.documentElement), isPopup = popupOpen();
      const rest = parseFloat(styles.getPropertyValue(isPopup ? '--sheet-bar' : '--sheet-peek')) || (isPopup ? 52 : 192);
      const half = parseFloat(styles.getPropertyValue('--sheet-half')) || Math.round(window.innerHeight * 0.46);
      const h = sheet().offsetHeight, restY = Math.max(h - rest, 1), halfY = Math.max(0, Math.min(h - half, restY - 40));
      // Start from where the sheet is now, not from its snap point: caught mid-settle, it would otherwise jump to
      // the snap the moment dragging switches its transition off.
      const transform = getComputedStyle(sheet()).transform, live = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
      const wasSnap = snap(), from = Math.min(Math.max(live, 0), restY);
      drag = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, restY, halfY, wasSnap, from, y: from, moved: false };
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
    },
    move(event: PointerEvent) {
      if (!drag || drag.id !== event.pointerId) return;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(dy) < 6) return;
      drag.moved = true; document.body.classList.add('is-sheet-dragging');
      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) drag.velocity = (event.clientY - drag.lastY) / dt;
      drag.lastY = event.clientY; drag.lastT = event.timeStamp;
      drag.y = Math.min(Math.max(drag.from + dy, 0), drag.restY);
      sheet().style.transform = `translate3d(0, ${drag.y}px, 0)`;
    },
    up(event: PointerEvent) { if (drag?.id === event.pointerId) { suppressClick = drag.moved; finish(suppressClick); } },
    cancel(event: PointerEvent) { if (drag?.id === event.pointerId) finish(false); },
    click() {
      if (suppressClick) { suppressClick = false; return; }
      stopHints();
      // Half is the list a closed detail leaves behind, with "Lihat Daftar Lengkap" on the handle: a tap there
      // opens the full list, as the nudge suggests. Only the full sheet closes on a tap.
      setSnap(snap() === 'full' ? 'closed' : 'full');
    },
    // The keyboard's way through the three stops: Enter/Space toggle (click), the arrows step up or down one.
    key(event: KeyboardEvent) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault(); stopHints();
      const stops: SheetSnap[] = ['closed', 'half', 'full'], at = stops.indexOf(snap());
      const next = stops[Math.min(Math.max(at + (event.key === 'ArrowUp' ? 1 : -1), 0), stops.length - 1)];
      if (next !== snap()) setSnap(next);
    },
    dispose() { drag = null; document.body.classList.remove('is-sheet-dragging'); sheet().style.transform = ''; },
  };
}
