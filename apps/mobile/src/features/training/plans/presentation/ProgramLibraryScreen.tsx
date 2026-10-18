import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { CalendarDays, ChartColumnIncreasing, ChevronRight, CircleMinus, Clock, FileText, LayoutGrid, Plus, RefreshCw, Rocket,
  FileSpreadsheet, SlidersHorizontal, TrendingUp, Users, Zap } from "lucide-react-native";
import { AppButton, FloatingActionButton, InlineNotice, ListSectionHeader, LoadingState,
  StatusTag } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ProgramCard, ProgramKind } from "../domain/ProgramModel.ts";
import { membersWord, programKindLabels } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useProgramLibrary } from "./useProgramLibrary.ts";

type IconRender = (color: string) => ReactNode;
const icon = (Icon: typeof Rocket, size = 20): IconRender => (color) => <Icon size={size} color={color} strokeWidth={1.8} />;

/** Описание конструктора (макет владельца 2026-10-18), по правилам §48.4: ячейки — пояснение, не кнопки. */
interface ModeInfo {
  readonly icon: IconRender;
  readonly subtitle: string;
  readonly badge: string;
  readonly cells: readonly Readonly<{ icon: IconRender; label: string }>[];
  readonly footerIcon: IconRender;
  readonly footer: string;
}

const modeInfo: Readonly<Record<ProgramKind, ModeInfo>> = {
  SIMPLE: {
    icon: icon(Rocket), subtitle: "Минимум настроек для быстрого начала", badge: "Быстрый старт",
    cells: [{ icon: icon(CalendarDays, 16), label: "Тренировки и недели" }, { icon: icon(FileText, 16), label: "Шаблоны" },
      { icon: icon(SlidersHorizontal, 16), label: "Минимум настроек" }, { icon: icon(CircleMinus, 16), label: "Без циклов" }],
    footerIcon: icon(Zap, 16), footer: "Один клиент, план недели повторяется",
  },
  PERIODIZED: {
    icon: icon(TrendingUp), subtitle: "Планирование и контроль прогресса", badge: "Периодизация",
    cells: [{ icon: icon(LayoutGrid, 16), label: "Мезоциклы и блоки" }, { icon: icon(RefreshCw, 16), label: "Смена циклов" },
      { icon: icon(Users, 16), label: "Несколько клиентов" }, { icon: icon(ChartColumnIncreasing, 16), label: "Контроль прогресса" }],
    footerIcon: icon(Clock, 16), footer: "Для долгих программ с циклами",
  },
};

/** §48.4: выбор конструктора — отдельный шаг; список существующих программ здесь не повторяется. */
function ProgramModeChooser({ onChoose }: Readonly<{ onChoose: (kind: ProgramKind) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={styles.modes}>
      {(["SIMPLE", "PERIODIZED"] as const).map((kind) => {
        const info = modeInfo[kind];
        const title = `${programKindLabels[kind]} программа`;
        return (
          <Pressable key={kind} accessibilityRole="button"
            accessibilityLabel={`${title}. ${info.subtitle}. ${info.cells.map((cell) => cell.label).join(", ")}. ${info.footer}`}
            onPress={() => onChoose(kind)}
            style={({ pressed }) => [styles.mode, { borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
            <View style={styles.modeHead}>
              <View style={[styles.modeIcon, { backgroundColor: colors.surfaceRaised }]}>{info.icon(colors.accentInk)}</View>
              <View style={styles.grow}>
                <Text style={[styles.modeTitle, { color: colors.textPrimary }]}>{title}</Text>
                <Text style={[styles.small, { color: colors.textSecondary }]}>{info.subtitle}</Text>
                <View style={[styles.badge, { borderColor: colors.accentInk }]}>
                  <Text style={[styles.badgeText, { color: colors.accentInk }]}>{info.badge}</Text>
                </View>
              </View>
            </View>
            <View style={styles.cells}>
              {info.cells.map((cell) => (
                <View key={cell.label} style={[styles.cell, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={[styles.cellIcon, { backgroundColor: colors.surfaceRaised }]}>{cell.icon(colors.accentInk)}</View>
                  <Text style={[styles.cellText, { color: colors.textPrimary }]}>{cell.label}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.modeFooter, { borderTopColor: colors.border }]}>
              {info.footerIcon(colors.accentInk)}
              <Text style={[styles.small, styles.grow, { color: colors.textSecondary }]}>{info.footer}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Отдельный экран выбора конструктора (из «+ Создать программу»): два конструктора и «Дополнительно».
 * Плотная вёрстка — всё помещается на один экран телефона (просьба владельца 2026-10-18).
 */
export function ProgramModeChooserScreen({ onChoose, onOpenTemplates }: Readonly<{
  onChoose: (kind: ProgramKind) => void;
  /** §48.16: программа из шаблона. */
  onOpenTemplates?: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.chooser}>
      <ProgramModeChooser onChoose={onChoose} />
      <ListSectionHeader title="Дополнительно" />
      {onOpenTemplates !== undefined ? <FeatureRow title="Создать из шаблона" detail="Готовые варианты программ"
        icon={icon(FileText, 18)} onPress={onOpenTemplates} /> : null}
      {/* Импорт исключён из V1 (UI-OWN-024); владелец оставил место под будущую функцию — строка неактивна. */}
      <FeatureRow title="Импортировать из Excel" detail="Будет в следующих версиях" icon={icon(FileSpreadsheet, 18)} soon />
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

/** Строка раздела «Дополнительно»; `soon` — будущая функция: неактивна, с плашкой «Скоро». */
function FeatureRow({ icon: renderIcon, title, detail, onPress, soon = false }: Readonly<{
  icon: IconRender; title: string; detail: string; onPress?: () => void; soon?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ disabled: soon }}
      disabled={soon} onPress={onPress}
      style={({ pressed }) => [styles.card, styles.feature, { borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <View style={[styles.featureIcon, { backgroundColor: colors.surfaceRaised }]}>{renderIcon(soon ? colors.textMuted : colors.accentInk)}</View>
      <View style={styles.grow}>
        <Text style={[styles.featureTitle, { color: soon ? colors.textSecondary : colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.small, { color: colors.textSecondary }]}>{detail}</Text>
      </View>
      {soon ? <View style={[styles.badge, { borderColor: colors.border }]}>
        <Text style={[styles.badgeText, { color: colors.textSecondary }]}>Скоро</Text>
      </View> : <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />}
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
  chooser: { padding: 12, gap: 8 },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  feature: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 10, paddingVertical: 4, minHeight: 48 },
  featureIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  modes: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 12 },
  mode: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  modeHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  modeTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  badge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, marginTop: 3 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10,
    padding: 6, minHeight: 42 },
  cellIcon: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  cellText: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 },
  modeFooter: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  modeIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  program: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 10, paddingVertical: 12, minHeight: 64 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
