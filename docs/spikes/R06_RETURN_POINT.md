# R06 — одна полная private точка возврата и завершение операции

Дата: 2026-10-23. **HOST VERIFIED / ANDROID NOT VERIFIED**. R06/D05 OPEN.
Владелец разрешил продолжать без установки тестовой APK; новых установок нет.

Входы: общий SQLite snapshot engine с embedded media, D01 identity, staging
INCOMING, RuntimeMaintenance, GuardedRestore и atomic routing writer. R06 зависит
от R03; D05 → D01/R06, D03 → R04/R05. Product §§46.7–46.11, 46.20, 46.24 и поздние
§§53–56. Migration/overlay/signing/release gates этим срезом не закрываются.

## Что добавлено

`ReturnPointCompletion` — общий чистый state machine, `ExpoReturnPointStore` —
private файловый адаптер. Полный `return.atbackup` создаётся из текущей закрытой
LIVE через тот же snapshot engine: схема/строки/manifest/фото находятся внутри
одного проверенного SQLite-файла. Это не ссылка на прежнюю БД и не raw SAFETY.

Фиксированный workspace root содержит `jobs/UUID/completion.json`,
`jobs/UUID/return.atbackup` и `return-state.json`. Записи допускают только строгие
версии, UUID, SHA, размер/дату и metadata без импортируемых путей. Снимок проверяется
по raw hash/размеру и manifest/content/media; исходные photo URI для проверки
sealed snapshot не нужны. Путь строится только из проверенного UUID.

Routing journal **v2** требует completion protocol. **Guard остаётся version=1**:
это отдельный формат и отдельная задача. v1 routing сохранён для существующего
technical rehearsal. v2 без adapter/intent не открывает runtime и не деградирует
в прежний v1. Прямой вызов writer фиксирует intent до публикации routing journal.

Одна непрерывная closed lease покрывает подготовку точки, журнал, swap и
finalization. После COMMITTED/COMPLETED новая точка проверяется, и одним rename
публикуется state с новым settledOperationId и активной точкой. Лишь после этого
разрешён reopen и удаление прежнего snapshot. При ошибке finalization обычный
runtime остаётся закрытым; cold recovery завершает её перед открытием.

При откате state сохраняет прежнюю точку и записывает settledOperationId новой
неуспешной операции. Повреждение **неиспользованного** нового candidate не мешает
вернуть проверенную исходную LIVE и сохранить прежнюю точку. Успешный commit
по-прежнему не активирует отсутствующий/повреждённый candidate.

Успешный Return публикует point=null и новый settledOperationId. Обратного
пользовательского снимка не создаёт; техническая SAFETY независима. Явное удаление
точки сохраняет settledOperationId, поэтому повторный cold boot не активирует её
заново. Physical cleanup может повторяться после успеха и не меняет доступность.
Новый Restore сначала завершает прежний terminal v2 intent, затем заменяет routing
record; незавершённая metadata не теряется при следующей операции.

## Фактические проверки

`scripts/r06-return-point.test.ts`: **32/32** в штатном полном foundation.

- 30 клиентов A + рецепт/PNG → restore B с 25 → private точка A; удаление исходных
  изображений → Return → ровно 30 клиентов A и точные PNG bytes в новом private
  файле; point погашена, обратной пользовательской точки нет.
- Новый store/cold boot сохраняют точку и поздние business writes. Следующий
  успешный Restore C сохраняет B непосредственно перед ним; старый A удаляется
  только после проверки и публикации B.
- Ошибка swap, неполный snapshot/инъекция ENOSPC, повреждение выбранной точки,
  неудачная публикация state, cleanup failure, stale delete, missing adapter/
  intent, неверные hash/path/null/state проверены без потери исходных данных.
- Реальный RuntimeMaintenance держит RECOVERY_REQUIRED и отклоняет команды после
  ошибки state publication. Reopen происходит только после durable point state.
- **14 настоящих SIGKILL**: Restore — point sealed, intent published, routing
  published, physical swap, COMMITTED, state pending/published и old-point cleanup;
  Return — routing published, swap, COMMITTED, state pending/published и cleanup.
  Достижение каждой точки подтверждено маркером и аварийным завершением дочернего
  synthetic процесса. Cold reader с новым storage возвращает точные bytes LIVE,
  правильную активную/погашенную точку; последующие записи не исчезают.

Итог: `npm run test:foundation` **1051/1051**. Root/mobile/spike typecheck,
lint, arch:check **487 sources**, source:verify и secrets:check прошли.
Android JS/Hermes bundle собран: **5605 modules / 1185 assets**, без установки APK.
Все базы временные и синтетические. Телефон, данные 2.0 и личные backup-файлы
не затрагивались. Реальный low-storage provider/Android kill этим не доказан.

## Открытая интеграция

Cold production reader уже использует completion protocol. Обычный Restore UI
ещё не включён: нужны выбор/preview/явное подтверждение, привязка input к текущему
логическому состоянию с учётом WAL, проверка свободного места и job lifecycle/
очистка orphan до публикации routing record. Нужен единый controller для Restore,
Return и подтверждённого удаления; итоговое восстановление включает OS rest signals.

Native createPoint/finalization/replay ещё не запускались; SDK API проверены
типами, host state machine использует отдельный FS adapter с общим алгоритмом.
Process-death proof не является гарантией power-loss/directory fsync Android.
Autoscheduler/дневная rotation, full populated owner matrix, reinstall и полная
legacy миграция остаются OPEN. Excel идёт после backup/restore.
