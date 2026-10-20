import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

/**
 * Анкета внутри карточки клиента (единая форма): разделы для вкладок, содержимое и проверка.
 * Собирается снаружи (композиция владельцев), сама форма клиента анкету не хранит.
 */
export interface ClientEditorAppendix {
  readonly sections: readonly Readonly<{ id: string; title: string }>[];
  /** Содержимое; `onSectionLayout` сообщает положение раздела внутри содержимого для вкладок. */
  readonly render: (onSectionLayout: (sectionId: string, y: number) => void) => ReactNode;
  /** Есть несохранённые ответы — выход спросит подтверждение. */
  readonly dirty: boolean;
  /** Проверить ответы перед сохранением; false — ошибки показаны у самих вопросов. */
  readonly validate: () => boolean;
}

const BASIC = "basic";

export function ClientEditorPreview({ onClose, onSave, onSaveDraft, onDiscardDraft,
  initial, initialWeight, initialDraft, recoveredDraft = false, appendix }: Readonly<{
  onClose: () => void;
  /** `extras.weightText` — вес из карточки (факт Measurements, записывается оболочкой); пустая строка — не вводился. */
  onSave: (input: CreateClientInput, extras: Readonly<{ weightText: string }>) => Promise<void>;
  onSaveDraft: (form: ClientFormDraft) => Promise<void>;
  onDiscardDraft: () => Promise<void>;
  initial?: ClientRecord;
  /** Последний вес клиента из замеров (для показа в карточке); вес — единый факт Measurements, а не поле карточки. */
  initialWeight?: string;
  initialDraft?: ClientFormDraft;
  recoveredDraft?: boolean;
  /** Анкета клиента ниже основного: одна форма и одно сохранение. */
  appendix?: ClientEditorAppendix;
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
  const basicOffset = useRef(0);
  const appendixOffset = useRef(0);
  const appendixSections = useRef<Record<string, number>>({});
  const [displayName, setDisplayName] = useState(initialDraft?.displayName ?? initial?.displayName ?? "");
  const [phone, setPhone] = useState(initialDraft?.contactPhone ?? initial?.contactPhone ?? "");
  const [email, setEmail] = useState(initialDraft?.contactEmail ?? initial?.contactEmail ?? "");
  const [birthDate, setBirthDate] = useState(initialDraft?.birthDate ?? initial?.birthDate ?? "");
  const [heightDraft, setHeightDraft] = useState(initialDraft?.heightDraft
    ?? formatHeightCmX10(initial?.heightCmX10 ?? null));
  const [weightText, setWeightText] = useState(initialWeight ?? "");
  const [sex, setSex] = useState<"MALE" | "FEMALE" | null>(initialDraft?.sex ?? initial?.sex ?? null);
  const [emoji, setEmoji] = useState<string | null>(initialDraft?.emoji ?? initial?.emoji ?? null);
  const [nameError, setNameError] = useState(false);
  const [birthDateError, setBirthDateError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>(BASIC);
  const [confirmExitVisible, setConfirmExitVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const savingRef = useRef(false);
  const pendingDraftWrite = useRef<Promise<void> | null>(null);
  const profileDirty = initial === undefined
    ? Boolean(displayName.trim() || phone.trim() || email.trim()
      || birthDate.trim() || heightDraft.trim() || weightText.trim() || sex !== null || emoji)
    : displayName !== initial.displayName || phone !== (initial.contactPhone ?? "")
      || email !== (initial.contactEmail ?? "") || birthDate !== (initial.birthDate ?? "")
      || heightDraft !== formatHeightCmX10(initial.heightCmX10) || weightText !== (initialWeight ?? "") || (sex ?? null) !== (initial.sex ?? null) || emoji !== initial.emoji;
  const dirty = profileDirty || (appendix?.dirty ?? false);
  const formRef = useRef<ClientFormDraft>({ displayName, contactPhone: phone,
    contactEmail: email, birthDate, heightDraft, sex, emoji });
  formRef.current = { displayName, contactPhone: phone, contactEmail: email,
    birthDate, heightDraft, sex, emoji };

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
    if (!profileDirty || savingRef.current) return;
    setDraftSaved(false);
    const timer = setTimeout(() => {
      if (!savingRef.current) void persistDraft(formRef.current).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [displayName, phone, email, birthDate, heightDraft, sex, emoji, profileDirty, persistDraft]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" && profileDirty && !savingRef.current) {
        void persistDraft(formRef.current).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [profileDirty, persistDraft]);

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

  const tabs = [{ id: BASIC, label: "Основное" }, ...(appendix?.sections ?? []).map((section) => ({ id: section.id, label: section.title }))];
  const offsetOf = (id: string) => id === BASIC ? basicOffset.current
    : appendixOffset.current + (appendixSections.current[id] ?? 0);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    scrollRef.current?.scrollTo({ y: offsetOf(id), animated: true });
  };

  const syncSectionWithScroll = (scrollY: number) => {
    let visibleSection = BASIC;
    for (const tab of tabs) {
      if (tab.id === BASIC || appendixSections.current[tab.id] !== undefined) {
        if (offsetOf(tab.id) <= scrollY + 40) visibleSection = tab.id;
      }
    }
    setActiveSection((current) => current === visibleSection ? current : visibleSection);
  };

  const trySave = async () => {
    if (savingRef.current) return;
    if (!displayName.trim()) {
      setNameError(true);
      setMessage("Имя клиента обязательно.");
      scrollToSection(BASIC);
      nameRef.current?.focus();
      return;
    }
    const normalizedBirthDate = birthDate.trim() || null;
    if (!validPastBirthDate(normalizedBirthDate)) {
      setBirthDateError(true);
      setMessage("Введите действительную дату рождения в прошлом в формате ГГГГ-ММ-ДД.");
      scrollToSection(BASIC);
      birthDateRef.current?.focus();
      return;
    }
    const heightCmX10 = parseHeightCmX10(heightDraft);
    if (heightCmX10 === "invalid") {
      setHeightError(true);
      setMessage("Введите положительный рост в сантиметрах, максимум один знак после запятой.");
      scrollToSection(BASIC);
      heightRef.current?.focus();
      return;
    }
    if (weightText.trim() !== "" && !/^\d{2,3}([.,]\d)?$/u.test(weightText.trim())) {
      setMessage("Вес — число в килограммах, например 85,4.");
      scrollToSection(BASIC);
      return;
    }
    setNameError(false);
    setBirthDateError(false);
    setHeightError(false);
    if (appendix !== undefined && !appendix.validate()) {
      setMessage("Проверьте ответы анкеты: ошибки отмечены у вопросов.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    let created = false;
    try {
      await pendingDraftWrite.current?.catch(() => undefined);
      await persistDraft(formRef.current);
      await onSave({ displayName, contactPhone: phone, contactEmail: email,
        birthDate: normalizedBirthDate, heightCmX10, sex, emoji }, { weightText: weightText.trim() });
      created = true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "WEIGHT_SAVE_FAILED" ? "Карточка сохранена, а вес — нет: он должен быть от 20 до 400 кг, за сегодня не должно быть нескольких записей веса."
        : code === "CLIENT_EMAIL_INVALID" ? "Проверьте адрес электронной почты."
        : code === "CLIENT_FIELD_TOO_LONG" ? "Слишком длинное значение одного из полей."
          : code === "CLIENT_STALE_OR_WRONG_SCOPE" ? "Карточка изменилась. Закройте форму и откройте её снова."
            : code === "CLIENT_DRAFT_SAVE_FAILED" ? "Не удалось защитить ввод черновиком. Повторите сохранение."
              : code === "QUESTIONNAIRE_SAVE_FAILED" ? "Карточка сохранена, а ответы анкеты — нет. Нажмите сохранить ещё раз."
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
        tabs={tabs}
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
          onLayout={(event) => { basicOffset.current = event.nativeEvent.layout.y; }}
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
          <TextField
            label="Вес, кг · необязательно"
            placeholder="Например, 85,4"
            keyboardType="decimal-pad"
            value={weightText}
            onChangeText={(value) => { setWeightText(value); setMessage(null); }}
          />
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>Пол · нужен для расчёта КБЖУ, необязательно</Text>
          <View style={styles.emojiChoices}>
            <SelectionChip group="Пол" label="Не указан" selected={sex === null} onPress={() => setSex(null)} />
            <SelectionChip group="Пол" label="Мужской" selected={sex === "MALE"} onPress={() => setSex("MALE")} />
            <SelectionChip group="Пол" label="Женский" selected={sex === "FEMALE"} onPress={() => setSex("FEMALE")} />
          </View>
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
        {appendix !== undefined ? (
          <View onLayout={(event) => { appendixOffset.current = event.nativeEvent.layout.y; }}>
            {appendix.render((sectionId, y) => { appendixSections.current[sectionId] = y; })}
          </View>
        ) : null}
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
  closeGlyph: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26 },
  pageTitle: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  formContent: { padding: 16, paddingBottom: 32, gap: 12 },
  sectionCard: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold },
  sectionDescription: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  emojiChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
