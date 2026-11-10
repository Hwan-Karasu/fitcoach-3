import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmationMode } from "../domain/ExecutionModel.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";

type Source = Pick<TrainingExecutionPort, "getConfirmationMode" | "setConfirmationMode">;

/** Выбор виден сразу; записи идут по порядку, откат — только последнего выбора к подтверждённому значению. */
export function useConfirmationMode(source: Source, focused: boolean) {
  const session = useMemo(() => ({ source, selected: null as ConfirmationMode | null, persisted: null as ConfirmationMode | null,
    request: 0, tail: Promise.resolve(), active: true }), [source]);
  const current = useRef(session);
  current.current = session;
  const [snapshot, setSnapshot] = useState({ session, mode: session.selected, error: null as string | null });
  const publish = useCallback((error: string | null) => {
    if (session.active && current.current === session) setSnapshot({ session, mode: session.selected, error });
  }, [session]);

  useEffect(() => { session.active = true; return () => { session.active = false; }; }, [session]);
  useEffect(() => {
    if (!focused) return;
    let active = true;
    const request = session.request;
    void session.tail.then(() => source.getConfirmationMode()).then((next) => {
      if (!active || request !== session.request) return;
      session.persisted = next; session.selected = next; publish(null);
    }, () => { if (active && request === session.request) publish("Не удалось загрузить настройку."); });
    return () => { active = false; };
  }, [focused, publish, session, source]);

  const choose = useCallback((next: ConfirmationMode) => {
    if (session.selected === next) return;
    const request = ++session.request;
    session.selected = next; publish(null);
    session.tail = session.tail.then(() => source.setConfirmationMode(next)).then(() => {
      session.persisted = next;
      if (request === session.request) publish(null);
    }, () => {
      if (request !== session.request) return;
      session.selected = session.persisted;
      publish("Не удалось сохранить. Режим не изменён — повторите.");
    });
  }, [publish, session, source]);

  return { mode: snapshot.session === session ? snapshot.mode : null,
    error: snapshot.session === session ? snapshot.error : null, choose };
}
