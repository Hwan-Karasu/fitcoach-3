import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROUTE,
  safeRouteFromNavigationState,
  sanitizeSafeRoute,
} from "./safeRoute.ts";

const clients = new Set(["client-a", "client-b"]);

test("invalid and stale snapshots fall back to Clients", () => {
  assert.deepEqual(sanitizeSafeRoute(null, clients), DEFAULT_ROUTE);
  assert.deepEqual(sanitizeSafeRoute({ kind: "client", clientId: "deleted", section: "Training" }, clients), DEFAULT_ROUTE);
  assert.deepEqual(sanitizeSafeRoute({ kind: "root", tab: "Settings" }, clients), DEFAULT_ROUTE);
  assert.deepEqual(sanitizeSafeRoute({ kind: "client", clientId: "client-a", section: "More" }, clients), DEFAULT_ROUTE);
});

test("snapshot removes arbitrary params and keeps six allowed sections", () => {
  const sections = ["Home", "Nutrition", "Training", "Questionnaire", "TrainingArchive", "Statistics"];
  for (const section of sections) {
    assert.deepEqual(
      sanitizeSafeRoute({ kind: "client", clientId: "client-a", section, secret: "discard" }, clients),
      { kind: "client", clientId: "client-a", section },
    );
  }
});

test("root tabs and separate routes are distinct", () => {
  assert.deepEqual(sanitizeSafeRoute({ kind: "root", tab: "Calendar" }, clients), { kind: "root", tab: "Calendar" });
  assert.deepEqual(sanitizeSafeRoute({ kind: "settings" }, clients), { kind: "settings" });
  assert.deepEqual(sanitizeSafeRoute({ kind: "notifications" }, clients), { kind: "notifications" });
});

test("navigation state projects only the active safe route", () => {
  const state = {
    index: 1,
    routes: [
      { name: "Trainer", state: { index: 0, routes: [{ name: "Clients" }] } },
      {
        name: "Client", params: { clientId: "client-b", unsavedForm: "do not persist" },
        state: { index: 0, routes: [{ name: "Main", state: { index: 2, routes: [{ name: "Home" }, { name: "Nutrition" }, { name: "Training" }] } }] },
      },
    ],
  };
  assert.deepEqual(safeRouteFromNavigationState(state, clients), { kind: "client", clientId: "client-b", section: "Training" });
});

test("More menu keeps prior semantic section; explicit destination is restored", () => {
  const previous = { kind: "client", clientId: "client-a", section: "Nutrition" } as const;
  const state = { index: 0, routes: [{ name: "Client", params: { clientId: "client-a" }, state: {
    index: 0, routes: [{ name: "Main", state: { index: 0, routes: [{ name: "More" }] } }],
  } }] };
  assert.deepEqual(safeRouteFromNavigationState(state, clients, previous), previous);
  state.routes[0]!.state.routes.push({ name: "Statistics" } as never);
  state.routes[0]!.state.index = 1;
  assert.deepEqual(safeRouteFromNavigationState(state, clients, previous), { kind: "client", clientId: "client-a", section: "Statistics" });
});
