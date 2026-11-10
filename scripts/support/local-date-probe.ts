import { localDateText } from "../../apps/mobile/src/shared/domain/LocalDate.ts";

const instant = process.argv[2];
if (instant === undefined) throw new Error("INSTANT_REQUIRED");
console.log(localDateText(new Date(instant)));
