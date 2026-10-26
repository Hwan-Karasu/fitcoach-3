import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, SearchField, StickyEditorFooter, TrainingEditorLayout, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { bodyPartLabels, equipmentLabel, trackingProfileLabels } from "../domain/ExerciseLabels.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS, type BodyPart, type TrackingProfileId } from "../domain/ExerciseModel.ts";
import { EXERCISE_NAME_MAX } from "../domain/ExerciseRules.ts";
import { OptionTile, profileExamples, ProfileTile, TileGrid } from "./choiceTiles.tsx";
import { EquipmentGlyph } from "./equipmentGlyphs.tsx";
import { BodyPartIcon } from "./exerciseIcons.tsx";
import { equipmentFilterLabel } from "./ExerciseLibraryScreen.tsx";
import { equipmentChoices } from "../domain/EquipmentSearch.ts";
import { useExerciseCatalog } from "./useExerciseCatalog.ts";

const errors: Readonly<Record<string, string>> = {
  EXERCISE_NAME_INVALID: `Введите название (до ${EXERCISE_NAME_MAX} символов).`,
  EXERCISE_CATEGORY_REQUIRED: "Выберите группу мышц — без неё упражнение не сохраняется.",
  EXERCISE_PROFILE_REQUIRED: "Выберите, как записывается подход.",
  EXERCISE_STALE: "Упражнение изменилось. Откройте его заново и повторите правку.",
};

/**
 * §31.11 Своё упражнение: название, группа мышц (обязательно), способ записи подхода (обязательно), оборудование.
 * Выбор — теми же плитками, что и фильтры каталога (UI-OWN-033): силуэт тела, пример записи, значок оборудования.
 */
export function CustomExerciseEditorScreen({ exerciseId, initialName, repository, onSaved, onCancel }: Readonly<{
  exerciseId?: string;
  initialName?: string;
  repository: ExerciseCatalogPort;
  onSaved: (exerciseId: string) => void;
  onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [name, setName] = useState(initialName ?? "");
  const [bodyPart, setBodyPart] = useState<BodyPart | null>(null);
  const [equipment, setEquipment] = useState<string>("none");
  const [profile, setProfile] = useState<TrackingProfileId | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  // В редакторе сначала 12 вариантов и выбранное; поиск сразу охватывает весь список.
  const [allEquipment, setAllEquipment] = useState(false);
  const [equipmentQuery, setEquipmentQuery] = useState("");
  // Весь справочник и оборудование каталога, независимо от выбранной группы мышц.
  const { entries } = useExerciseCatalog(repository);
  const equipmentOptions = useMemo(() => equipmentChoices(entries ?? [], [equipment], equipmentQuery).filter((id) => id !== ""), [entries, equipment, equipmentQuery]);

  useEffect(() => {
    if (exerciseId === undefined) return undefined;
    let active = true;
    void Promise.all([repository.get(exerciseId), repository.revisionOf(exerciseId)]).then(([entry, current]) => {
      if (!active || entry === null) return;
      setName(entry.definition.name);
      setBodyPart(entry.definition.bodyPart);
      setEquipment(entry.definition.equipment ?? "none");
      setProfile(entry.definition.trackingProfile);
      setRevision(current);
    }).catch(() => { if (active) setError("Не удалось загрузить упражнение."); });
    return () => { active = false; };
  }, [exerciseId, repository]);

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const input = { name, bodyPart, equipment: equipment === "none" ? null : equipment, trackingProfile: profile };
    try {
      const saved = exerciseId === undefined || revision === null
        ? await repository.createCustom(input) : await repository.updateCustom(exerciseId, revision, input);
      onSaved(saved.id);
    } catch (failure) {
      setError(errors[failure instanceof Error ? failure.message : ""] ?? "Не удалось сохранить упражнение.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const section = (title: string, hint: string | null) => (
    <View style={styles.sectionHead}>
      <Text accessibilityRole="header" style={[styles.group, { color: colors.textSecondary }]}>{title}</Text>
      {hint !== null ? <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );

  return (
    <TrainingEditorLayout>
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField label="Название" hideLabel required placeholder="Название упражнения" value={name} onChangeText={setName} />
      {section("Группа мышц", bodyPart === null ? "обязательно" : bodyPartLabels[bodyPart])}
      <TileGrid>
        {BODY_PARTS.map((part) => <OptionTile key={part} radio icon={() => <BodyPartIcon part={part} />} label={bodyPartLabels[part]}
          selected={bodyPart === part} onPress={() => setBodyPart(part)} />)}
      </TileGrid>
      {section("Как записывается подход", profile === null ? "обязательно" : null)}
      <TileGrid>
        {TRACKING_PROFILE_IDS.map((item) => <ProfileTile key={item} radio label={trackingProfileLabels[item]}
          example={profileExamples[item]} selected={profile === item} onPress={() => setProfile(item)} />)}
      </TileGrid>
      {section("Оборудование", equipment === "none" ? null : equipmentLabel(equipment))}
      <SearchField query={equipmentQuery} onChangeQuery={setEquipmentQuery} placeholder="Поиск оборудования" accessibilityLabel="Поиск оборудования" />
      {equipmentOptions.length === 0 ? <Text style={{ color: colors.textSecondary }}>Оборудование не найдено. Измените запрос.</Text> : null}
      <TileGrid>
        {(allEquipment || equipmentQuery.trim() ? equipmentOptions : equipmentOptions.filter((item, index) => index < 12 || item === equipment)).map((item) => <OptionTile key={item} radio compact label={equipmentFilterLabel(item)}
          icon={(color) => <EquipmentGlyph id={item} color={color} size={36} />}
          selected={equipment === item} onPress={() => setEquipment(item)} />)}
      </TileGrid>
      {equipmentOptions.length > 12 && !equipmentQuery.trim() ? <AppButton compact variant="ghost"
        label={allEquipment ? "Свернуть" : `Всё оборудование (${equipmentOptions.length})`}
        onPress={() => setAllEquipment((value) => !value)} /> : null}
    </ScrollView>
    <StickyEditorFooter actionLabel={exerciseId === undefined ? "Создать упражнение" : "Сохранить"} busy={busy}
      disabled={name.trim().length === 0 || (exerciseId !== undefined && revision === null)}
      onAction={() => { void save(); }} onCancel={onCancel} message={error} messageKind="error" />
    </TrainingEditorLayout>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 24 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 10 },
  group: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
});
