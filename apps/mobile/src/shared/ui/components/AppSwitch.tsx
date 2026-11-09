import { Switch, type SwitchProps } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/**
 * Единый переключатель (UIX-01, UI-OWN-082…084): цвета только из темы, прежний родной `Switch`.
 * Принимает все свойства `Switch`, кроме цветов; `accessibilityLabel` обязателен — подписи рядом может не быть.
 */
export function AppSwitch(props: Readonly<Omit<SwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor"> & { accessibilityLabel: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return <Switch {...props} trackColor={{ false: colors.border, true: colors.accentFill }} thumbColor={colors.surface} />;
}
