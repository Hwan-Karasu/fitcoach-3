import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmDialog, InlineNotice, SectionTabs, SelectionChip, StickyEditorFooter, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientRecord, CreateClientInput } from "../domain/ClientRepositoryPort.ts";
import type { ClientFormDraft } from "../domain/ClientRecoveryDraftPort.ts";
import { formatHeightCmX10, parseHeightCmX10, validPastBirthDate } from
  "../domain/ClientProfileValidation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const emojiChoices = ["🏋️", "🏃", "🚴", "🧘", "💪", "🔥"] as const;

const sections = [
  { id: "basic", title: "Основное", description: "Имя и контакты" },
  { id: "goals", title: "Цель", description: "Вопросы будут загружаться из опубликованной схемы анкеты." },
  { id: "health", title: "Здоровье", description: "Ответы анкеты не подменяют актуальные ограничения клиента." },
  { id: "lifestyle", title: "Образ жизни", description: "Раздел появится после подключения схемы анкеты." },
  { id: "nutrition", title: "Питание", description: "Вес будет отдельным измерением, а не полем профиля." },
  { id: "motivation", title: "Мотивация", description: "Раздел появится после подключения схемы анкеты." },
  { id: "additional", title: "Дополнительно", description: "Опубликованные дополнительные вопросы появятся здесь." },
] as const;

type SectionId = typeof sections[number]["id"];

