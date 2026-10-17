import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ExerciseCatalogPort } from "../domain/ExerciseCatalogPort.ts";
import { bodyPartLabels, trackingProfileLabels } from "../domain/ExerciseLabels.ts";
import { BODY_PARTS, TRACKING_PROFILE_IDS, type BodyPart, type TrackingProfileId } from "../domain/ExerciseModel.ts";
import { EXERCISE_NAME_MAX } from "../domain/ExerciseRules.ts";
import { COMMON_EQUIPMENT, equipmentFilterLabel } from "./ExerciseLibraryScreen.tsx";

const errors: Readonly<Record<string, string>> = {
  EXERCISE_NAME_INVALID: `Введите название (до ${EXERCISE_NAME_MAX} символов).`,
  EXERCISE_CATEGORY_REQUIRED: "Выберите группу мышц — без неё упражнение не сохраняется.",
  EXERCISE_PROFILE_REQUIRED: "Выберите, как записывается подход.",
  EXERCISE_STALE: "Упражнение изменилось. Откройте его заново и повторите правку.",
};

/** §31.11 Своё упражнение: название, группа мышц (обязательно), оборудование, способ записи подхода. */
export function CustomExerciseEditorScreen({ exerciseId, initialName, repository, onSaved }: Readonly<{
  exerciseId?: string;
  initialName?: string;
  repository: ExerciseCatalogPort;
  onSaved: (exerciseId: string) => void;
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
    });
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

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>
        {exerciseId === undefined ? "Новое упражнение" : "Изменить упражнение"}
      </Text>
      <TextField label="Название" required value={name} onChangeText={setName} />
      <Text style={[styles.group, { color: colors.textPrimary }]}>Группа мышц *</Text>
      <View style={styles.chips}>
        {BODY_PARTS.map((part) => <SelectionChip key={part} group="Группа мышц" label={bodyPartLabels[part]}
          selected={bodyPart === part} onPress={() => setBodyPart(part)} />)}
      </View>
      <Text style={[styles.group, { color: colors.textPrimary }]}>Как записывается подход *</Text>
      <View style={styles.chips}>
        {TRACKING_PROFILE_IDS.map((item) => <SelectionChip key={item} group="Учёт" label={trackingProfileLabels[item]}
          selected={profile === item} onPress={() => setProfile(item)} />)}
      </View>
      <Text style={[styles.group, { color: colors.textPrimary }]}>Оборудование</Text>
      <View style={styles.chips}>
        {COMMON_EQUIPMENT.map((item) => <SelectionChip key={item} group="Оборудование" label={equipmentFilterLabel(item)}
          selected={equipment === item} onPress={() => setEquipment(item)} />)}
      </View>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <AppButton label={exerciseId === undefined ? "Создать упражнение" : "Сохранить"} busy={busy}
        disabled={name.trim().length === 0} onPress={() => { void save(); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  group: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
