# Фильтры клиентов, рецепты и стрелки недель

Owner requests on 2026-10-24, C01 follow-up. Inputs: roster presenter and owner read projections, recipe filter draft controls, focused tab-bar slots. Product references: §7.2 (structured filters intersect the dataset before birthday/recent priorities and Today/search), §22.1.2 (pack availability). No DDL, migration, APK or release gate work.

## Clients

The owner explicitly chose sex, restrictions and pack filters, without custom tags. The former placeholder now opens a compact dialog with independent blocks and Apply/Reset actions. Sex: all/men/women/unspecified; health: all/restricted/unmarked; pack: all/available/no available credits/no pack/not tracked. Unmarked means no restriction marker, not a medical assessment.

Filters run inside the pure roster projection before sections are formed. Birthday/recent rows cannot bypass them. Identity search and Today intersect with the same filters; Today retains appointment-time ordering. The toolbar shows the number of active filter axes, and no-match offers a full reset. Draft changes apply only on Apply; closing cancels. Selection stays in the retained roster screen during ordinary navigation, not a new persisted preference.

The existing accounting projection exposes typed pack status independently of visible tiles. Expired/fully reserved packs have no available credits; unavailable accounting never masquerades as zero/no pack. Failed questionnaire reads do not masquerade as an unmarked health status. Loading owner data has a loading state.

## Recipe menus

Reworked Recipe Filters and its adjacent Sort dialog as compact centred rounded windows. Calorie/time options use equal two-column rows, with an odd final option spanning the row. Separate surface blocks group calories, preparation time and macro ranges. Removed the long explanatory paragraph; kept field labels, percent units, sliders and range-validation errors. Reset/Apply share a fixed footer; X/backdrop close without applying. Keyboard avoidance and safe-area padding keep controls reachable. Filtering/sorting business rules remain unchanged.

## Week arrows

Week arrows flank the entire bottom bar, outside its central participant/tabs/clients-shortcut column. Icons are 32 dp; buttons stretch over the full inner panel height. Final owner adjustment: 36 dp width, panel horizontal padding 2 dp. First/last-week disabled conditions and busy guards use the same focused slots as before. Screens without week slots keep their normal navigation.

## Validation

- Mobile TypeScript, targeted ESLint and architecture boundaries pass (521 files).
- 10 roster presentation tests and 32 combined read-model/recipe/tab-slot/navigation tests pass. Added intersection tests for sex/health/credit with birthday/recent, identity search and Today ordering; unknown values and unspecified sex are explicit cases.
- Actual phone screenshot inspected for the full-height week-arrow layout. Final narrower width is applied via Expo refresh. No claims of physical interaction testing for the new client/recipe dialogs; their logic was checked with the tests above. Temporary screenshots removed.
