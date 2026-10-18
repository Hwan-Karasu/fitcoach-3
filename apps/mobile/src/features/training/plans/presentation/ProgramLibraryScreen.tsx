import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { ChevronRight, FileText, Plus, Rocket, TrendingUp } from "lucide-react-native";
import { AppButton, FloatingActionButton, InlineNotice, ListSectionHeader, LoadingState,
  StatusTag } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ProgramCard, ProgramKind } from "../domain/ProgramModel.ts";
import { membersWord, programKindLabels } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useProgramLibrary } from "./useProgramLibrary.ts";

/** Короткие тезисы конструкторов (макет владельца 2026-10-18), по правилам §48.4. */
const modePoints: Readonly<Record<ProgramKind, readonly string[]>> = {
  SIMPLE: ["Быстрый старт", "Минимум настроек", "План недели повторяется", "Для одного клиента"],
  PERIODIZED: ["Мезоциклы и типы недель", "Свой план каждой недели", "Для нескольких клиентов",
    "Контроль прогресса"],
};

/** §48.4: выбор конструктора — отдельный шаг; список существующих программ здесь не повторяется. */
function ProgramModeChooser({ onChoose }: Readonly<{ onChoose: (kind: ProgramKind) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={styles.modes}>
      {(["SIMPLE", "PERIODIZED"] as const).map((kind) => (
        <Pressable key={kind} accessibilityRole="button"
          accessibilityLabel={`${programKindLabels[kind]} программа. ${modePoints[kind].join(". ")}`}
          onPress={() => onChoose(kind)}
          style={({ pressed }) => [styles.card, styles.mode, { borderColor: colors.border,
            backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
          <View style={[styles.modeIcon, { backgroundColor: colors.surfaceRaised }]}>
            {kind === "SIMPLE" ? <Rocket size={22} color={colors.accentInk} strokeWidth={1.8} />
              : <TrendingUp size={22} color={colors.accentInk} strokeWidth={1.8} />}
          </View>
          <View style={styles.grow}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{`${programKindLabels[kind]} программа`}</Text>
            {modePoints[kind].map((point) => (
              <View key={point} style={styles.point}>
                <View style={[styles.bullet, { backgroundColor: colors.textMuted }]} />
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{point}</Text>
              </View>
            ))}
          </View>
          <View style={styles.chevron}><ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} /></View>
        </Pressable>
      ))}
    </View>
  );
}

/** Отдельный экран выбора конструктора (из «+ Создать программу»): два конструктора и «Дополнительно». */
export function ProgramModeChooserScreen({ onChoose, onOpenTemplates }: Readonly<{
  onChoose: (kind: ProgramKind) => void;
  /** §48.16: программа из шаблона. */
  onOpenTemplates?: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={[styles.content, styles.chooser]}>
      <ProgramModeChooser onChoose={onChoose} />
      {onOpenTemplates !== undefined ? <>
        <ListSectionHeader title="Дополнительно" />
        <FeatureRow title="Создать из шаблона" detail="Готовые варианты программ"
          icon={(color) => <FileText size={20} color={color} strokeWidth={1.8} />} onPress={onOpenTemplates} />
      </> : null}
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

function FeatureRow({ icon, title, detail, onPress }: Readonly<{
  icon: (color: string) => ReactNode; title: string; detail: string; onPress: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} onPress={onPress}
      style={({ pressed }) => [styles.card, styles.feature, { borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <View style={[styles.featureIcon, { backgroundColor: colors.surfaceRaised }]}>{icon(colors.accentInk)}</View>
      <View style={styles.grow}>
        <Text style={[styles.featureTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{detail}</Text>
      </View>
      <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />
    </Pressable>
  );
}

/**
 * §48.4 корень вкладки «Тренировки»: список программ клиента (простые и расширенные вместе), а при
 * пустой библиотеке — сразу экран «Создать программу» (решение владельца 2026-10-18: без отдельного
 * экрана-приветствия, чтобы не дублировать выбор). Архив — у участия этого клиента.
 */
export function ProgramLibraryScreen({ clientId, repository, onChoose, onCreate, onOpenProgram, onOpenTemplates }: Readonly<{
  clientId: string;
  repository: TrainingPlansRepositoryPort;
  /** Пустая библиотека: конструктор выбран прямо здесь. */
  onChoose: (kind: ProgramKind) => void;
  onCreate: () => void;
  onOpenProgram: (programId: string) => void;
  /** §48.16: библиотека шаблонов тренера. */
  onOpenTemplates?: () => void;
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
    return <ProgramModeChooserScreen onChoose={onChoose} onOpenTemplates={onOpenTemplates} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={[styles.content, styles.withFab]}>
        {failed ? <InlineNotice kind="error">Не удалось обновить список. Показан последний загруженный.</InlineNotice> : null}
        {orderError ? <InlineNotice kind="error">Не удалось сохранить порядок. Повторите перетаскивание.</InlineNotice> : null}
        {onOpenTemplates !== undefined ? <AppButton compact variant="secondary" label="Шаблоны" onPress={onOpenTemplates} /> : null}
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
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  chooser: { paddingBottom: 96 },
  feature: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 12, paddingRight: 10, paddingVertical: 10, minHeight: 60 },
  featureIcon: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  modes: { gap: 10, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 12 },
  mode: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  chevron: { alignSelf: "center" },
  point: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bullet: { width: 4, height: 4, borderRadius: 2, marginTop: 7 },
  modeIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  program: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 10, paddingVertical: 12, minHeight: 64 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
