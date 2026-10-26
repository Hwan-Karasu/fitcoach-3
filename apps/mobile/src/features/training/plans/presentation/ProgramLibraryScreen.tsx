import { useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { CalendarDays, ChartColumnIncreasing, ChevronRight, CircleMinus, Clock, FileText, LayoutGrid, Plus, RefreshCw, Rocket,
  Archive, Ellipsis, Trash2, FileSpreadsheet, Pencil, SlidersHorizontal, TrendingUp, Users, Zap } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DropdownMenu, FloatingActionButton, InlineNotice, ListSectionHeader, LoadingState, SegmentedControl, TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import type { ProgramCard, ProgramKind } from "../domain/ProgramModel.ts";
import { membersWord, programKindLabels, PROGRAM_TITLE_MAX } from "../domain/ProgramRules.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import { useProgramLibrary } from "./useProgramLibrary.ts";
import type { ProgramDeletePort } from "../domain/PlanDeletion.ts";

function ProgramCardMenu({ card, busy, onExport, onArchive, onDelete, onRename }: Readonly<{
  card: ProgramCard; busy: boolean; onExport?: () => void; onArchive: () => void; onDelete?: () => void; onRename: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const anchor = useRef<View>(null); const [open, setOpen] = useState(false);
  return <>
    <View style={{ position: "absolute", top: 14, right: 12 }}>
      <AppIconButton label={`Действия программы: ${card.title}`} buttonRef={anchor} disabled={busy}
        icon={<Ellipsis size={22} color={palette.tokens.textPrimary} />} onPress={() => setOpen(true)} />
    </View>
    <DropdownMenu anchor={anchor} visible={open} title={card.title} selected="" onClose={() => setOpen(false)}
      options={[
        { value: "rename", label: "Переименовать программу", icon: (color: string) => <Pencil size={18} color={color} /> },
        ...(onExport ? [{ value: "export", label: "Экспорт в Excel", icon: (color: string) => <FileSpreadsheet size={18} color={color} /> }] : []),
        { value: "archive", label: "Архивировать", icon: (color: string) => <Archive size={18} color={color} /> },
        ...(onDelete ? [{ value: "delete", label: "Удалить", danger: true, icon: (color: string) => <Trash2 size={18} color={color} /> }] : [])
      ]} onSelect={(action) => { if (action === "rename") onRename(); else if (action === "export") onExport?.(); else if (action === "archive") onArchive(); else if (action === "delete") onDelete?.(); }} />
  </>;
}

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
export function ProgramModeChooserScreen({ onChoose, onOpenTemplates, onOpenExcel, renderExcelImport }: Readonly<{
  renderExcelImport?: (renderTrigger: (onPress: () => void, disabled: boolean) => ReactNode) => ReactNode;
  onOpenExcel?: () => void;
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
      {renderExcelImport ? renderExcelImport((onPress, disabled) => <FeatureRow title="Импортировать из Excel" detail="Планы и фактические результаты"
        icon={icon(FileSpreadsheet, 18)} onPress={onPress} disabled={disabled} />)
        : <FeatureRow title="Импортировать из Excel" detail="Планы и фактические результаты" icon={icon(FileSpreadsheet, 18)} onPress={onOpenExcel} />}
    </ScrollView>
  );
}

function ProgramCardRow({ card, selected, onPress, onRestore, hasMenu = false }: Readonly<{
  card: ProgramCard; selected: boolean; onPress?: () => void; onRestore?: () => void; hasMenu?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const meta = card.kind === "PERIODIZED" ? `${programKindLabels[card.kind]} · ${membersWord(card.memberCount)}`
    : programKindLabels[card.kind];
  const chip = (text: string, soft: boolean) => <Text style={[styles.chip, { color: soft ? colors.accentInk : colors.textSecondary,
    backgroundColor: soft ? colors.accentSoft : colors.surfaceRaised }]}>{text}</Text>;
  return (
    <Pressable accessibilityRole={onPress === undefined ? undefined : "button"} disabled={onPress === undefined}
      accessibilityLabel={`${card.title}. ${meta}${selected ? ". Текущая" : ""}`} onPress={onPress}
      style={({ pressed }) => [styles.card, styles.program, shadow.card, { paddingRight: hasMenu ? 68 : 16, borderColor: selected ? colors.accentInk : "transparent",
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <View style={styles.grow}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary, opacity: onRestore ? 0.6 : 1 }]}>{card.title}</Text>
        <View style={styles.chips}>
          {chip(programKindLabels[card.kind], card.kind === "PERIODIZED")}
          {card.kind === "PERIODIZED" ? chip(membersWord(card.memberCount), false) : null}
        </View>
      </View>
      {selected ? <Text style={[styles.current, { color: colors.onAccentFill, backgroundColor: colors.accentFill }]}>Текущая</Text> : null}
      {onRestore !== undefined ? <AppButton compact variant="secondary" label="Вернуть" onPress={onRestore} />
        : <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />}
    </Pressable>
  );
}

/** Строка раздела «Дополнительно»; `soon` — будущая функция: неактивна, с плашкой «Скоро». */
function FeatureRow({ icon: renderIcon, title, detail, onPress, soon = false, disabled = false }: Readonly<{
  icon: IconRender; title: string; detail: string; onPress?: () => void; soon?: boolean; disabled?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ disabled: soon || disabled }}
      disabled={soon || disabled} onPress={onPress}
      style={({ pressed }) => [styles.card, styles.feature, shadow.card, { borderColor: "transparent",
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
export type ProgramLibraryTab = "programs" | "templates" | "archive";
export const programLibraryTabTitles: Readonly<Record<ProgramLibraryTab, string>> = {
  programs: "Программы", templates: "Шаблоны", archive: "Архив программ" };

export function ProgramLibraryScreen({ clientId, repository, onChoose, onCreate, onOpenProgram, onOpenTemplates, renderTemplates, renderArchive,
  onTabChange, onExport, planDelete, renderExcelImport }: Readonly<{
  renderExcelImport?: (renderTrigger: (onPress: () => void, disabled: boolean) => ReactNode) => ReactNode;
  onExport?: (programId: string) => Promise<void>;
  planDelete?: ProgramDeletePort;
  clientId: string;
  repository: TrainingPlansRepositoryPort;
  /** Пустая библиотека: конструктор выбран прямо здесь. */
  onChoose: (kind: ProgramKind) => void;
  onCreate: () => void;
  onOpenProgram: (programId: string) => void;
  /** §48.16: библиотека шаблонов тренера. */
  onOpenTemplates?: () => void;
  /** Вкладки «Шаблоны» и «Архив программ» (решение владельца 2026-10-20): содержимое подставляет навигация. */
  renderTemplates?: () => ReactNode;
  renderArchive?: () => ReactNode;
  onTabChange?: (tab: ProgramLibraryTab) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { library, failed, reload } = useProgramLibrary(repository, clientId);
  const [tab, setTab] = useState<ProgramLibraryTab>("programs");
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [orderError, setOrderError] = useState(false);
  const [orderReset, setOrderReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState<{ kind: "archive" | "delete"; card: ProgramCard } | null>(null);
  const [renaming, setRenaming] = useState<{ card: ProgramCard; title: string } | null>(null);
  const run = async (task: () => Promise<void>) => {
    if (busy) return; setBusy(true); setActionError("");
    try { await task(); } catch (cause) { setActionError(cause instanceof Error && cause.message === "PROGRAM_REVISION_CONFLICT" ? "Программа изменилась. Повторите действие после обновления." : "Не удалось завершить действие. Повторите попытку."); reload(); }
    finally { setBusy(false); setPending(null); }
  };

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
    return <ProgramModeChooserScreen onChoose={onChoose} onOpenTemplates={onOpenTemplates} renderExcelImport={renderExcelImport} />;
  }

  const tabItems = [{ id: "programs" as const, label: programLibraryTabTitles.programs },
    ...(renderTemplates !== undefined ? [{ id: "templates" as const, label: programLibraryTabTitles.templates }] : []),
    ...(renderArchive !== undefined ? [{ id: "archive" as const, label: programLibraryTabTitles.archive }] : [])];
  const tabs = tabItems.length > 1 ? <View style={styles.tabs}>
    <SegmentedControl fit items={tabItems} selectedId={tab} onSelect={(next) => { setTab(next); onTabChange?.(next); }} />
  </View> : null;
  if (tab === "templates" && renderTemplates !== undefined) {
    return <View style={[styles.root, { backgroundColor: colors.canvas }]}>{tabs}{renderTemplates()}</View>;
  }
  if (tab === "archive" && renderArchive !== undefined) {
    return <View style={[styles.root, { backgroundColor: colors.canvas }]}>{tabs}{renderArchive()}</View>;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      {tabs}
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={[styles.content, styles.withFab]}>
        {failed ? <InlineNotice kind="error">Не удалось обновить список. Показан последний загруженный.</InlineNotice> : null}
        {!!actionError && <InlineNotice kind="error">{actionError}</InlineNotice>}
        {busy && <InlineNotice>Подготавливаем данные…</InlineNotice>}
        {orderError ? <InlineNotice kind="error">Не удалось сохранить порядок. Повторите перетаскивание.</InlineNotice> : null}
        {onOpenTemplates !== undefined && renderTemplates === undefined
          ? <AppButton compact variant="secondary" label="Шаблоны" onPress={onOpenTemplates} /> : null}
        <ListSectionHeader title="Программы" count={library.active.length} />
        {library.active.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Все программы в архиве — они на вкладке «Архив программ». Создайте новую или верните из архива.</Text>
        ) : (
          // Долгое нажатие — перетащить (порядок свой у этого клиента), короткое — открыть.
          <Sortable.Grid key={orderReset} data={[...library.active]} keyExtractor={(card) => card.id} columns={1} rowGap={10}
            scrollableRef={scrollRef} activeItemScale={1.03}
            renderItem={({ item }: Readonly<{ item: ProgramCard }>) => (
              <View><Sortable.Touchable onTap={() => onOpenProgram(item.id)} accessibilityRole="button"
                accessible accessibilityLabel={`${item.title}. ${programKindLabels[item.kind]}${item.id === library.selectedProgramId ? ". Текущая" : ""}`}
                onAccessibilityTap={() => onOpenProgram(item.id)}
                accessibilityHint="Долгое нажатие — перетащить">
                <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
                  <ProgramCardRow card={item} selected={item.id === library.selectedProgramId} hasMenu />
                </View>
              </Sortable.Touchable>
                <ProgramCardMenu card={item} busy={busy} onRename={() => { setActionError(""); setRenaming({ card: item, title: item.title }); }} onArchive={() => setPending({ kind: "archive", card: item })}
                  {...(onExport ? { onExport: () => { void run(() => onExport(item.id)); } } : {})}
                  {...(planDelete ? { onDelete: () => setPending({ kind: "delete", card: item }) } : {})} />
              </View>
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
        {renderArchive === undefined && library.archived.length > 0 ? <>
          <ListSectionHeader title="Архив" count={library.archived.length} />
          {library.archived.map((card) => (
            <ProgramCardRow key={card.id} card={card} selected={false}
              onRestore={() => { void repository.restoreForClient(clientId, card.id).catch(reload); }} />
          ))}
        </> : null}
      </Animated.ScrollView>
      <FloatingActionButton label="Создать программу" icon={(color) => <Plus size={26} color={color} strokeWidth={2} />}
        onPress={onCreate} />
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) setRenaming(null); }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 20, gap: 14 }}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Переименовать программу</Text>
            <TextField label="Название программы" required value={renaming?.title ?? ""} disabled={busy}
              hint={`До ${PROGRAM_TITLE_MAX} символов. Названия циклов не изменятся.`}
              onChangeText={(title) => setRenaming((form) => form ? { ...form, title } : null)} />
            {(renaming?.card.memberCount ?? 0) > 1 && <Text style={[styles.body, { color: colors.textSecondary }]}>Название изменится у всех участников этой программы.</Text>}
            {!!actionError && <InlineNotice kind="error">{actionError}</InlineNotice>}
            <AppButton label="Сохранить" busy={busy} disabled={!renaming?.title.trim() || renaming.title.trim().length > PROGRAM_TITLE_MAX}
              onPress={() => { if (!renaming) return; const form = renaming; void run(async () => {
                await repository.renameProgram(form.card.id, form.card.revision, form.title); setRenaming(null); reload();
              }); }} />
            <AppButton label="Отмена" variant="secondary" disabled={busy} onPress={() => setRenaming(null)} />
          </View>
        </View>
      </Modal>
      <ConfirmDialog visible={pending !== null} destructive={pending?.kind === "delete"} confirmBusy={busy}
        title={pending?.kind === "delete" ? `Удалить «${pending.card.title}»?` : `Архивировать «${pending?.card.title ?? ""}»?`}
        description={pending?.kind === "delete" ? "Программа и все её результаты будут удалены у этого клиента. Копии других участников останутся." : "Программа переместится в архив этого клиента. Её можно вернуть вместе с результатами."}
        confirmLabel={pending?.kind === "delete" ? "Удалить" : "Архивировать"} onCancel={() => setPending(null)}
        onConfirm={() => { if (!pending) return; const { card, kind } = pending; void run(() => kind === "archive" ? repository.archiveForClient(clientId, card.id) : planDelete!.deleteProgram({ clientId, programId: card.id, expectedRevision: card.revision })); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  content: { padding: 16, gap: 10 },
  withFab: { paddingBottom: 96 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chooser: { padding: 12, gap: 8 },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  feature: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 10, paddingVertical: 4, minHeight: 48 },
  featureIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16 },
  modes: { gap: 8 },
  card: { borderWidth: 2, borderRadius: 20 },
  mode: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  modeHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  modeTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  badge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, marginTop: 3 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10,
    padding: 6, minHeight: 42 },
  cellIcon: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  cellText: { flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  modeFooter: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  modeIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  program: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 12, paddingVertical: 14, minHeight: 64 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden" },
  current: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden" },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
