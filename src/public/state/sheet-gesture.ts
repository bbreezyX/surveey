// Preserve the established finger tracking, distance and velocity thresholds.
export function createSheetGesture(sheet: () => HTMLElement, opened: () => boolean, setOpened: (open: boolean) => void, stopHints: () => void) {
  let drag: { id: number; startY: number; lastY: number; lastT: number; velocity: number; travel: number; wasOpen: boolean; from: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;
  function finish(commit: boolean) {
    if (!drag) return;
    let open = drag.wasOpen;
    if (commit) {
      if (Math.abs(drag.velocity) > .4) open = drag.velocity < 0;
      else if (Math.abs(drag.y - drag.from) > drag.travel * .25) open = drag.y < drag.from;
    }
    drag = null; document.body.classList.remove('is-sheet-dragging'); sheet().style.transform = ''; setOpened(open);
  }
  return {
    down(event: PointerEvent) {
      if (!event.isPrimary) return;
      stopHints();
      const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) || 0;
      const travel = Math.max(sheet().offsetHeight - peek, 1), wasOpen = opened();
      drag = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, travel, wasOpen, from: wasOpen ? 0 : travel, y: wasOpen ? 0 : travel, moved: false };
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
      drag.y = Math.min(Math.max(drag.from + dy, 0), drag.travel);
      sheet().style.transform = `translate3d(0, ${drag.y}px, 0)`;
    },
    up(event: PointerEvent) { if (drag?.id === event.pointerId) { suppressClick = drag.moved; finish(suppressClick); } },
    cancel(event: PointerEvent) { if (drag?.id === event.pointerId) finish(false); },
    click() { if (suppressClick) { suppressClick = false; return; } stopHints(); setOpened(!opened()); },
    dispose() { drag = null; document.body.classList.remove('is-sheet-dragging'); sheet().style.transform = ''; },
  };
}
