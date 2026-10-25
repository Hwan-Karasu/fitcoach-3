import { accountingBaseline } from "../AccountingBaseline.generated.ts";

/** Existing owner D01 definitions, exposed only for the isolated bridge rehearsal.
 * The composition root supplies these to the calendar coordinator before opening SQL.
 */
export const legacyAccountingStagingStatements: readonly string[] = Object.freeze(accountingBaseline.flatMap((step) => [...step.statements]));
