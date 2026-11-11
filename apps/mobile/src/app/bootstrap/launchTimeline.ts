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

/**
 * Когда заставка убирается раньше входа в приложение (и больше не возвращается в этом запуске): сбой запуска, незавершённое восстановление
 * или обслуживание базы уже работающего приложения. Обслуживание до готовности приложения заставку НЕ снимает: журнал когда-либо
 * выполненного восстановления остаётся на диске, и его проверка под закрытой базой идёт на каждом холодном старте — раньше она
 * гасила заставку и до конца загрузки оставался светлый экран «Подготовка приложения» (ARCH-HARDEN-1b).
 */
export function endsLaunchIntro(input: Readonly<{ bootFailed: boolean; appReady: boolean;
  maintenance: "ACTIVE" | "DRAINING" | "CLOSED" | "REOPENING" | "RECOVERY_REQUIRED" }>): boolean {
  if (input.bootFailed || input.maintenance === "RECOVERY_REQUIRED") return true;
  return input.appReady && input.maintenance !== "ACTIVE";
}
