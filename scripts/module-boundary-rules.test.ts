import assert from "node:assert/strict";
import test from "node:test";
import { validateModuleImport } from "./module-boundary-rules.ts";

const base = "apps/mobile/src/";

test("neighbor feature must use its public.ts", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/application/create.ts`,
    `${base}features/accounting/data/repository.ts`, "../../accounting/data/repository",
  ), ["CROSS_FEATURE_INTERNAL"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/application/create.ts`,
    `${base}features/accounting/public.ts`, "../../accounting/public",
  ), []);
});

test("training submodules are separate owners", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/training/plans/application/edit.ts`,
    `${base}features/training/execution/data/facts.ts`, "../../execution/data/facts",
  ), ["CROSS_FEATURE_INTERNAL"]);
});

test("domain remains pure and does not import neighboring feature", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/domain/policy.ts`, null, "react-native",
  ), ["DOMAIN_TO_RUNTIME_PACKAGE"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/domain/policy.ts`,
    `${base}features/accounting/public.ts`, "../../accounting/public",
  ), ["DOMAIN_TO_FEATURE"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/domain/policy.ts`,
    `${base}shared/db/tx.ts`, "../../../shared/db/tx",
  ), ["DOMAIN_TO_IMPURE_LAYER"]);
});

test("UI cannot import SQLite or repository data", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/presentation/Calendar.tsx`, null, "expo-sqlite",
  ), ["UI_TO_DATABASE"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/presentation/Calendar.tsx`,
    `${base}features/calendar/data/repository.ts`, "../data/repository",
  ), ["UI_TO_DATABASE"]);
});

test("features and shared cannot import higher layers", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/application/create.ts`,
    `${base}workflows/calendar-accounting.ts`, "../../../workflows/calendar-accounting",
  ), ["FEATURE_TO_HIGHER_LAYER"]);
  assert.deepEqual(validateModuleImport(
    `${base}shared/utilities/date.ts`,
    `${base}features/calendar/public.ts`, "../../features/calendar/public",
  ), ["SHARED_TO_HIGHER_LAYER"]);
});

test("unapproved aliases and source escapes fail", () => {
  assert.deepEqual(validateModuleImport("apps/mobile/index.ts", "apps/mobile/App.tsx", "./App"), []);
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/application/create.ts`, null, "@/features/accounting/data/repository",
  ), ["UNKNOWN_SOURCE_ALIAS"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/calendar/application/create.ts`, "apps/mobile/scripts/unsafe.ts", "../../../../scripts/unsafe",
  ), ["OUTSIDE_MOBILE_SOURCE"]);
});

test("app and workflows consume only feature public APIs", () => {
  assert.deepEqual(validateModuleImport(
    `${base}app/navigation/RootTabs.tsx`,
    `${base}features/clients/presentation/ClientListsPreview.tsx`,
    "../../features/clients/presentation/ClientListsPreview.tsx",
  ), ["CONSUMER_TO_FEATURE_INTERNAL"]);
  assert.deepEqual(validateModuleImport(
    `${base}workflows/client-editor.ts`,
    `${base}features/clients/data/ClientRepository.ts`,
    "../features/clients/data/ClientRepository.ts",
  ), ["CONSUMER_TO_FEATURE_INTERNAL"]);
  assert.deepEqual(validateModuleImport(
    `${base}read-models/roster.ts`,
    `${base}features/clients/public.ts`,
    "../features/clients/public.ts",
  ), []);
});

test("composition root alone may construct a feature data adapter", () => {
  assert.deepEqual(validateModuleImport(
    `${base}app/composition/createDevServices.ts`,
    `${base}features/clients/data/DevClientRepository.ts`,
    "../../features/clients/data/DevClientRepository.ts",
  ), []);
  assert.deepEqual(validateModuleImport(
    `${base}app/navigation/PrototypeShell.tsx`,
    `${base}features/clients/data/DevClientRepository.ts`,
    "../../features/clients/data/DevClientRepository.ts",
  ), ["CONSUMER_TO_FEATURE_INTERNAL", "UI_TO_DATABASE"]);
});

test("feature application receives repositories through ports", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/clients/application/CreateClient.ts`,
    `${base}features/clients/data/ClientRepository.ts`,
    "../data/ClientRepository.ts",
  ), ["APPLICATION_TO_DATA"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/clients/application/CreateClient.ts`,
    `${base}features/clients/presentation/ClientEditor.tsx`,
    "../presentation/ClientEditor.tsx",
  ), ["APPLICATION_TO_PRESENTATION"]);
});

test("feature data cannot depend on upper layers", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/clients/data/ClientRepository.ts`,
    `${base}features/clients/application/CreateClient.ts`,
    "../application/CreateClient.ts",
  ), ["DATA_TO_APPLICATION"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/clients/data/ClientRepository.ts`,
    `${base}features/clients/presentation/ClientEditor.tsx`,
    "../presentation/ClientEditor.tsx",
  ), ["DATA_TO_PRESENTATION"]);
});

test("feature public barrel does not expose database internals", () => {
  assert.deepEqual(validateModuleImport(
    `${base}features/clients/public.ts`,
    `${base}features/clients/data/ClientRepository.ts`,
    "./data/ClientRepository.ts",
  ), ["PUBLIC_TO_DATABASE"]);
  assert.deepEqual(validateModuleImport(
    `${base}features/clients/public.ts`, null, "expo-sqlite",
  ), ["PUBLIC_TO_DATABASE"]);
});
