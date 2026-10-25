import { memo, useCallback, useMemo, useRef } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { Pencil, Users } from "lucide-react-native";
import { View } from "react-native";
import { AppIconButton, ScreenHeader, SearchField } from "../../shared/ui/components/public.ts";
import { RetainedScreenTheme, usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { navigationPerformance } from "../../shared/diagnostics/NavigationPerformance.ts";

/** Эмодзи клиента или инициалы — как в списке клиентов. */
export function clientMark(client: Readonly<{ displayName: string; emoji: string | null }>): string {
  return client.emoji ?? (client.displayName.trim().split(/\s+/u).slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru") ?? "").join("") || "?");
}

/**
 * Шапка экранов клиента (UI-OWN-035, макет владельца): карточка с аватаром, имя клиента, подзаголовок — экран;
 * справа — к списку клиентов. Android Back и стрелка вызывают один маршрут.
 */
type ClientHeaderProps = Readonly<{
  client: Readonly<{ displayName: string; emoji: string | null }>; subtitle: string; onBack: () => void; onClients: () => void;
  /** Заголовок вместо имени клиента (без аватара) — например, название программы в матрице. */
  title?: string;
  /** Карандаш рядом со списком клиентов — редактор карточки с анкетой (только на «Главной»). */
  onEdit?: () => void;
  /** Карандаш вместо значка «К списку клиентов» — действие самого экрана (например, карточка продукта). */
  trailingAction?: Readonly<{ label: string; onPress: () => void }>;
  /** Поле поиска вместо имени клиента (выбор упражнения). */
  search?: Readonly<{ query: string; onChangeQuery: (query: string) => void; placeholder: string; accessibilityLabel: string }>;
}>;

export function ClientHeader(props: ClientHeaderProps) {
  const focused = useIsFocused();
  const live = useRef(props); live.current = props;
  const actions = useMemo(() => ({ back: () => live.current.onBack(), clients: () => live.current.onClients(),
    edit: () => live.current.onEdit?.(), trailing: () => live.current.trailingAction?.onPress(),
    query: (query: string) => live.current.search?.onChangeQuery(query) }), []);
  const client = useMemo(() => ({ displayName: props.client.displayName, emoji: props.client.emoji }), [props.client.displayName, props.client.emoji]);
  const label = props.trailingAction?.label;
  const trailing = useMemo(() => label === undefined ? undefined : { label, onPress: actions.trailing }, [label, actions]);
  const query = props.search?.query; const placeholder = props.search?.placeholder; const accessibilityLabel = props.search?.accessibilityLabel;
  const search = useMemo(() => query === undefined ? undefined : { query, placeholder: placeholder!, accessibilityLabel: accessibilityLabel!, onChangeQuery: actions.query },
    [query, placeholder, accessibilityLabel, actions]);
  return <RetainedScreenTheme active={focused}><ClientHeaderBody client={client} subtitle={props.subtitle} title={props.title} onBack={actions.back} onClients={actions.clients}
    onEdit={props.onEdit === undefined ? undefined : actions.edit} trailingAction={trailing} search={search} /></RetainedScreenTheme>;
}

const ClientHeaderBody = memo(function ClientHeaderBody({ client, subtitle, title, onBack, onClients, onEdit, trailingAction, search }: ClientHeaderProps) {
  const { palette } = usePrototypeTheme();
  navigationPerformance.render("ClientHeader");
  const colors = palette.tokens;
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => listener.remove();
  }, [onBack]));
  const rightControls = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {onEdit === undefined ? null : <AppIconButton compact label="Редактировать карточку и анкету клиента" icon={<Pencil size={20} color={colors.textPrimary} />} onPress={onEdit} />}
      {trailingAction === undefined
        ? <AppIconButton compact label="К списку клиентов" icon={<Users size={20} color={colors.textPrimary} />} onPress={onClients} />
        : <AppIconButton compact label={trailingAction.label} icon={<Pencil size={20} color={colors.textPrimary} />} onPress={trailingAction.onPress} />}
    </View>
  );
  if (search !== undefined) {
    return <ScreenHeader onBack={onBack} right={rightControls}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <SearchField query={search.query} onChangeQuery={search.onChangeQuery} accessibilityLabel={search.accessibilityLabel} placeholder={search.placeholder} />
      </View>
    </ScreenHeader>;
  }
  return <ScreenHeader title={title ?? client.displayName} subtitle={subtitle} {...(title === undefined ? { mark: clientMark(client) } : {})} onBack={onBack}
    right={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {onEdit === undefined ? null : <AppIconButton compact label="Редактировать карточку и анкету клиента" icon={<Pencil size={20} color={colors.textPrimary} />} onPress={onEdit} />}
      {trailingAction === undefined
        ? <AppIconButton compact label="К списку клиентов" icon={<Users size={20} color={colors.textPrimary} />} onPress={onClients} />
        : <AppIconButton compact label={trailingAction.label} icon={<Pencil size={20} color={colors.textPrimary} />} onPress={trailingAction.onPress} />}
    </View>} />;
});
