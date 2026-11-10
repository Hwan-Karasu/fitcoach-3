import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton, BottomSheet } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { BODY_FAT_PICTURES, type BodyFatPicture, type BodyFatPictureSet } from "../domain/BodyFatPictures.ts";
import { bodyFatImages } from "./bodyFatImages.ts";

/**
 * Лист «Процент жира по рисунку» (UIX-06, UI-OWN-074): девять рисунков по полу клиента с диапазонами; выбранный подсвечен рамкой,
 * «Выбрать» отдаёт рисунок наверх (середина диапазона подставляется в «Жир, %»). Оценка ориентировочная.
 */
export function BodyFatPictureSheet({ visible, set, selected, onSelect, onClose }: Readonly<{
  visible: boolean;
  set: BodyFatPictureSet;
  /** Номер ранее выбранного рисунка (1…9) или `null`. */
  selected: number | null;
  onSelect: (picture: BodyFatPicture) => void;
  onClose: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const [current, setCurrent] = useState<number | null>(selected);
  // Выбор сбрасывается только при открытии: смена данных снаружи не затирает нажатое.
  useEffect(() => { if (visible) setCurrent(selected); }, [visible]);
  const pictures = BODY_FAT_PICTURES[set];
  const chosen = pictures.find((picture) => picture.index === current) ?? null;
  return (
    <BottomSheet visible={visible} title="Процент жира по рисунку" onClose={onClose}
      footer={<AppButton label="Выбрать" disabled={chosen === null} disabledReason="Нажмите на рисунок, похожий на клиента."
        onPress={() => { if (chosen !== null) onSelect(chosen); }} />}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Рисунки для оценки процента жира" style={styles.grid}>
        {pictures.map((picture) => {
          const active = picture.index === current;
          return (
            <Pressable key={picture.index} accessibilityRole="radio" accessibilityState={{ checked: active }}
              accessibilityLabel={`Рисунок ${picture.index}: жир ${picture.label} процентов`} onPress={() => setCurrent(picture.index)}
              style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.8 : 1 }]}>
              <View style={[styles.frame, { borderColor: active ? colors.accentFill : "transparent" }]}>
                <Image source={bodyFatImages[set][picture.index - 1]} accessibilityIgnoresInvertColors style={styles.image} resizeMode="cover" />
              </View>
              <Text style={[styles.label, { color: active ? colors.accentInk : colors.textSecondary }]}>{picture.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.textMuted }]}>Ориентировочно, не заменяет замеры. «Выбрать» подставит середину диапазона.</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "31.5%", gap: 4, alignItems: "center" },
  frame: { width: "100%", aspectRatio: 360 / 540, borderRadius: 18, borderWidth: 3, overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: "center" },
});
