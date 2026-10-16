export type RootTab = "Clients" | "Calendar" | "Archive";
export type ClientSection =
  | "Home"
  | "Nutrition"
  | "Training"
  | "Questionnaire"
  | "TrainingArchive"
  | "Statistics";

export type SafeRoute =
  | { kind: "root"; tab: RootTab }
  | { kind: "client"; clientId: string; section: ClientSection }
  | { kind: "settings" }
  | { kind: "notifications" };

export const DEFAULT_ROUTE: SafeRoute = { kind: "root", tab: "Clients" };

const rootTabs = new Set<RootTab>(["Clients", "Calendar", "Archive"]);
const clientSections = new Set<ClientSection>([
  "Home", "Nutrition", "Training", "Questionnaire", "TrainingArchive", "Statistics",
]);

export function sanitizeSafeRoute(value: unknown, validClientIds: ReadonlySet<string>): SafeRoute {
  if (!isRecord(value)) return DEFAULT_ROUTE;
  if (value.kind === "root" && isRootTab(value.tab)) {
    return { kind: "root", tab: value.tab };
  }
  if (value.kind === "settings") return { kind: "settings" };
  if (value.kind === "notifications") return { kind: "notifications" };
  if (
    value.kind === "client" && typeof value.clientId === "string" &&
    validClientIds.has(value.clientId) && isClientSection(value.section)
  ) {
    return { kind: "client", clientId: value.clientId, section: value.section };
  }
  return DEFAULT_ROUTE;
}

export function safeRouteFromNavigationState(
  state: unknown,
  validClientIds: ReadonlySet<string>,
  previous: SafeRoute = DEFAULT_ROUTE,
): SafeRoute {
  const root = activeRoute(state);
  if (!root) return sanitizeSafeRoute(previous, validClientIds);
  if (root.name === "Settings") return { kind: "settings" };
  if (root.name === "Notifications") return { kind: "notifications" };
  if (root.name === "Trainer") {
    const tab = activeRoute(root.state)?.name;
    return { kind: "root", tab: isRootTab(tab) ? tab : "Clients" };
  }
  if (root.name === "Client") {
    const clientId = isRecord(root.params) ? root.params.clientId : undefined;
    if (typeof clientId !== "string" || !validClientIds.has(clientId)) return DEFAULT_ROUTE;
    const child = activeRoute(root.state);
    if (child && isClientSection(child.name) && !rootTabs.has(child.name as RootTab)) {
      return { kind: "client", clientId, section: child.name };
    }
    const tab = child?.name === "Main" ? activeRoute(child.state)?.name : undefined;
    if (tab === "Home" || tab === "Nutrition" || tab === "Training") {
      return { kind: "client", clientId, section: tab };
    }
    if (previous.kind === "client" && previous.clientId === clientId) return previous;
    return { kind: "client", clientId, section: "Home" };
  }
  return sanitizeSafeRoute(previous, validClientIds);
}

export function isRootTab(value: unknown): value is RootTab {
  return typeof value === "string" && rootTabs.has(value as RootTab);
}

export function isClientSection(value: unknown): value is ClientSection {
  return typeof value === "string" && clientSections.has(value as ClientSection);
}

interface RouteLike {
  name: string;
  params?: unknown;
  state?: unknown;
}

function activeRoute(state: unknown): RouteLike | null {
  if (!isRecord(state) || !Array.isArray(state.routes)) return null;
  const index = typeof state.index === "number" && Number.isInteger(state.index)
    ? state.index : state.routes.length - 1;
  const route: unknown = state.routes[index];
  if (!isRecord(route) || typeof route.name !== "string") return null;
  return { name: route.name, params: route.params, state: route.state };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
