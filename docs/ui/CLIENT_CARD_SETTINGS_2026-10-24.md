# Список и карточки клиентов

Task context: C01 follow-up requested by the owner on 2026-10-24. Inputs: existing client list settings, roster projections, client workspace navigation and persisted appearance preferences. Product references: §§7.7–7.8 (list cards), §49.18 (measurement ambiguity), §51.2.3 (missing values). No production DDL, migration, APK overlay or release gates are changed.

## Reference inspected

Read only from FitCoach 2.0, branch `stable/v2.0.0-build120`:

- [ClientCardsSettingsScreen.tsx](https://github.com/Hwan-Karasu/fitcoach/blob/stable/v2.0.0-build120/apps/mobile/src/features/settings/screens/ClientCardsSettingsScreen.tsx)
- [clientCardSettings.ts](https://github.com/Hwan-Karasu/fitcoach/blob/stable/v2.0.0-build120/apps/mobile/src/shared/settings/clientCardSettings.ts)

The legacy screen configures the initial client section; up to four ordered list-card metrics (weight, pack, calories, last workout, steps, body fat); health/birthday badges; birthday pin days; clients-list shortcut; navigation labels. No old authentication, database or cloud architecture was copied.

## Implemented

- Renamed Settings item and header to «Список и карточки клиентов».
- Initial section choices match the four real workspace tabs: Home, Nutrition, Training, More. A normal list-card open honours this choice; explicit notification/workout destinations still specify their own route. More opens its menu, where Questionnaire and Training Archive remain destinations. Previously saved Profile/Archive preferences normalize to More. A different client's tab navigator has a client-specific key.
- Up to four ordered metrics, including all six legacy options plus the existing next-appointment metric. Enabling order determines display order; disabling every tile is supported. Existing three default metrics remain the default. Owner's final correction: four metrics remain in one row in pinned and regular cards. Pinned tiles use shorter visible labels and tighter horizontal padding; regular cards use the full row width. Values adapt their font size, while accessible names retain full labels and values.
- Settings are grouped into four bordered surface cards: entry section, list tiles and health indicator, navigation, birthdays. Each block has its own heading and consistent spacing.
- Follow-up verification: inspected actual Expo roster with four enabled metrics; pinned tiles and regular indicators fit on one row. Mobile TypeScript and targeted ESLint pass for the grouped settings and compact cards.
- Optional health restriction indicator. Birthday options remain backed by the existing Clients owner.
- Clients-list shortcut and navigation label toggles share the existing values used in Appearance.
- New display preferences live in the existing appearance JSON and pass validation/defaulting. No schema changes or mutations to client business facts. The UI uses the existing save-error toast if persistence fails.
- Roster read model gets optional measurement, diary, step and training-history ports. Extra values are read only for selected metrics. Weight/body fat use the owner's latest daily point rule: ambiguous values remain missing. Calories/steps refer to today; latest completed actual workout comes from Training, independently of Calendar. Missing values render as «—»; recorded zero remains zero. Owner changes refresh the projection.

## Validation

- Mobile TypeScript, targeted ESLint, module boundaries (516 source files) and source manifest verification passed.
- Theme/settings 29 tests, roster projections 3 tests, roster presentation 8 tests, calendar 19 tests passed. New checks cover persistence/restart for all four initial sections; compatibility of old Profile/Archive values; ordering, four-tile limit, empty choices and invalid values; selected-owner reads and zero vs missing metrics.
- Android JavaScript bundle passed (5631 modules). This is not an APK/release check.
- Actual Expo phone: inspected renamed settings and control layout, enabled Training start and a fourth Weight tile, opened a client directly in Training, inspected four-card layout as two rows and the real weight value. Temporary test preferences were restored to Home and the previous three metrics. No business records were created or removed.
- Root-wide TypeScript currently fails in an unrelated concurrent edit: scripts/r04/LegacyNutritionArchive.ts:26, TS1294 (erasableSyntaxOnly). That file was not changed for this task.

## Follow-up calendar requests in the same session

- Removed the Client/Guest mode selector. Typing an unmatched or unselected name records a guest name; choosing a search result binds the client ID and clears the search. No automatic linking by matching name. Historical/credit semantics and explicit guest linking remain.
- Session-type chips use two columns; an odd final chip fills the final row instead of leaving a blank cell.
- Restored USB reverse forwarding to port 8083 and reopened Expo Go after the cable was disconnected; inspected the loaded app and its debugger connection.
- Increased the food-picker category menu gap from 2 to 10 dp through an opt-in SegmentedControl `scrollItemGap` prop. Other segmented controls retain their existing spacing. Mobile TypeScript and targeted ESLint pass; no food data or filtering logic changed.
