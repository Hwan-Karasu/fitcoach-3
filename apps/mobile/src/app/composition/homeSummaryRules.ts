import { formatKopeks, pricePerSessionKopeks } from "../../features/accounting/public.ts";
import type { HomeSummaryRules } from "../../read-models/clientHomeSummary.ts";

/** Чистые правила владельца для проекций Главной и списка клиентов. */
export const homeSummaryRules: HomeSummaryRules = { formatKopeks, pricePerSessionKopeks };
