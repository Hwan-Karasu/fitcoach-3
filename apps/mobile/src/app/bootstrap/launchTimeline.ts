/** Milliseconds on one UI-thread clock; the settled image never loops. */
export const LAUNCH_DURATION_MS = 2000;
/** A missing native image callback must not block application entry forever. */
export const LAUNCH_ASSET_GRACE_MS = 250;
export const LAUNCH_EXIT_MS = 180;
export const LAUNCH_SETTLED_MS = 1650;
export const LAUNCH_BACKGROUND = "#00171C";

export function smoothProgress(time: number, from: number, to: number): number {
  "worklet";
  const t = Math.min(1, Math.max(0, (time - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function facetReveal(time: number, order: number): number {
  "worklet";
  const start = 450 + order * 220;
  return smoothProgress(time, start, start + 380);
}

/** Each face catches the travelling light at its own position and angle. */
export function facetReflection(time: number, x: number, y: number, strength: number): number {
  "worklet";
  const arrival = 1100 + x * 4.5 + (50 - y) * 0.8;
  const distance = Math.abs(time - arrival) / 105;
  const pulse = Math.max(0, 1 - distance);
  return pulse * pulse * strength * smoothProgress(time, 1050, 1120)
    * (1 - smoothProgress(time, 1550, LAUNCH_SETTLED_MS));
}

/** Owner decision 2026-11-10: show the complete two-second sequence before entering.
 * Reduced motion/interrupted launches settle immediately without replay. */
export function canExitLaunch(ready: boolean, foreground: boolean, animationComplete: boolean): boolean {
  "worklet";
  return ready && foreground && animationComplete;
}
