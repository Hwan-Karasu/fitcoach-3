import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent } from "react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { counterpartOf, isGroupOfMesocycle, participantOrder, type CounterpartRef } from "../domain/ParticipantCounterpart.ts";
import type { GroupCopy } from "../domain/Placement.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

/**
 * Переключатель участников групповой программы (UI-OWN-043, как в 2.0): плавающая полоса с карточками
 * ФИО; первый — клиент, с которого открыта программа; при 3+ — прокрутка по горизонтали. Скрыт, если в группе
 * меньше двух участников. Состав — группа мезоцикла (UI-OWN-044): копии одного родства в любых программах
 * участников; вышедшие не показываются.
 */
export function ParticipantSwitcher({ clientId, activeClientId = clientId, anchorClientId, programId, mesocycleId, workoutId, repository, names,
  busy = false, onSelect, members: given }: Readonly<{
  /** Чьими данными читается состав группы (с `programId` и мезоцикл/тренировкой — одна идентичность). */
  clientId: string;
  /** Чей участник выделен: меняется сразу при выборе, раньше, чем загрузятся данные (по умолчанию — `clientId`). */
  activeClientId?: string;
  anchorClientId: string;
  programId: string;
  /** Мезоцикл, чья группа показывается (экран программы), или тренировка (дневник). */
  mesocycleId?: string | null;
  workoutId?: string;
  repository: TrainingPlansRepositoryPort;
  names: ReadonlyMap<string, string>;
  busy?: boolean;
  onSelect: (copy: GroupCopy) => void;
  /** Готовая группа: экран программы читает её сам и отдаёт сюда — переключатель не читает базу и не подписывается второй раз. */
  members?: readonly GroupCopy[];
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [read, setRead] = useState<readonly GroupCopy[]>([]);
  const [version, setVersion] = useState(0);
  const members = given ?? read;
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());
  /** Сколько карточек не видно слева и справа: полоса прокручивается, и по размеру не видно, что там есть ещё участники. */
  const [hidden, setHidden] = useState<Readonly<{ left: number; right: number }>>({ left: 0, right: 0 });
  const viewport = useRef(0);
  const total = useRef(0);
  const measure = (offset: number) => {
    const count = total.current;
    let left = 0; let right = 0;
    for (let index = 0; index < count; index += 1) {
      const start = index * (CHIP_WIDTH + CHIP_GAP);
      if (start + CHIP_WIDTH / 2 < offset) left += 1;
      else if (start + CHIP_WIDTH / 2 > offset + viewport.current) right += 1;
    }
    setHidden((current) => current.left === left && current.right === right ? current : { left, right });
  };
  const onScroll = (event: { nativeEvent: NativeScrollEvent }) => measure(event.nativeEvent.contentOffset.x);

  useEffect(() => {
    if (given !== undefined) return undefined;
    let active = true;
    const ref = workoutId !== undefined ? { workoutId } : mesocycleId != null ? { mesocycleId } : null;
    if (ref === null) { setRead([]); return () => { active = false; }; }
    repository.getMesocycleGroup(clientId, programId, ref).then((copies) => { if (active) setRead(copies); }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId, given, mesocycleId, programId, repository, version, workoutId]);
  // Выбор и порядок мезоциклов состав группы не меняют: без лишнего перечитывания на каждую смену мезоцикла.
  useEffect(() => given !== undefined ? undefined : repository.subscribeCommittedChanges((change) => {
    if (change.selectionOnly !== true && change.orderOnly !== true) setVersion((value) => value + 1);
  }), [given, repository]);
  useEffect(() => { scroll.current?.scrollTo({ x: Math.max(0, (positions.current.get(activeClientId) ?? 0) - 16), animated: true }); }, [activeClientId]);

  // Пока загружается состав нового мезоцикла, полоса показывает прежний и не нажимается: исчезни она на это время, весь экран под
  // ней сдвинулся бы вверх и вернулся вниз. Нажимать нельзя, чтобы не перейти к участнику прежнего мезоцикла.
  const fresh = workoutId !== undefined || mesocycleId == null || isGroupOfMesocycle(members, mesocycleId);
  const group = members;
  if (group.length < 2) return null;
  const byClient = new Map(group.map((copy) => [copy.clientId, copy]));
  const ordered = participantOrder(group.map((copy) => copy.clientId), anchorClientId);
  total.current = ordered.length;
  return (
    <View style={[styles.wrap, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.border }]}>
        <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}
          keyboardShouldPersistTaps="handled" scrollEventThrottle={32} onScroll={onScroll}
          onLayout={(event) => { viewport.current = event.nativeEvent.layout.width; measure(0); }}>
          {ordered.map((id) => {
            const current = id === activeClientId;
            const name = names.get(id) ?? "Клиент";
            return (
              <Pressable key={id} accessibilityRole="button" accessibilityLabel={current ? `${name}, открыт` : `Переключиться на ${name}`}
                accessibilityState={{ selected: current, disabled: current || busy || !fresh }} disabled={current || busy || !fresh}
                onLayout={(event) => positions.current.set(id, event.nativeEvent.layout.x)} onPress={() => onSelect(byClient.get(id)!)}
                style={({ pressed }) => [styles.chip, current ? shadow.control : null, {
                  backgroundColor: current ? colors.surface : pressed ? colors.surfaceRaised : "transparent", opacity: busy && !current ? 0.6 : 1 }]}>
                <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}
                  style={[styles.chipText, current ? styles.chipCurrent : null, { color: current ? colors.accentInk : colors.textSecondary }]}>{name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {hidden.left > 0 ? <EdgeMark side="left" count={hidden.left} /> : null}
        {hidden.right > 0 ? <EdgeMark side="right" count={hidden.right} /> : null}
      </View>
    </View>
  );
}

/** Метка у края полосы: за ним есть ещё карточки участников. Не нажимается — полоса листается жестом. */
function EdgeMark({ side, count }: Readonly<{ side: "left" | "right"; count: number }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <View pointerEvents="none" accessible accessibilityLabel={`Ещё участников ${side === "left" ? "слева" : "справа"}: ${count}`}
      style={[styles.mark, side === "left" ? styles.markLeft : styles.markRight, shadow.control, { backgroundColor: colors.surface }]}>
      {side === "left" ? <Icon size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
      <Text style={[styles.markText, { color: colors.accentInk }]}>{`+${count}`}</Text>
      {side === "right" ? <Icon size={16} color={colors.accentInk} strokeWidth={2.5} /> : null}
    </View>
  );
}

/** Где у участника группы (его копия — в его программе) то же место плана, что открыто у `fromClientId`. */
export async function participantTarget(repository: TrainingPlansRepositoryPort, from: Readonly<{ clientId: string; programId: string }>,
  to: GroupCopy, ref: CounterpartRef) {
  const [source, target] = await Promise.all([repository.getPeriodizedPlan(from.clientId, from.programId),
    repository.getPeriodizedPlan(to.clientId, to.programId)]);
  if (source === null || target === null) return null;
  return { programId: to.programId, ...counterpartOf(source.mesocycles, target.mesocycles, to.mesocycleId, ref) };
}

const CHIP_WIDTH = 150;
const CHIP_GAP = 4;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  card: { borderRadius: 14, padding: 3 },
  row: { gap: CHIP_GAP },
  chip: { width: CHIP_WIDTH, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  chipText: { fontFamily: fonts.semibold, fontSize: 15, textAlign: "center" },
  mark: { position: "absolute", top: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, borderRadius: 12 },
  markLeft: { left: 8 },
  markRight: { right: 8 },
  markText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  chipCurrent: { fontFamily: fonts.bold },
});
