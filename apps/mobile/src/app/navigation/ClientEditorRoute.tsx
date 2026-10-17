import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ClientEditorPreview, type ClientRecord, type ClientRecoveryDraft,
  type ClientRecoveryDraftPort, type ClientRepositoryPort } from
  "../../features/clients/public.ts";
import { AppButton, ConfirmDialog, LoadingState } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

type Loaded = Readonly<{ client: ClientRecord | null; draft: ClientRecoveryDraft | null }>;

export function ClientEditorRoute({ clientId, repository, onClose, prefillName, onCreated }: Readonly<{
  clientId?: string;
  /** A guest name from Calendar; an existing recovery draft still asks first. */
  prefillName?: string;
  /** Runs after a new card is saved; must not throw, the card already exists. */
  onCreated?: (client: ClientRecord) => Promise<void>;
  repository: ClientRepositoryPort & ClientRecoveryDraftPort;
  onClose: () => void;
}>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState<"ask" | "use" | "fresh">("ask");
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setLoadFailed(false);
    setChoice("ask");
    void Promise.all([clientId === undefined ? Promise.resolve(null) : repository.get(clientId),
      repository.loadDraft(clientId ?? null)])
      .then(([client, draft]) => { if (active) setLoaded({ client, draft }); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [clientId, repository]);

  if (loaded === null && !loadFailed) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <LoadingState label="Открываем карточку…" />
    </View>;
  }
  if (loadFailed || (clientId !== undefined && loaded?.client === null)) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <Text style={{ color: colors.textPrimary }}>Карточка или её черновик недоступны. Данные не изменены.</Text>
      <AppButton label="Назад" onPress={onClose} />
    </View>;
  }
  if (loaded === null) return null;
  const client = loaded.client;
  const draft = loaded.draft;
  const editConflict = clientId !== undefined && draft !== null
    && draft.baseClientRevision !== client?.revision;

  if (editConflict) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Черновик другой версии</Text>
      <Text style={{ color: colors.textSecondary }}>
        Карточка изменилась после сохранения черновика. Автоматически наложить старые значения небезопасно.
      </Text>
      <AppButton variant="secondary" label="Вернуться" onPress={onClose} />
      <AppButton variant="destructive" label="Удалить старый черновик и открыть"
        onPress={() => setDiscardConfirm(true)} />
      <ConfirmDialog visible={discardConfirm} confirmBusy={discardBusy}
        title="Удалить старый черновик?"
        description="Несохранённые значения черновика будут удалены. Сохранённая карточка останется без изменений."
        confirmLabel="Удалить черновик" destructive
        onCancel={() => setDiscardConfirm(false)}
        onConfirm={() => {
          setDiscardBusy(true);
          void repository.discardDraft(clientId ?? null)
            .then(() => { setLoaded({ client, draft: null }); setDiscardConfirm(false); })
            .catch(() => setDiscardConfirm(false))
            .finally(() => setDiscardBusy(false));
        }} />
    </View>;
  }

  if (clientId === undefined && draft !== null && choice === "ask") {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <ConfirmDialog visible title="Продолжить черновик клиента?"
        description="Незавершённая форма сохранена на этом устройстве. Можно продолжить её или начать новую карточку."
        cancelLabel="Продолжить" confirmLabel="Начать заново" confirmBusy={discardBusy}
        onCancel={() => setChoice("use")}
        onConfirm={() => {
          setDiscardBusy(true);
          void repository.discardDraft(null)
            .then(() => { setLoaded({ client: null, draft: null }); setChoice("fresh"); })
            .catch(() => setLoadFailed(true))
            .finally(() => setDiscardBusy(false));
        }} />
    </View>;
  }

  const recovered = draft !== null && (clientId !== undefined || choice === "use");
  return <ClientEditorPreview key={`${clientId ?? "new"}:${recovered ? draft?.id : "fresh"}`}
    initial={client ?? undefined}
    initialDraft={recovered ? draft?.formData : prefillName === undefined ? undefined
      : { displayName: prefillName, contactPhone: "", contactEmail: "", birthDate: "", heightDraft: "", emoji: null }}
    recoveredDraft={recovered}
    onClose={onClose}
    onSaveDraft={async (formData) => {
      await repository.saveDraft({ clientId: clientId ?? null,
        baseClientRevision: client?.revision ?? null, formData });
    }}
    onDiscardDraft={() => repository.discardDraft(clientId ?? null)}
    onSave={async (input) => {
      if (clientId === undefined) await onCreated?.(await repository.create(input));
      else if (client !== null) await repository.update(clientId, client.revision, input);
      else throw new Error("CLIENT_NOT_FOUND");
    }} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold },
});
