import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { counterpartOf, participantOrder, type CounterpartRef } from "../domain/ParticipantCounterpart.ts";
import type { GroupCopy } from "../domain/Placement.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

/**
 * Переключатель участников групповой программы (UI-OWN-043, как в 2.0): закреплённая полоса под шапкой с карточками
 * ФИО; первый — клиент, с которого открыта программа; при 3+ — прокрутка по горизонтали. Скрыт, если в группе
 * меньше двух участников. Состав — группа мезоцикла (UI-OWN-044): копии одного родства в любых программах
 * участников; вышедшие не показываются.
 */
export function ParticipantSwitcher({ clientId, anchorClientId, programId, mesocycleId, workoutId, repository, names, busy = false,
  onSelect }: Readonly<{
  clientId: string;
  anchorClientId: string;
  programId: string;
  /** Мезоцикл, чья группа показывается (экран программы), или тренировка (дневник). */
  mesocycleId?: string | null;
  workoutId?: string;
  repository: TrainingPlansRepositoryPort;
  names: ReadonlyMap<string, string>;
  busy?: boolean;
  onSelect: (copy: GroupCopy) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [members, setMembers] = useState<readonly GroupCopy[]>([]);
  const [version, setVersion] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());

  useEffect(() => {
    let active = true;
    const ref = workoutId !== undefined ? { workoutId } : mesocycleId != null ? { mesocycleId } : null;
    if (ref === null) { setMembers([]); return () => { active = false; }; }
    repository.getMesocycleGroup(clientId, programId, ref).then((copies) => { if (active) setMembers(copies); }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId, mesocycleId, programId, repository, version, workoutId]);
  useEffect(() => repository.subscribeCommittedChanges(() => setVersion((value) => value + 1)), [repository]);
  useEffect(() => { scroll.current?.scrollTo({ x: Math.max(0, (positions.current.get(clientId) ?? 0) - 16), animated: true }); }, [clientId]);

  if (members.length < 2) return null;
  const byClient = new Map(members.map((copy) => [copy.clientId, copy]));
  const ordered = participantOrder(members.map((copy) => copy.clientId), anchorClientId);
  return (
    <View style={[styles.wrap, { backgroundColor: colors.canvas }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.textMuted }]}>УЧАСТНИКИ</Text>
        <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}
          keyboardShouldPersistTaps="handled">
          {ordered.map((id) => {
            const current = id === clientId;
            const name = names.get(id) ?? "Клиент";
            return (
              <Pressable key={id} accessibilityRole="button" accessibilityLabel={current ? `${name}, открыт` : `Переключиться на ${name}`}
                accessibilityState={{ selected: current, disabled: current || busy }} disabled={current || busy}
                onLayout={(event) => positions.current.set(id, event.nativeEvent.layout.x)} onPress={() => onSelect(byClient.get(id)!)}
                style={({ pressed }) => [styles.chip, { borderColor: current ? colors.accentFill : colors.border,
                  backgroundColor: current ? colors.accentFill : pressed ? colors.surfaceRaised : colors.input, opacity: busy && !current ? 0.6 : 1 }]}>
                <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}
                  style={[styles.chipText, { color: current ? colors.onAccentFill : colors.textPrimary }]}>{name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
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

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13, letterSpacing: 1.3 },
  row: { gap: 8 },
  chip: { width: 144, minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, textAlign: "center" },
});
