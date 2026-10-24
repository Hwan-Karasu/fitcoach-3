import assert from "node:assert/strict";
import test from "node:test";
import { StackActions, StackRouter } from "@react-navigation/routers";
import { clientsListAction } from "../src/app/navigation/clientsListAction.ts";

const options = { routeNames: ["Root", "ClientWorkspace", "Appearance", "Settings", "Notifications", "Backup", "ClientEditorDev"],
  routeParamList: {}, routeGetIdList: {} };

for (const screen of options.routeNames) {
  test(`clients shortcut returns from ${screen} to existing Root/Clients without resetting root state`, () => {
    const router = StackRouter({ initialRouteName: "Root" });
    let state = router.getInitialState(options);
    const tabState = { stale: false as const, type: "tab", key: "root-tabs", index: 1,
      routeNames: ["Clients", "Calendar"], routes: [{ key: "roster", name: "Clients" }, { key: "calendar", name: "Calendar" }] };
    const root = { ...state.routes[0]!, state: tabState, params: { retainedPreference: "synthetic-filter" } };
    state = { ...state, routes: [root] };
    if (screen !== "Root") {
      state = router.getRehydratedState(router.getStateForAction(state, StackActions.push("ClientWorkspace", { clientId: "synthetic-client" }), options)!, options);
      state = router.getRehydratedState(router.getStateForAction(state, StackActions.push(screen), options)!, options);
    }
    const next = router.getRehydratedState(router.getStateForAction(state, clientsListAction(), options)!, options);
    assert.equal(next.routes.length, 1);
    assert.equal(next.index, 0);
    assert.equal(next.routes[0]!.key, root.key);
    assert.strictEqual(next.routes[0]!.state, tabState);
    assert.deepEqual(next.routes[0]!.params, { retainedPreference: "synthetic-filter", screen: "Clients", params: { screen: "Roster" } });
    const repeated = router.getStateForAction(next, clientsListAction(), options)!;
    assert.equal(repeated.routes.length, 1);
    assert.equal(repeated.routes[0]!.key, root.key);
  });
}
