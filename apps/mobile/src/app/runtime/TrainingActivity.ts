/** Столько после последней записи дневника или плана тренировка считается идущей. */
export const TRAINING_QUIET_MS = 3 * 60 * 1000;

export interface TrainingActivityPorts {
  /** Таймеры отдыха на панели: пока хоть один есть, идёт тренировка. */
  readonly restTimers: Readonly<{ list(): readonly unknown[] }>;
  /** Подписки на коммиты дневника и планов; возвращают отписку. */
  readonly subscriptions: readonly ((listener: () => void) => () => void)[];
}

/**
 * Идёт ли сейчас тренировка (AUTO-BACKUP-3): таймер отдыха на панели или запись дневника/плана за последние 3 минуты. Автокопия в это
 * время не стартует и ждёт паузы — тяжёлая проверка копии не конкурирует с записью подходов.
 */
export function trackTrainingActivity(ports: TrainingActivityPorts, now: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY;
  const offs = ports.subscriptions.map((subscribe) => subscribe(() => { last = now(); }));
  return {
    quiet: () => ports.restTimers.list().length === 0 && now() - last >= TRAINING_QUIET_MS,
    dispose: () => { for (const off of offs) off(); },
  };
}
