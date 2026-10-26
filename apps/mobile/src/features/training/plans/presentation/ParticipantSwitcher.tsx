import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent } from "react-native";
import { TabBarDock } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { counterpartOf, participantOrder, type CounterpartRef } from "../domain/ParticipantCounterpart.ts";
import type { GroupCopy } from "../domain/Placement.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useParticipantGroup } from "./useParticipantGroup.ts";
import type { PeriodizedPlan } from "../domain/PeriodizedModel.ts";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";

/**
 * Переключатель участников групповой программы (UI-OWN-043, как в 2.0): плавающая полоса с карточками
 * ФИО; первый — клиент, с которого открыта программа; при 3+ — прокрутка по горизонтали. Скрыт, если в группе
 * меньше двух участников. Состав — группа мезоцикла (UI-OWN-044): копии одного родства в любых программах
 * участников; вышедшие не показываются.
 */
export function ParticipantSwitcher({ clientId, activeClientId = clientId, anchorClientId, programId, mesocycleId, workoutId, repository, names,
  busy = false, onSelect, members: given, docked = false }: Readonly<{
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
  members?: readonly GroupCopy[] | null;
  /** Строка внутри нижней панели навигации: без собственных отступов и фона. */
  docked?: boolean;
}>) {
  const { members, fresh } = useParticipantGroup(repository, clientId, programId, mesocycleId, workoutId, given);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const select = useCallback((copy: GroupCopy) => selectRef.current(copy), []);
  if (members === null) return null;
  if (members.length < 2) return docked ? <TabBarDock>{null}</TabBarDock> : null;
  const strip = <ParticipantStrip group={members} activeClientId={activeClientId} anchorClientId={anchorClientId} names={names}
    busy={busy} fresh={fresh} onSelect={select} docked={docked} />;
  return docked ? <TabBarDock>{strip}</TabBarDock> : strip;
}

/**
 * Сама строка карточек участников. Отдельный компонент: при `docked` она монтируется в нижней панели навигации, и её состояние
 * (прокрутка, метки у краёв) живёт там, а не в экране.
 */
const ParticipantStrip = memo(function ParticipantStrip({ group, activeClientId, anchorClientId, names, busy, fresh, onSelect, docked }: Readonly<{
  group: readonly GroupCopy[];
  activeClientId: string;
  anchorClientId: string;
  names: ReadonlyMap<string, string>;
  busy: boolean;
  fresh: boolean;
  onSelect: (copy: GroupCopy) => void;
  docked: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
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
  useEffect(() => { scroll.current?.scrollTo({ x: Math.max(0, (positions.current.get(activeClientId) ?? 0) - 16), animated: true }); }, [activeClientId]);
  const byClient = useMemo(() => new Map(group.map((copy) => [copy.clientId, copy])), [group]);
  const ordered = useMemo(() => participantOrder(group.map((copy) => copy.clientId), anchorClientId), [group, anchorClientId]);
  total.current = ordered.length;
  return (
    <View style={docked ? null : [styles.wrap, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, docked ? styles.cardDocked : null, { backgroundColor: colors.border }]}>
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
                style={({ pressed }) => [styles.chip, docked ? styles.chipDocked : null, current ? shadow.control : null, {
                  backgroundColor: current ? colors.surface : pressed ? colors.surfaceRaised : "transparent", opacity: busy && !current ? 0.6 : 1 }]}>
                <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}
                  style={[styles.chipText, docked ? styles.chipTextDocked : null, current ? styles.chipCurrent : null, { color: current ? colors.accentInk : colors.textSecondary }]}>{name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {hidden.left > 0 ? <EdgeMark side="left" count={hidden.left} /> : null}
        {hidden.right > 0 ? <EdgeMark side="right" count={hidden.right} /> : null}
      </View>
    </View>
  );
});

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
  to: GroupCopy, ref: CounterpartRef, sourcePlan?: PeriodizedPlan | null) {
  const end = navigationPerformance.phase("counterpart");
  try {
    const refGroup = ref.workoutId !== null ? { workoutId: ref.workoutId }
      : ref.mesocycleId === null ? null : { mesocycleId: ref.mesocycleId };
    if (refGroup === null) return null;
    const members = await repository.getMesocycleGroup(from.clientId, from.programId, refGroup);
    if (!members.some((member) => member.clientId === to.clientId && member.programId === to.programId && member.mesocycleId === to.mesocycleId)) return null;
    const [source, target] = await Promise.all([sourcePlan ?? repository.getPeriodizedPlan(from.clientId, from.programId),
      repository.getPeriodizedPlan(to.clientId, to.programId)]);
    if (source === null || target === null) return null;
    const counterpart = counterpartOf(source.mesocycles, target.mesocycles, to.mesocycleId, ref);
    return counterpart === null ? null : { programId: to.programId, ...counterpart };
  } finally { end(); }
}

const CHIP_WIDTH = 150;
const CHIP_GAP = 4;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  card: { borderRadius: 14, padding: 3 },
  row: { gap: CHIP_GAP },
  chip: { width: CHIP_WIDTH, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  chipText: { fontFamily: fonts.semibold, fontSize: 15, textAlign: "center" },
  /** В нижней панели: строка 32 dp (рамка 2 + карточка 28 + рамка 2). */
  cardDocked: { borderRadius: 11, padding: 2 },
  chipDocked: { height: 28, borderRadius: 9 },
  chipTextDocked: { fontSize: 13 },
  mark: { position: "absolute", top: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, borderRadius: 12 },
  markLeft: { left: 8 },
  markRight: { right: 8 },
  markText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  chipCurrent: { fontFamily: fonts.bold },
});
