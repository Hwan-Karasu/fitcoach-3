import type { RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fonts } from "../../../../shared/ui/theme/typography.ts";

const WIDTH = 380;
/** Постоянно светлая картинка: её смотрят в других приложениях, тема тренера на неё не влияет (как в календаре). */
const ink = { paper: "#FFFFFF", text: "#13262B", muted: "#5B6B70", line: "#D5DEE0", accent: "#0E6E73" };

export interface SharePosterExercise {
  readonly name: string;
  /** Строки подходов: факт, если введён, иначе план. */
  readonly sets: readonly string[];
}

/**
 * «Поделиться тренировкой» (UI-OWN-037, как «Поделиться расписанием» календаря, §13.18): картинка рисуется вне
 * экрана, снимается и уходит в системное окно «Поделиться». Только план и результаты — без заметок и служебного.
 */
export function WorkoutSharePoster({ posterRef, title, subtitle, exercises }: Readonly<{
  posterRef: RefObject<View | null>;
  title: string;
  subtitle: string;
  exercises: readonly SharePosterExercise[];
}>) {
  return (
    <View ref={posterRef} collapsable={false} style={styles.poster}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {exercises.map((exercise, index) => (
        <View key={`${index}:${exercise.name}`} style={styles.exercise}>
          <Text style={styles.name}>{`${index + 1}. ${exercise.name}`}</Text>
          {exercise.sets.map((line, setIndex) => (
            <Text key={setIndex} style={styles.set}>{`${setIndex + 1})  ${line}`}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { width: WIDTH, padding: 16, backgroundColor: ink.paper, gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23, color: ink.text },
  subtitle: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: ink.accent },
  exercise: { borderTopWidth: 1, borderTopColor: ink.line, paddingTop: 8, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: ink.text },
  set: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: ink.muted },
});