export function ClientEditorPreview({ onClose, onSave, onSaveDraft, onDiscardDraft,
  initial, initialDraft, recoveredDraft = false }: Readonly<{
  onClose: () => void;
  onSave: (input: CreateClientInput) => Promise<void>;
  onSaveDraft: (form: ClientFormDraft) => Promise<void>;
  onDiscardDraft: () => Promise<void>;
  initial?: ClientRecord;
  initialDraft?: ClientFormDraft;
  recoveredDraft?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const scrollRef = useRef<ScrollView>(null);
  const closeButtonRef = useRef<View>(null);
  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const birthDateRef = useRef<TextInput>(null);
  const heightRef = useRef<TextInput>(null);
  const sectionOffsets = useRef<Partial<Record<SectionId, number>>>({});
  const [displayName, setDisplayName] = useState(initialDraft?.displayName ?? initial?.displayName ?? "");
  const [phone, setPhone] = useState(initialDraft?.contactPhone ?? initial?.contactPhone ?? "");
  const [email, setEmail] = useState(initialDraft?.contactEmail ?? initial?.contactEmail ?? "");
  const [birthDate, setBirthDate] = useState(initialDraft?.birthDate ?? initial?.birthDate ?? "");
  const [heightDraft, setHeightDraft] = useState(initialDraft?.heightDraft
    ?? formatHeightCmX10(initial?.heightCmX10 ?? null));
  const [emoji, setEmoji] = useState<string | null>(initialDraft?.emoji ?? initial?.emoji ?? null);
  const [nameError, setNameError] = useState(false);
  const [birthDateError, setBirthDateError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("basic");
  const [confirmExitVisible, setConfirmExitVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const savingRef = useRef(false);
  const pendingDraftWrite = useRef<Promise<void> | null>(null);
  const dirty = initial === undefined
    ? Boolean(displayName.trim() || phone.trim() || email.trim()
      || birthDate.trim() || heightDraft.trim() || emoji)
    : displayName !== initial.displayName || phone !== (initial.contactPhone ?? "")
      || email !== (initial.contactEmail ?? "") || birthDate !== (initial.birthDate ?? "")
      || heightDraft !== formatHeightCmX10(initial.heightCmX10) || emoji !== initial.emoji;
  const formRef = useRef<ClientFormDraft>({ displayName, contactPhone: phone,
    contactEmail: email, birthDate, heightDraft, emoji });
  formRef.current = { displayName, contactPhone: phone, contactEmail: email,
    birthDate, heightDraft, emoji };

  const persistDraft = useCallback((form: ClientFormDraft): Promise<void> => {
    const write = onSaveDraft(form).then(() => {
      setDraftError(null);
      setDraftSaved(true);
    }).catch(() => {
      setDraftError("Не удалось сохранить черновик. Не закрывайте форму, пока ошибка не устранена.");
      setDraftSaved(false);
      throw new Error("CLIENT_DRAFT_SAVE_FAILED");
    });
    pendingDraftWrite.current = write;
    return write;
  }, [onSaveDraft]);

  useEffect(() => {
    if (!dirty || savingRef.current) return;
    setDraftSaved(false);
    const timer = setTimeout(() => {
      if (!savingRef.current) void persistDraft(formRef.current).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [displayName, phone, email, birthDate, heightDraft, emoji, dirty, persistDraft]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" && dirty && !savingRef.current) {
        void persistDraft(formRef.current).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [dirty, persistDraft]);

  const close = useCallback(() => {
    if (savingRef.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmExitVisible(true);
  }, [dirty, onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    scrollRef.current?.scrollTo({ y: sectionOffsets.current[id] ?? 0, animated: true });
  };

  const syncSectionWithScroll = (scrollY: number) => {
    let visibleSection: SectionId = "basic";
    for (const section of sections) {
      if ((sectionOffsets.current[section.id] ?? Number.POSITIVE_INFINITY) <= scrollY + 40) {
        visibleSection = section.id;
      }
    }
    setActiveSection((current) => current === visibleSection ? current : visibleSection);
  };

  const trySave = async () => {
    if (savingRef.current) return;
    if (!displayName.trim()) {
      setNameError(true);
      setMessage("Имя клиента обязательно.");
      scrollToSection("basic");
      nameRef.current?.focus();
      return;
    }
    const normalizedBirthDate = birthDate.trim() || null;
    if (!validPastBirthDate(normalizedBirthDate)) {
      setBirthDateError(true);
      setMessage("Введите действительную дату рождения в прошлом в формате ГГГГ-ММ-ДД.");
      scrollToSection("basic");
      birthDateRef.current?.focus();
      return;
    }
    const heightCmX10 = parseHeightCmX10(heightDraft);
    if (heightCmX10 === "invalid") {
      setHeightError(true);
      setMessage("Введите положительный рост в сантиметрах, максимум один знак после запятой.");
      scrollToSection("basic");
      heightRef.current?.focus();
      return;
    }
    setNameError(false);
    setBirthDateError(false);
    setHeightError(false);
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    let created = false;
    try {
      await pendingDraftWrite.current?.catch(() => undefined);
      await persistDraft(formRef.current);
      await onSave({ displayName, contactPhone: phone, contactEmail: email,
        birthDate: normalizedBirthDate, heightCmX10, emoji });
      created = true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "CLIENT_EMAIL_INVALID" ? "Проверьте адрес электронной почты."
        : code === "CLIENT_FIELD_TOO_LONG" ? "Слишком длинное значение одного из полей."
          : code === "CLIENT_STALE_OR_WRONG_SCOPE" ? "Карточка изменилась. Закройте форму и откройте её снова."
            : code === "CLIENT_DRAFT_SAVE_FAILED" ? "Не удалось защитить ввод черновиком. Повторите сохранение."
          : "Не удалось сохранить карточку. Введённые данные остались в форме; попробуйте ещё раз.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (created) onClose();
  };

  const leaveWithDraft = async () => {
    if (exitBusy) return;
    savingRef.current = true;
    setExitBusy(true);
    try {
      await pendingDraftWrite.current?.catch(() => undefined);
      await persistDraft(formRef.current);
      setConfirmExitVisible(false);
      onClose();
    } catch { setConfirmExitVisible(false); }
    finally { savingRef.current = false; setExitBusy(false); }
  };

  const discardAndExit = async () => {
    if (exitBusy) return;
    savingRef.current = true;
    setExitBusy(true);
    try {
      await pendingDraftWrite.current?.catch(() => undefined);
      await onDiscardDraft();
      setConfirmExitVisible(false);
      onClose();
    } catch {
      setDraftError("Не удалось удалить черновик. Ввод остался на экране.");
      setConfirmExitVisible(false);
    } finally { savingRef.current = false; setExitBusy(false); }
  };

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <StatusBar barStyle={palette.tone === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.canvas} />
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable ref={closeButtonRef} accessibilityRole="button" accessibilityLabel="Закрыть форму" onPress={close} style={styles.closeButton}>
          <Text style={[styles.closeGlyph, { color: colors.accentInk }]}>←</Text>
        </Pressable>
        <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>
          {initial === undefined ? "Создать карточку" : "Редактировать карточку"}
        </Text>
      </View>
      <SectionTabs
        tabs={sections.map((section) => ({ id: section.id, label: section.title }))}
        selectedId={activeSection}
        onSelect={scrollToSection}
      />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(event) => syncSectionWithScroll(event.nativeEvent.contentOffset.y)}
        contentContainerStyle={styles.formContent}
      >
        <InlineNotice kind="warning">
          Данные сохраняются в отдельной локальной dev-базе. Бэкап и восстановление пока не готовы; не полагайтесь на эту установку как на единственную копию важных данных.
        </InlineNotice>
        {recoveredDraft ? <InlineNotice kind="info">Несохранённый черновик восстановлен из этого устройства.</InlineNotice> : null}
        <View
          onLayout={(event) => { sectionOffsets.current.basic = event.nativeEvent.layout.y; }}
          style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Основное</Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>Только имя обязательно для сохранения.</Text>
          <TextField
            inputRef={nameRef}
            label="Имя клиента"
            required
            error={nameError ? "Имя клиента обязательно" : undefined}
            placeholder="Как обращаться к клиенту"
            returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()}
            value={displayName}
            onChangeText={(value) => { setDisplayName(value); setNameError(false); setMessage(null); }}
          />
          <TextField
            inputRef={phoneRef}
            label="Телефон · необязательно"
            placeholder="Номер телефона"
            keyboardType="phone-pad"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            value={phone}
            onChangeText={(value) => { setPhone(value); setMessage(null); }}
          />
          <TextField
            inputRef={emailRef}
            label="E-mail · необязательно"
            placeholder="Адрес для связи"
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="done"
            value={email}
            onChangeText={(value) => { setEmail(value); setMessage(null); }}
          />
          <TextField
            inputRef={birthDateRef}
            label="Дата рождения · необязательно"
            placeholder="ГГГГ-ММ-ДД"
            hint="Возраст вычисляется из даты; сегодняшняя и будущая дата не подходят."
            error={birthDateError ? "Проверьте дату рождения" : undefined}
            value={birthDate}
            onChangeText={(value) => { setBirthDate(value); setBirthDateError(false); setMessage(null); }}
          />
          <TextField
            inputRef={heightRef}
            label="Рост, см · необязательно"
            placeholder="Например, 172,5"
            keyboardType="decimal-pad"
            error={heightError ? "Положительное число, не более одного десятичного знака" : undefined}
            value={heightDraft}
            onChangeText={(value) => { setHeightDraft(value); setHeightError(false); setMessage(null); }}
          />
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>Идентификатор карточки</Text>
          <View style={styles.emojiChoices}>
            <SelectionChip group="Идентификатор" label="Инициалы" selected={emoji === null}
              onPress={() => setEmoji(null)} />
            {emojiChoices.map((choice) => (
              <SelectionChip key={choice} group="Идентификатор" label={choice}
                selected={emoji === choice} onPress={() => setEmoji(choice)} />
            ))}
          </View>
          <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>Пол добавится после фиксации набора значений. Вес будет отдельным измерением.</Text>
        </View>
        {sections.slice(1).map((section) => (
          <View
            key={section.id}
            onLayout={(event) => { sectionOffsets.current[section.id] = event.nativeEvent.layout.y; }}
            style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{section.title}</Text>
            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>{section.description}</Text>
          </View>
        ))}
      </ScrollView>
      <StickyEditorFooter
        actionLabel={initial === undefined ? "Создать карточку" : "Сохранить изменения"}
        actionAccessibilityLabel={initial === undefined ? "Сохранить новую карточку клиента" : "Сохранить изменения клиента"}
        onAction={() => { void trySave(); }}
        busy={saving}
        message={message ?? draftError}
        messageKind="error"
        note={draftSaved ? "Черновик сохранён локально · без бэкапа" : "Локальное сохранение · без бэкапа"}
      />
      </KeyboardAvoidingView>
      <ConfirmDialog
        visible={confirmExitVisible}
        returnFocusTo={closeButtonRef}
        title="Незавершённая карточка"
        description="Можно оставить черновик на этом устройстве и продолжить позже либо удалить его вместе с несохранёнными изменениями."
        cancelLabel="Остаться"
        confirmLabel="Выйти с черновиком"
        tertiaryLabel="Удалить черновик и выйти"
        confirmBusy={exitBusy}
        onCancel={() => setConfirmExitVisible(false)}
        onConfirm={() => { void leaveWithDraft(); }}
        onTertiary={() => { void discardAndExit(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1 },
  header: { minHeight: 56, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", paddingRight: 16 },
  closeButton: { width: 56, minHeight: 56, alignItems: "center", justifyContent: "center" },
  closeGlyph: { fontFamily: fonts.regular, fontSize: 28, lineHeight: 32 },
  pageTitle: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold },
  formContent: { padding: 16, paddingBottom: 32, gap: 12 },
  sectionCard: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  sectionDescription: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  emojiChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
