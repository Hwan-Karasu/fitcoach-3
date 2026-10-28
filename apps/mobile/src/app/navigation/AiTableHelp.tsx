import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { AppButton } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { AI_WORKBOOK_PROMPT } from "../../features/import/public.ts";

/** EXCEL-AI: чужая таблица переделывается внешним ИИ по образцу и промпту; приложение остаётся офлайн. */
export function AiTableHelp({ busy, onTemplate, onCopy }: Readonly<{ busy: boolean; onTemplate: () => void; onCopy: (text: string) => Promise<void> }>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  const copy = () => { onCopy(AI_WORKBOOK_PROMPT).then(() => setCopied("done"), () => setCopied("failed")); };
  const Chevron = open ? ChevronUp : ChevronDown;
  return <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.head}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Таблица другого формата? Переделайте её через ИИ</Text>
      <Chevron size={18} color={colors.textSecondary} />
    </Pressable>
    {open && <View style={styles.body}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        1. Скачайте образец.{"\n"}2. Отправьте ИИ (ChatGPT, Claude и другим) свою таблицу, образец и текст ниже.{"\n"}3. Выберите здесь файл, который вернёт ИИ.
      </Text>
      <AppButton compact variant="secondary" label="Скачать образец для ИИ" disabled={busy} onPress={onTemplate} />
      <View style={[styles.prompt, { borderColor: colors.border, backgroundColor: colors.input }]}>
        <Text selectable style={[styles.text, { color: colors.textPrimary }]}>{AI_WORKBOOK_PROMPT}</Text>
      </View>
      <AppButton compact variant="secondary" label={copied === "done" ? "Скопировано" : "Скопировать промпт"} onPress={copy} />
      {copied === "failed" && <Text style={[styles.hint, { color: colors.danger }]}>Не удалось скопировать — удерживайте текст, чтобы выделить его.</Text>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12 },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  title: { flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  body: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  prompt: { borderWidth: 1, borderRadius: 8, padding: 10 },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 }, hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
