import { cubicOut, cubicIn } from 'svelte/easing';

export const UNFOLD_KEY = 'admin:unfold';

export function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
// Below this width the wings are panes inside the sheet, not folds.
export function narrow() { return innerWidth <= 1060; }

// Wings rotate on their hinge (the sheet edge). Only the first appearance
// after a reload is instant unless the user just logged in; every later
// appearance (switching back to Titik, logging out) animates.
let animate = false;
export function allowMotion() { animate = true; }

export function fold(_node: Element, { side, delay = 0 }: { side: 'left' | 'right'; delay?: number }) {
  const duration = !animate || reducedMotion() || narrow() ? 0 : 480;
  const sign = side === 'left' ? -1 : 1;
  return {
    delay: duration ? delay : 0, duration,
    easing: cubicOut,
    css: (t: number) => `transform: perspective(1800px) rotateY(${sign * 92 * (1 - t)}deg); opacity: ${t < 0.02 ? 0 : 1}; --shade: ${0.5 * (1 - t)}`,
  };
}
export function foldAway(node: Element, params: { side: 'left' | 'right' }) {
  const spec = fold(node, params);
  return { ...spec, delay: 0, duration: spec.duration ? 260 : 0, easing: cubicIn };
}
