import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { ArchiveRestore, Trash2 } from "lucide-react-native";
import { AppButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ProgramCard } from "../domain/ProgramModel.ts";
import { programKindLabels } from "../domain/ProgramRules.ts";
import type { ProgramDeletePort } from "../domain/PlanDeletion.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dateOf = (iso: string) => { const date = new Date(iso); return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`; };

/**
 * «Архив программ» клиента (§50.1–50.3): архивированные программы, новые сверху. «Восстановить» возвращает программу в
 * библиотеку, не делая её текущей (§50.2); «Удалить полностью» — план и результаты этого клиента (§50.3, действие 2).
 */
export function ArchivedProgramsPanel({ clientId, repository, planDelete }: Readonly<{
  clientId: string;
  repository: TrainingPlansRepositoryPort;
  planDelete: ProgramDeletePort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [cards, setCards] = useState<readonly ProgramCard[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProgramCard | null>(null);
  const [message, setMessage] = useState<Readonly<{ kind: "error" | "success"; text: string }> | null>(null);

  useEffect(() => {
    let active = true;
    repository.getLibrary(clientId).then((library) => {
      if (active) setCards([...library.archived].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")));
    }).catch(() => { if (active) setMessage({ kind: "error", text: "Не удалось загрузить архив программ." }); });
    return () => { active = false; };
  }, [clientId, repository, version]);
  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.clientIds.includes(clientId)) setVersion((value) => value + 1);
  }), [clientId, repository]);

  const restore = async (card: ProgramCard) => {
    setBusy(card.id); setMessage(null);
    try {
      await repository.restoreForClient(clientId, card.id);
      setMessage({ kind: "success", text: `«${card.title}» снова в списке программ. Текущая программа не изменилась.` });
    } catch { setMessage({ kind: "error", text: "Не удалось восстановить программу. Архив не изменён." }); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    const card = deleting;
    if (card === null) return;
    setBusy(card.id); setMessage(null);
    try {
      await planDelete.deleteProgram({ clientId, programId: card.id, expectedRevision: card.revision });
      setMessage({ kind: "success", text: `«${card.title}» удалена вместе с результатами.` });
    } catch { setMessage({ kind: "error", text: "Не удалось удалить программу. Ничего не изменено." }); }
    finally { setBusy(null); setDeleting(null); }
  };

  if (cards === null) return message !== null ? <View style={styles.pad}><InlineNotice kind="error">{message.text}</InlineNotice></View>
    : <LoadingState label="Открываем архив программ…" />;
  return (
    <>
      <FlatList data={cards as ProgramCard[]} keyExtractor={(card) => card.id} contentContainerStyle={styles.list}
        ListHeaderComponent={message !== null ? <InlineNotice kind={message.kind}>{message.text}</InlineNotice> : null}
        ListEmptyComponent={<EmptyState reason="no-data" title="Архив пуст" body="Сюда попадают программы, отправленные в архив из меню программы." />}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {`${programKindLabels[item.kind]} · в архиве с ${item.archivedAt === null ? "—" : dateOf(item.archivedAt)}`}</Text>
            <View style={styles.actions}>
              <View style={styles.grow}><AppButton compact variant="secondary" label="Восстановить" busy={busy === item.id}
                icon={(color) => <ArchiveRestore size={16} color={color} strokeWidth={2} />} onPress={() => { void restore(item); }} /></View>
              <View style={styles.grow}><AppButton compact variant="secondary" label="Удалить…" disabled={busy !== null}
                icon={(color) => <Trash2 size={16} color={color} strokeWidth={2} />} onPress={() => setDeleting(item)} /></View>
            </View>
          </View>
        )} />
      <ConfirmDialog visible={deleting !== null} destructive confirmBusy={busy !== null} title={`Удалить «${deleting?.title ?? ""}» полностью?`}
        description="Удалятся план и все результаты этого клиента: занятия исчезнут из истории и статистики. У других участников программа останется. Это нельзя отменить."
        confirmLabel="Удалить с результатами" onCancel={() => setDeleting(null)} onConfirm={() => { void remove(); }} />
    </>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  grow: { flex: 1 },
});
