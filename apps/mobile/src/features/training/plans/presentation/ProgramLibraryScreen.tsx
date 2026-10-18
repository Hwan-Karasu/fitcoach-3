import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { ChevronRight, Layers, Plus, Repeat } from "lucide-react-native";
import { AppButton, FloatingActionButton, InlineNotice, ListSectionHeader, LoadingState,
  StatusTag } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ProgramCard, ProgramKind } from "../domain/ProgramModel.ts";
import { membersWord, programKindLabels } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useProgramLibrary } from "./useProgramLibrary.ts";

const modeDetails: Readonly<Record<ProgramKind, string>> = {
  SIMPLE: "Для одного клиента. План недели повторяется каждую неделю, результаты каждой недели — свои.",
  PERIODIZED: "Мезоциклы и свой план каждой недели. Одну программу можно назначить нескольким клиентам.",
};

/** §48.4: выбор конструктора — отдельный шаг; список существующих программ здесь не повторяется. */
export function ProgramModeChooser({ onChoose }: Readonly<{ onChoose: (kind: ProgramKind) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={styles.modes}>
      {(["SIMPLE", "PERIODIZED"] as const).map((kind) => (
        <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`${programKindLabels[kind]} программа. ${modeDetails[kind]}`}
          onPress={() => onChoose(kind)}
          style={({ pressed }) => [styles.card, styles.mode, { borderColor: colors.border,
            backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
          <View style={[styles.modeIcon, { backgroundColor: colors.surfaceRaised }]}>
            {kind === "SIMPLE" ? <Repeat size={22} color={colors.accentInk} strokeWidth={1.8} />
              : <Layers size={22} color={colors.accentInk} strokeWidth={1.8} />}
          </View>
          <View style={styles.grow}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{`${programKindLabels[kind]} программа`}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{modeDetails[kind]}</Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />
        </Pressable>
      ))}
    </View>
  );
}

/** Отдельный экран выбора конструктора (из «+ Создать программу»). */
export function ProgramModeChooserScreen({ onChoose }: Readonly<{ onChoose: (kind: ProgramKind) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Выберите конструктор.</Text>
      <ProgramModeChooser onChoose={onChoose} />
    </ScrollView>
  );
}

function ProgramCardRow({ card, selected, onPress, onRestore }: Readonly<{
  card: ProgramCard; selected: boolean; onPress?: () => void; onRestore?: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const meta = card.kind === "PERIODIZED" ? `${programKindLabels[card.kind]} · ${membersWord(card.memberCount)}`
    : programKindLabels[card.kind];
  return (
    <Pressable accessibilityRole={onPress === undefined ? undefined : "button"} disabled={onPress === undefined}
      accessibilityLabel={`${card.title}. ${meta}${selected ? ". Текущая" : ""}`} onPress={onPress}
      style={({ pressed }) => [styles.card, styles.program, { borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <View style={styles.grow}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary, opacity: onRestore ? 0.6 : 1 }]}>{card.title}</Text>
        <Text numberOfLines={2} style={[styles.meta, { color: colors.textSecondary }]}>{meta}</Text>
      </View>
      {selected ? <StatusTag kind="success" label="Текущая" /> : null}
      {onRestore !== undefined ? <AppButton compact variant="secondary" label="Вернуть" onPress={onRestore} />
        : <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />}
    </Pressable>
  );
}

/**
 * §48.4 корень вкладки «Тренировки»: список программ клиента (простые и расширенные вместе), а при
 * пустой библиотеке — сразу выбор конструктора. Архив — у участия этого клиента.
 */
export function ProgramLibraryScreen({ clientId, repository, onChoose, onCreate, onOpenProgram }: Readonly<{
  clientId: string;
  repository: TrainingPlansRepositoryPort;
  /** Пустая библиотека: конструктор выбран прямо здесь. */
  onChoose: (kind: ProgramKind) => void;
  onCreate: () => void;
  onOpenProgram: (programId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { library, failed, reload } = useProgramLibrary(repository, clientId);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [orderError, setOrderError] = useState(false);
  const [orderReset, setOrderReset] = useState(0);

  if (library === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        {failed ? <>
          <InlineNotice kind="error">Программы не загрузились. Данные не изменены.</InlineNotice>
          <AppButton variant="secondary" label="Повторить" onPress={reload} />
        </> : <LoadingState label="Открываем программы…" />}
      </View>
    );
  }

  if (library.active.length === 0 && library.archived.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Программ пока нет</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>Выберите конструктор для первой программы клиента.</Text>
        <ProgramModeChooser onChoose={onChoose} />
      </ScrollView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={[styles.content, styles.withFab]}>
        {failed ? <InlineNotice kind="error">Не удалось обновить список. Показан последний загруженный.</InlineNotice> : null}
        {orderError ? <InlineNotice kind="error">Не удалось сохранить порядок. Повторите перетаскивание.</InlineNotice> : null}
        <ListSectionHeader title="Программы" count={library.active.length} />
        {library.active.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Все программы в архиве. Создайте новую или верните из архива.</Text>
        ) : (
          // Долгое нажатие — перетащить (порядок свой у этого клиента), короткое — открыть.
          <Sortable.Grid key={orderReset} data={[...library.active]} keyExtractor={(card) => card.id} columns={1} rowGap={10}
            scrollableRef={scrollRef} activeItemScale={1.03}
            renderItem={({ item }: Readonly<{ item: ProgramCard }>) => (
              <Sortable.Touchable onTap={() => onOpenProgram(item.id)} accessibilityRole="button"
                accessible accessibilityLabel={`${item.title}. ${programKindLabels[item.kind]}${item.id === library.selectedProgramId ? ". Текущая" : ""}`}
                onAccessibilityTap={() => onOpenProgram(item.id)}
                accessibilityHint="Долгое нажатие — перетащить">
                <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
                  <ProgramCardRow card={item} selected={item.id === library.selectedProgramId} />
                </View>
              </Sortable.Touchable>
            )}
            onDragEnd={({ data }) => {
              setOrderError(false);
              void repository.reorderPrograms(clientId, data.map((card) => card.id)).catch(() => {
                setOrderError(true);
                setOrderReset((value) => value + 1);
                reload();
              });
            }} />
        )}
        {library.archived.length > 0 ? <>
          <ListSectionHeader title="Архив" count={library.archived.length} />
          {library.archived.map((card) => (
            <ProgramCardRow key={card.id} card={card} selected={false}
              onRestore={() => { void repository.restoreForClient(clientId, card.id).catch(reload); }} />
          ))}
        </> : null}
      </Animated.ScrollView>
      <FloatingActionButton label="Создать программу" icon={(color) => <Plus size={26} color={color} strokeWidth={2} />}
        onPress={onCreate} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  content: { padding: 16, gap: 10 },
  withFab: { paddingBottom: 96 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  modes: { gap: 10, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 12 },
  mode: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  modeIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  program: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 10, paddingVertical: 12, minHeight: 64 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
