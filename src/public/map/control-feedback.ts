/** Existing control ripple, pointer proximity and pressed states, with owned cleanup. */
export function attachControlFeedback(zoom: Element | null, switcher: Element | null, toggle: HTMLElement | null) {
  const cleanup: (() => void)[] = [], timers = new Set<ReturnType<typeof setTimeout>>();
  const listen = (node: EventTarget, name: string, handler: EventListener) => { node.addEventListener(name, handler); cleanup.push(() => node.removeEventListener(name, handler)); };
  function ripple(trigger: HTMLElement, host: Element) {
    const layer = document.createElement('span'); layer.className = 'ctl-ripple'; layer.setAttribute('aria-hidden', 'true'); host.prepend(layer);
    cleanup.push(() => layer.remove());
    listen(trigger, 'pointerdown', raw => {
      const event = raw as PointerEvent; if (event.button !== 0) return;
      const rect = layer.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      const size = Math.ceil(Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2);
      const wave = document.createElement('span'); wave.className = 'ctl-ripple__wave';
      Object.assign(wave.style, { width: `${size}px`, height: `${size}px`, left: `${x - size / 2}px`, top: `${y - size / 2}px` });
      layer.append(wave); const timer = setTimeout(() => { wave.remove(); timers.delete(timer); }, 700); timers.add(timer);
      wave.addEventListener('animationend', () => wave.remove(), { once: true });
    });
  }
  if (zoom) {
    for (const [selector, label] of [['.ol-zoom-in', 'Perbesar'], ['.ol-zoom-out', 'Perkecil']]) {
      const button = zoom.querySelector<HTMLButtonElement>(selector); if (!button) continue;
      const glyph = document.createElement('span'); glyph.className = 'ctl-glyph'; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = button.textContent;
      button.replaceChildren(glyph); button.setAttribute('aria-label', label); button.dataset.tooltip = label; button.removeAttribute('title'); ripple(button, button);
    }
    listen(zoom, 'pointerdown', raw => { if ((raw as PointerEvent).button === 0) zoom.classList.add('is-pressed'); });
    const release = () => zoom.classList.remove('is-pressed');
    for (const event of ['pointerup', 'pointercancel']) listen(window, event, release);
    listen(zoom, 'pointerleave', release);
  }
  if (toggle) { toggle.dataset.tooltip = 'Tampilkan daftar'; ripple(toggle, toggle); }
  const button = switcher?.querySelector<HTMLButtonElement>(':scope > button'), slot = switcher?.querySelector('.ctl-layers-slot');
  if (button && slot) ripple(button, slot);
  const panel = switcher?.querySelector('.panel');
  if (panel) {
    const release = () => panel.querySelectorAll('.ctl-switch.is-pressed').forEach(element => element.classList.remove('is-pressed'));
    listen(panel, 'pointerdown', raw => { const event = raw as PointerEvent; if (event.button === 0 && event.target instanceof Element) event.target.closest('li.layer')?.querySelector('.ctl-switch')?.classList.add('is-pressed'); });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave', 'focusout']) listen(panel, event, release);
    listen(panel, 'keydown', raw => { if ((raw as KeyboardEvent).key === ' ' && raw.target instanceof Element) raw.target.closest('.ctl-switch')?.classList.add('is-pressed'); });
    listen(panel, 'keyup', release);
  }
  const targets = [zoom, switcher, toggle].filter((node): node is Element => node !== null);
  let frame = 0, stale = true, x = 0, y = 0, rects: DOMRect[] = [];
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const invalidate = () => { stale = true; };
    listen(window, 'resize', invalidate); for (const target of targets) listen(target, 'transitionend', invalidate);
    listen(window, 'pointermove', raw => {
      const event = raw as PointerEvent; if (event.pointerType && event.pointerType !== 'mouse') return;
      x = event.clientX; y = event.clientY; if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0; if (stale) { rects = targets.map(node => node.getBoundingClientRect()); stale = false; }
        targets.forEach((node, index) => { const rect = rects[index]; if (rect.width) { const dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom); node.classList.toggle('is-near', dx * dx + dy * dy <= 8100); } });
      });
    });
    listen(document, 'pointerleave', () => targets.forEach(node => node.classList.remove('is-near')));
  }
  return () => { cleanup.forEach(dispose => dispose()); timers.forEach(timer => clearTimeout(timer)); cancelAnimationFrame(frame); targets.forEach(node => node.classList.remove('is-near', 'is-pressed')); };
}
