import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { Appointment } from "../domain/CalendarModel.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { calendarErrorMessage } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const UNDO_MS = 3000;
const STROKE = 3;

interface Offer {
  readonly token: number;
  readonly before: Appointment;
  readonly after: Appointment;
  readonly title: string;
}

interface UndoContext {
  readonly offer: (before: Appointment, after: Appointment, title: string) => void;
  readonly current: Offer | null;
  readonly progress: Animated.Value;
  readonly busy: boolean;
  readonly error: string | null;
  readonly dontAsk: boolean;
  readonly undo: () => void;
  readonly toggleDontAsk: () => void;
  readonly registerHost: (base: boolean) => Readonly<{ id: number; unregister: () => void }>;
  readonly topHost: number | null;
}

const Context = createContext<UndoContext | null>(null);

/** Offer «Вернуть» after «Отменена»; a no-op outside the provider. */
export function useOfferCancelUndo(): (before: Appointment, after: Appointment, title: string) => void {
  return useContext(Context)?.offer ?? noop;
}

function noop(): void { /* No provider: nothing to offer. */ }

/**
 * §48.38.6 «Отменить отмену» as a 3-second undo: the border drains clockwise while time runs out;
 * «Больше не спрашивать» stores the choice in calendar settings. Hosts render the toast on top of
 * the shell or inside a modal, whichever was mounted last.
 */
export function CalendarUndoProvider({ repository, children }: Readonly<{
  repository: CalendarRepositoryPort; children: ReactNode;
}>) {
  const [current, setCurrent] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const [hosts, setHosts] = useState<readonly number[]>([]);
  const progress = useRef(new Animated.Value(0)).current;
  const tokens = useRef(0);
  const hostIds = useRef(0);

  const close = useCallback((token: number) => {
    setCurrent((offer) => (offer?.token === token ? null : offer));
  }, []);

  const countdown = useCallback((token: number) => {
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: UNDO_MS, easing: Easing.linear, useNativeDriver: false })
      .start(({ finished }) => { if (finished) close(token); });
  }, [close, progress]);

  const offer = useCallback((before: Appointment, after: Appointment, title: string) => {
    void repository.getSettings().then((settings) => {
      if (!settings.undoCancelPrompt) return;
      const token = ++tokens.current;
      setBusy(false);
      setError(null);
      setDontAsk(false);
      setCurrent({ token, before, after, title });
      countdown(token);
    }, () => undefined);
  }, [countdown, repository]);

  const undo = useCallback(() => {
    if (current === null || busy) return;
    progress.stopAnimation();
    setBusy(true);
    const previous = current.before.outcome === "CANCELLED" ? null : current.before.outcome;
    void repository.restoreCancelled(current.after.id, current.after.revision, previous).then(() => {
      close(current.token);
    }, (failure: unknown) => {
      setError(calendarErrorMessage(failure));
      countdown(current.token);
    }).finally(() => setBusy(false));
  }, [busy, close, countdown, current, progress, repository]);

  const toggleDontAsk = useCallback(() => {
    const next = !dontAsk;
    setDontAsk(next);
    void repository.setUndoCancelPrompt(!next).catch(() => {
      setDontAsk(!next);
      setError("Не удалось сохранить настройку.");
    });
  }, [dontAsk, repository]);

  const registerHost = useCallback((base: boolean) => {
    const id = ++hostIds.current;
    // The shell host stays at the bottom; a host inside a modal always wins.
    setHosts((list) => (base ? [id, ...list] : [...list, id]));
    return { id, unregister: () => setHosts((list) => list.filter((item) => item !== id)) };
  }, []);

  const value = useMemo<UndoContext>(() => ({
    offer, current, progress, busy, error, dontAsk, undo, toggleDontAsk, registerHost,
    topHost: hosts[hosts.length - 1] ?? null,
  }), [busy, current, dontAsk, error, hosts, offer, progress, registerHost, toggleDontAsk, undo]);

  return (
    <Context.Provider value={value}>
      {children}
      <CancelUndoHost lift={88} base />
    </Context.Provider>
  );
}

/** Place inside a Modal so the toast stays visible above it. */
export function CancelUndoHost({ lift = 24, base = false }: Readonly<{ lift?: number; base?: boolean }>) {
  const context = useContext(Context);
  const [id, setId] = useState<number | null>(null);
  const register = context?.registerHost;
  useEffect(() => {
    if (register === undefined) return;
    const host = register(base);
    setId(host.id);
    return host.unregister;
  }, [base, register]);
  if (context === null || context.current === null || id === null || context.topHost !== id) return null;
  return <CancelUndoToast context={context} lift={lift} />;
}

function CancelUndoToast({ context, lift }: Readonly<{ context: UndoContext; lift: number }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<Readonly<{ width: number; height: number }> | null>(null);
  const offer = context.current;
  if (offer === null) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + lift }]}>
      <View accessibilityLiveRegion="polite"
        onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {size !== null ? <DrainingBorder progress={context.progress} size={size} color={colors.accentFill} /> : null}
        <View style={styles.row}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{offer.title}</Text>
          <AppButton variant="ghost" label="Вернуть" accessibilityLabel="Вернуть отменённую запись"
            busy={context.busy} disabled={context.error !== null} onPress={context.undo} />
        </View>
        {context.error !== null ? (
          <Text style={[styles.error, { color: colors.danger }]}>{context.error}</Text>
        ) : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: context.dontAsk }}
          accessibilityLabel="Больше не спрашивать" onPress={context.toggleDontAsk} style={styles.check}>
          <View style={[styles.box, { borderColor: colors.accentInk,
            backgroundColor: context.dontAsk ? colors.accentFill : "transparent" }]}>
            {context.dontAsk ? <Text style={[styles.tick, { color: colors.onAccentFill }]}>✓</Text> : null}
          </View>
          <Text style={[styles.checkLabel, { color: colors.textSecondary }]}>Больше не спрашивать</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Remaining time as a line along the border, consumed clockwise from the top-left corner. */
function DrainingBorder({ progress, size, color }: Readonly<{
  progress: Animated.Value; size: Readonly<{ width: number; height: number }>; color: string;
}>) {
  const { width: w, height: h } = size;
  const total = 2 * (w + h);
  const left = (offset: number, length: number) => progress.interpolate({
    inputRange: [offset / total, (offset + length) / total], outputRange: [length, 0], extrapolate: "clamp",
  });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.edge, { top: 0, right: 0, height: STROKE, width: left(0, w), backgroundColor: color }]} />
      <Animated.View style={[styles.edge, { bottom: 0, right: 0, width: STROKE, height: left(w, h), backgroundColor: color }]} />
      <Animated.View style={[styles.edge, { bottom: 0, left: 0, height: STROKE, width: left(w + h, w), backgroundColor: color }]} />
      <Animated.View style={[styles.edge, { top: 0, left: 0, width: STROKE, height: left(2 * w + h, h), backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16 },
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden", paddingHorizontal: 16, paddingVertical: 10, gap: 4,
    elevation: 8, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  edge: { position: "absolute" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
  error: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  check: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  box: { width: 22, height: 22, borderWidth: 2, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  tick: { fontSize: 13, lineHeight: 14, fontFamily: fonts.bold },
  checkLabel: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
