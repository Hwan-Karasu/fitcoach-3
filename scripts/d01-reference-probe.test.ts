import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { candidateOwnerGuardsSql } from "./d01/CandidateOwnerGuards.ts";
import { probeReferenceOwnerGuards } from "./d01/ProbeReferenceSchema.ts";

const referenceSql = new URL(
  "../../FitCoach_3_DOCUMENTS_SYNCED_2026-10-14/03-Data-Technical/reference-only/sql/001_reference_schema.sql",
  import.meta.url,
);

test("D01 reference-only schema exposes owner holes without any production write", () => {
  const report = probeReferenceOwnerGuards(readFileSync(referenceSql, "utf8"));
  assert.deepEqual(report, {
    status: "reference-only",
    foreignKeysEnabled: true,
    appointmentForeignClientAccepted: false,
    appointmentForeignSessionTypeAccepted: true,
    diaryForeignWorkspaceProductAccepted: true,
    programForeignWorkspaceCohortAccepted: true,
    primaryForeignMeasurementAccepted: false,
    sessionForeignClientProgramAccepted: false,
    reassignProgramAfterSessionAccepted: true,
    reassignMeasurementAfterPrimaryAccepted: true,
    appointmentOwnSessionTypeAccepted: true,
    diaryOwnProductAccepted: true,
    diaryOwnRecipeAccepted: true,
    programOwnCohortAccepted: true,
    updateProgramNameAccepted: true,
    updateMeasurementValueAccepted: true,
    updateAppointmentToForeignTypeAccepted: true,
    updateDiaryToForeignProductAccepted: true,
    updateProgramToForeignCohortAccepted: true,
    moveReferencedSessionTypeAccepted: true,
    moveReferencedProductAccepted: true,
    moveReferencedRecipeAccepted: true,
    moveReferencedCohortAccepted: true,
    productionSchemaApproved: false,
    targetWrites: 0,
  });
});

test("D01 candidate overlay closes observed holes while allowing same-owner operations", () => {
  const report = probeReferenceOwnerGuards(readFileSync(referenceSql, "utf8"), candidateOwnerGuardsSql);
  assert.deepEqual(report, {
    status: "candidate-overlay",
    foreignKeysEnabled: true,
    appointmentForeignClientAccepted: false,
    appointmentForeignSessionTypeAccepted: false,
    diaryForeignWorkspaceProductAccepted: false,
    programForeignWorkspaceCohortAccepted: false,
    primaryForeignMeasurementAccepted: false,
    sessionForeignClientProgramAccepted: false,
    reassignProgramAfterSessionAccepted: false,
    reassignMeasurementAfterPrimaryAccepted: false,
    appointmentOwnSessionTypeAccepted: true,
    diaryOwnProductAccepted: true,
    diaryOwnRecipeAccepted: true,
    programOwnCohortAccepted: true,
    updateProgramNameAccepted: true,
    updateMeasurementValueAccepted: true,
    updateAppointmentToForeignTypeAccepted: false,
    updateDiaryToForeignProductAccepted: false,
    updateProgramToForeignCohortAccepted: false,
    moveReferencedSessionTypeAccepted: false,
    moveReferencedProductAccepted: false,
    moveReferencedRecipeAccepted: false,
    moveReferencedCohortAccepted: false,
    productionSchemaApproved: false,
    targetWrites: 0,
  });
});
