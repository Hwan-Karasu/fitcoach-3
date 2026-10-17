import { StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { fonts } from "../../shared/ui/theme/typography.ts";

// F01 diagnostic surface only. Product screens are gated separately by F09/UI.
export default function FoundationScreen() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.content}>
          <Text style={styles.label}>FITCOACH 3.0 · DEVELOPMENT</Text>
          <Text style={styles.title}>Основной проект запущен</Text>
          <Text style={styles.body}>
            Это TypeScript-каркас нового offline-приложения. Здесь пока нет
            рабочих данных и экранов тренера: они добавляются по задачам и
            отдельным UI-gates.
          </Text>
          <Text style={styles.note}>F01 · candidate stack · dev package</Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f7fa" },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 18 },
  label: { color: "#40688b", fontSize: 12, fontFamily: fonts.bold, letterSpacing: 1.4 },
  title: { color: "#162b3c", fontSize: 29, fontFamily: fonts.bold },
  body: { color: "#345067", fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  note: { color: "#718397", fontFamily: fonts.regular, fontSize: 13 },
});
