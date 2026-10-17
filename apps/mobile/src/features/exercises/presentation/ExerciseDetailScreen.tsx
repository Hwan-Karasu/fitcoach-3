import { useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, LoadingState, StatusTag, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { bodyPartLabels, equipmentLabel, muscleLabel, trackingProfileLabels } from "../domain/ExerciseLabels.ts";
import { displayNameOf, type CatalogEntry } from "../domain/ExerciseRules.ts";
import { posesOf } from "./exerciseImage.ts";

const difficultyLabels = { beginner: "Начальный", intermediate: "Средний", advanced: "Продвинутый" } as const;
const mechanicLabels = { compound: "Многосуставное", isolation: "Изолирующее" } as const;

/**
 * §31.10 Карточка упражнения: название, мышцы, оборудование, учёт, техника; личное название, синонимы,
 * избранное и скрытие. Канонические данные системного упражнения только для чтения.
 */
export function ExerciseDetailScreen({ exerciseId, repository, onEdit, onArchived }: Readonly<{
  exerciseId: string;
  repository: ExerciseCatalogPort;
  onEdit: (exerciseId: string) => void;
  onArchived: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [entry, setEntry] = useState<CatalogEntry | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [personal, setPersonal] = useState<Readonly<{ displayName: string; aliases: string }> | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    repository.get(exerciseId).then((next) => { if (active) setEntry(next); }).catch(() => { if (active) setEntry(null); });
    return () => { active = false; };
  }, [exerciseId, repository, version]);

  useEffect(() => repository.subscribeCommittedChanges(() => setVersion((value) => value + 1)), [repository]);

  if (entry === undefined) return <View style={[styles.center, { backgroundColor: colors.canvas }]}><LoadingState label="Открываем упражнение…" /></View>;
  if (entry === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <InlineNotice kind="error">Упражнение не найдено в каталоге.</InlineNotice>
    </View>;
  }

  const { definition, overlay } = entry;
  const run = (action: Promise<unknown>) => { setError(null); void action.catch(() => setError("Не удалось сохранить. Каталог не изменён.")); };
  const facts: readonly (readonly [string, string])[] = [
    ["Группа мышц", bodyPartLabels[definition.bodyPart]],
    ["Оборудование", equipmentLabel(definition.equipment)],
    ["Как записывается подход", trackingProfileLabels[definition.trackingProfile]],
    ...(definition.primaryMuscles.length > 0 ? [["Основные мышцы", definition.primaryMuscles.map(muscleLabel).join(", ")] as const] : []),
    ...(definition.secondaryMuscles.length > 0 ? [["Вспомогательные", definition.secondaryMuscles.map(muscleLabel).join(", ")] as const] : []),
    ...(definition.mechanic !== null ? [["Тип", mechanicLabels[definition.mechanic]] as const] : []),
    ...(definition.difficulty !== null ? [["Уровень", difficultyLabels[definition.difficulty]] as const] : []),
  ];
  const savePersonal = () => {
    if (personal === null) return;
    run(repository.setPersonal(definition.id, { displayName: personal.displayName,
      aliases: personal.aliases.split(",") }).then(() => setPersonal(null)));
  };

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{displayNameOf(entry)}</Text>
      {overlay.displayName !== null ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{`В каталоге: ${definition.name}`}</Text> : null}
      {definition.nameEn !== null ? <Text style={[styles.meta, { color: colors.textMuted }]}>{definition.nameEn}</Text> : null}
      <View style={styles.tags}>
        <StatusTag kind={definition.origin === "CUSTOM" ? "info" : "neutral"} label={definition.origin === "CUSTOM" ? "Моё упражнение" : "Системное"} />
        {overlay.favorite ? <StatusTag kind="success" label="В избранном" /> : null}
        {overlay.hidden ? <StatusTag kind="warning" label="Скрыто" /> : null}
      </View>
      {posesOf(definition.media).length > 0 ? (
        <View style={styles.poses}>
          {posesOf(definition.media).map((pose) => (
            <View key={pose.label} style={[styles.pose, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {/* Квадрат задаёт контейнер: у Image из ассета высота иначе берётся из размеров файла. */}
              <View style={styles.poseFrame}>
                <Image source={pose.source} style={styles.poseImage} resizeMode="contain"
                  accessibilityLabel={`${pose.label}: ${displayNameOf(entry)}`} />
              </View>
              <Text style={[styles.poseLabel, { color: colors.textSecondary }]}>{pose.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <View style={styles.row}>
        <View style={styles.grow}><AppButton variant="secondary" label={overlay.favorite ? "Убрать из избранного" : "В избранное"}
          onPress={() => run(repository.setFavorite(definition.id, !overlay.favorite))} /></View>
        <View style={styles.grow}><AppButton variant="secondary" label={overlay.hidden ? "Показывать" : "Скрыть"}
          onPress={() => run(repository.setHidden(definition.id, !overlay.hidden))} /></View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {facts.map(([label, value]) => (
          <View key={label} style={styles.fact}>
            <Text style={[styles.factLabel, { color: colors.textSecondary }]}>{label}</Text>
            <Text style={[styles.factValue, { color: colors.textPrimary }]}>{value}</Text>
          </View>
        ))}
      </View>

      {definition.instructions.length > 0 ? <>
        <Text style={[styles.group, { color: colors.textPrimary }]}>Техника</Text>
        {definition.textLanguage === "en" ? (
          <Text style={[styles.note, { color: colors.textMuted }]}>Пока на английском — перевод этого упражнения ещё в работе.</Text>
        ) : null}
        {definition.instructions.map((step, index) => (
          <Text key={step} style={[styles.body, { color: colors.textPrimary }]}>{`${index + 1}. ${step}`}</Text>
        ))}
      </> : null}
      {definition.tips.length > 0 ? <>
        <Text style={[styles.group, { color: colors.textPrimary }]}>Советы</Text>
        {definition.tips.map((tip) => <Text key={tip} style={[styles.body, { color: colors.textPrimary }]}>{`• ${tip}`}</Text>)}
      </> : null}

      <Text style={[styles.group, { color: colors.textPrimary }]}>Моё название и синонимы</Text>
      {personal === null ? <>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {overlay.aliases.length > 0 ? `Синонимы: ${overlay.aliases.join(", ")}` : "Синонимов нет. Они помогают найти упражнение поиском."}
        </Text>
        <AppButton variant="secondary" label="Изменить моё название и синонимы"
          onPress={() => setPersonal({ displayName: overlay.displayName ?? "", aliases: overlay.aliases.join(", ") })} />
      </> : <>
        <TextField label="Моё название · необязательно" value={personal.displayName}
          onChangeText={(displayName) => setPersonal({ ...personal, displayName })} />
        <TextField label="Синонимы через запятую" value={personal.aliases} onChangeText={(aliases) => setPersonal({ ...personal, aliases })} />
        <View style={styles.row}>
          <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => setPersonal(null)} /></View>
          <View style={styles.grow}><AppButton label="Сохранить" onPress={savePersonal} /></View>
        </View>
      </>}

      {definition.origin === "CUSTOM" ? (
        <View style={styles.row}>
          <View style={styles.grow}><AppButton variant="secondary" label="Изменить" onPress={() => onEdit(definition.id)} /></View>
          <View style={styles.grow}><AppButton variant="secondary" label="В архив" onPress={() => setConfirmArchive(true)} /></View>
        </View>
      ) : (
        <Pressable accessibilityRole="link" accessibilityLabel={repository.meta().attribution}
          onPress={() => { void Linking.openURL("https://repdb.co"); }}>
          <Text style={[styles.attribution, { color: colors.textMuted }]}>{repository.meta().attribution}</Text>
        </Pressable>
      )}
      <ConfirmDialog visible={confirmArchive} title="Убрать упражнение в архив?"
        description="Упражнение пропадёт из каталога и выбора. Записанные раньше тренировки его сохранят."
        confirmLabel="В архив" onCancel={() => setConfirmArchive(false)}
        onConfirm={() => { setConfirmArchive(false); void repository.archiveCustom(definition.id).then(onArchived)
          .catch(() => setError("Не удалось убрать в архив.")); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  row: { flexDirection: "row", gap: 10 },
  grow: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  poses: { flexDirection: "row", gap: 10 },
  pose: { flex: 1, borderWidth: 1, borderRadius: 12, overflow: "hidden", alignItems: "center", paddingBottom: 6 },
  poseFrame: { width: "100%", aspectRatio: 1 },
  poseImage: { width: "100%", height: "100%" },
  poseLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  fact: { paddingVertical: 8, gap: 2 },
  factLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  factValue: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  group: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, marginTop: 8 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  attribution: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center", padding: 12 },
});
