# R04: выбранный мезоцикл каждой программы

2026-10-25, база `f59c228`. Входы: admitted account/workspace namespace, physical
Plans/view rows, проверенные source→native program/cycle/client aliases. Зависимости:
R03 fixtures, общий Plans projector/write plan, source coverage, immutable jobs,
native Plans repository и обычный 3.x snapshot engine. R04→R03; Product
§§48.1–48.5.7,49–50,53–56 / INT-03–12, особенно §50.2 и §50.4.12.
Private synthetic/finalizable:false; production DDL/migration/overlay/signing/
release gates OPEN. Телефон, реальная 2.0 и пользовательские файлы не открывались.

## Изменение

Ранее training_workspaces.active_program_id уже восстанавливал текущую программу
и её мезоцикл. Но training_program_view_state.selected_program_id отдельно хранит
последнюю открытую страницу **каждой** книги. Такой выбор оставался только raw,
а native reader при отсутствии строки выбирал первый мезоцикл.

Общий Plans projector теперь восстанавливает доказанный выбор страницы в existing
training_mesocycle_selection. Он не выбирает саму программу, не переводит её из
архива и не меняет training_client_selection. Никаких новых таблиц, production DDL,
UUID kinds или фактических выполнений. 84-table candidate не расширяется.

## Правила сопоставления

- Namespace `trainer:<actorId>:<workspaceId>` должен иметь тот же явный workspace,
  что admitted source. Берётся точный actorId этой привязки. Это проверка
  согласованности исходного namespace, не auth/backend или восстановление ролей.
- Только view этого actor, правильного client и физического library root.
  Другие actor rows сохраняются без применения, даже если last_opened_at новее.
- selected_program_id должен указывать на активную source page того же клиента,
  с PLAN alias и соответствующим native program/member/mesocycle. Ни имена, ни
  время, ни ordinal не используются для выбора владельца/страницы.
- Уникальная source identity — actor/client/library tuple. Дубли не разрешаются
  last-write-wins: обе строки остаются REVIEW_REQUIRED. Чужие/удалённые/неизвестные
  страницы и противоречие library root тоже требуют разбора.
- Существующий выбор из training_workspaces сохраняется. При отличающемся выборе
  view **той же** книги фиксируется VIEW_AND_ACTIVE_PAGE_CONFLICT; overwrite по
  timestamp не выполняется. Совпадение помечается уже представленным.
- Архивная программа сохраняет страницу для последующего просмотра/возврата,
  оставаясь архивной и не становясь текущей (§50.2).
- Simple page не становится мезоциклом. NULL/пустой selected_program_id не
  переключает текущую книгу и не означает назначение первой страницы.
- В `trainer:legacy` привязка не содержит actorId: старый offline factory создаёт
  случайные user/workspace IDs. Единственный view actor, префикс его имени или
  совпадение client ID не доказывают, что это владелец файла. Такие записи, client
  role scope и несовпадающий workspace остаются raw/review. Позднейшее явное
  подтверждение source actor через import flow пока не реализовано.

training_library_preferences.preferred_id — закрепление/сортировка книги. Это не
текущая программа и не страница книги: перенос не применяет его как selection.
state_json/week_state_json и last_opened_at не получают выдуманных native полей.
Они сохранены source coverage и Plans receipt, но ещё требуют отдельного mapping/
technical-reset решения. deferredViewRows/deferredPreferenceRows не уменьшены:
срез не заявляет полное сопоставление всех колонок этих строк.

## Сохранение и повтор

Новые view representations и version1 входят в проверяемый Plans target receipt;
physical source_json имеет прежний точный контракт для Execution. Source capture
до await, общий exclusive tx/parity/FK/identity ledger остаются. Native selection
использует существующие UUID aliases, без новой allocation и без чужих IDs.
restoredViewSelections — число восстановленных выборов в **проекции целиком**,
не число новых INSERT при replay. viewSelectionReviewRows не включает состояния
OTHER_ACTOR_RETAINED и не означает число потерянных фактов.

Дополнительный mode TRAINING_VIEW_SELECTIONS_REHEARSAL_V1 включён в одинаковом
порядке в mobile и Node binding. Старый private candidate отклоняется до WAL;
его нельзя незаметно преобразовать новым кодом. Новые mode/generator не являются
обновлением production schema или разрешением cutover.

## Первичные источники 2.0

Pinned `e116b42e95f70a5a5e563420ab25394944c59ffd`:

- [accountDatabase.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/accountDatabase.ts)
  и [accountDatabaseBinding.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/shared/db/accountDatabaseBinding.ts):
  trainer/client scope, legacy binding без actor, неоднозначность не исправляется.
- [auth.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/packages/domain/src/auth.ts):
  случайные user/workspace IDs offline trainer; в код 3.x токены/сессии не перенесены.
- [ProgramLibraryRepository.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/ProgramLibraryRepository.ts):
  list/opened/viewState actor filtering и отдельный preferred pin.
- [TrainingWorkspaceRepository.ts](https://github.com/Hwan-Karasu/fitcoach/blob/e116b42e95f70a5a5e563420ab25394944c59ffd/apps/mobile/src/features/training/data/TrainingWorkspaceRepository.ts):
  active_program_id и programStates независимы от per-book view rows.

## Проверки и ограничения

scripts/r04-view-selections.test.ts: 10 новых tests. Доказаны noncurrent book и
непервый мезоцикл; другой actor/newer timestamp; legacy/client/wrong-workspace/
opaque scopes; duplicate/foreign/deleted/dangling/root conflicts; archived/Simple/
NULL cases; source capture/target drift; plan/receipt/Execution/precommit rollback,
native INSERT failure и stable replay; before-WAL mode guard с positive control.

Actual Expo adapters через SDK mocks, реальные host-файлы и host Worker terminate
до commit: rollback → restart без selected-source → replay без allocation.
Native Clients/Plans rows перенесены в полную синтетическую ordinary 3.x schema,
прошли actual createSqliteBackup/prepareBackupForRestore. Fresh Worker запрещает
legacy-import/shared migration/scripts-r04 с positive probe, затем ordinary Plans
repository читает непервый мезоцикл и меняет его, сохраняя текущую другую программу.
Это не UI rendering/custom catalog/full Execution/provenance/review backup proof.

53/53 Plans/portable/archive dependencies и финальные66/66 targeted PASS, включая
все10 новых и actual all-owner composition/Settings/builders/coverage/jobs.
Root/mobile TypeScript, scoped lint, source baseline73/arch618 и secrets PASS.
Staged diff PASS. Foundation/full R04 profile/bundle/
APK/Android не запускались. Полный restore/removal, постоянные модели, оставшиеся
fields/source variants, UI/cutover, actual Android/low-disk/concurrency/GC и release
gates остаются открытыми. Goal ACTIVE, не100%.
