import { workbookSheetHash } from "../../../shared/training-transfer/WorkbookSheetIdentity.ts";
import type { BuilderExcelDraft } from "../../../shared/training-transfer/BuilderWorkbook.ts";
import type { WorkbookReviewSession } from "./WorkbookReviewSession.ts";
import { workbookMatchesToRemember } from "./WorkbookReviewSession.ts";
import { compileWholeWorkbook } from "./WholeWorkbookImport.ts";

/** Keep temporary row IDs through editing so actual results remain linked to their source plan. */
export function builderWorkbookImport(session: WorkbookReviewSession): BuilderExcelDraft {
  const { value, mapping } = compileWholeWorkbook(session);
  const cycles = value.programs[0]!.mesocycles.map((cycle) => {
    const workouts = new Set(cycle.weeks.flatMap((w) => w.workouts.map((x) => x.id)));
    const sourceSessions = value.sessions.filter((s) => workouts.has(s.plannedWorkoutId));
    const names = new Set(cycle.weeks.flatMap((w) => w.workouts.flatMap((x) => x.exercises.map((e) => e.exerciseId))));
    return { key: cycle.id, title: cycle.title, settings: { cycleType: cycle.cycleType, repRange: cycle.repRange, startDate: cycle.startDate },
      weeks: cycle.weeks.map((w) => ({ type: w.type, workouts: w.workouts.map((x) => ({ ...x,
        exercises: x.exercises.map((e) => ({ ...e, exerciseId: mapping[e.exerciseId]! })) })) })),
      imported: { sourceId: value.sourceId,
        sourceHash: workbookSheetHash(cycle, sourceSessions, mapping),
        sessions: sourceSessions.map((s) => ({ ...s, facts: s.facts.map((f) => ({ ...f, exerciseId: mapping[f.exerciseId]! })) })),
        matches: workbookMatchesToRemember(session, true).filter((m) => value.exercises.some((e) => names.has(e.id) && e.name.trim() === m.sourceName)) } };
  });
  return { title: session.programTitle, cycles, weeks: cycles[0]!.weeks, settings: cycles[0]!.settings };
}
