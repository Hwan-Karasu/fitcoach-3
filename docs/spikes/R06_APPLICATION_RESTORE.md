# R06 — восстановление в приложении и lifecycle временных файлов

Дата: 2026-10-23. R06/D05 OPEN. Входы: общий snapshot engine, D01 identity,
RuntimeMaintenance, v2 routing и ReturnPointCompletion. R06→R03, D05→D01/R06;
Product §46, §§53–56. Migration/overlay/signing/release gates остаются OPEN.

## Подключение

Production composition создаёт ленивый ExpoRestoreJobs и RestoreActionsService.
ApplicationRuntime передаёт публичный restoreActions port в BackupScreen.
В dev и Expo Go операции отключены: dev baseline не выдаётся за production workspace.
RestoreSection показывает проверенную дату/числа клиентов; замена/Return/удаление
точки требуют отдельного явного действия в Alert. Ошибки имеют русские подписи
без системных кодов, SQLite сообщений и путей. UI не получает SQL или file handles.

Уход с экрана отменяет preview, включая поздний результат picker/preparation;
его cleanup завершается внутри command admission. Начатое подтверждённое применение
не отменяется при unmount. Maintenance меняет generation корневой навигации даже
при batching React: старые drafts/read models не переживают замену. После reopen
открываются резервные копии с результатом операции и обычной кнопкой Назад.
Экран RECOVERY_REQUIRED позволяет повторить cold recovery без закрытия приложения.
Результат повторной попытки связан с ID подтверждённой операции: commit показывает
успех, rollback — сохранение прежних данных. Старый receipt не выдаётся за новый
успех. После verified recovery ошибка дополнительного чтения point summary не
блокирует здоровую базу; summary можно проверить повторно.

## Файлы и проверка места

Системный picker возвращает SDK57 canceled/result. Внешний URI только копируется
в свежий private jobs/UUID/inspection.atbackup; SQLite никогда не открывает его
напрямую. owner.json записывается перед остальными файлами. Общий engine проверяет
копию и staging, восстанавливает фото в local-images с restoreId=job UUID.
Preview pin вычисляется по стабильной online SQLite-копии текущей LIVE, а не по
сырому файлу с WAL. После закрытия holders повторно проверяются logical LIVE,
raw INCOMING и Paths.availableDiskSpace. Только после этого готовится полная точка,
публикуется v2 pending и начинается GuardedRestore. Harmless WAL checkpoint допустим,
intervening business write требует нового выбора. Исходный внешний файл неизменен.

Начальная оценка места учитывает inspection/staging/extracted media/current preview.
Перед заменой резервируются дополнительные LIVE copies и BLOB media pages с запасом
для state/journal. Это консервативная оценка, не гарантия отсутствия дальнейшего ENOSPC.
Отказ до swap сохраняет здоровую исходную базу; неопределённый результат проходит
общий cold protocol внутри той же closed lease до reopen.

## Очистка

Отмена/stale preview освобождают только собственный UUID job и его сгенерированные
неопубликованные фото. Новый adapter может убрать оставленный pre-confirmation job
после потери in-memory состояния. Неизвестные каталоги/owner markers и неоднозначная
metadata сохраняются. Pending job и active point защищены. После terminal finalization
удаляются крупные inspection/current-preview/SAFETY/PREVIOUS slots, но pending,
guard, completion и активный return.atbackup остаются для cold replay.

GC сгенерированных restore-фотографий проходит только при физически закрытом runtime.
Он читает все recipe references, включая архив, защищает другие активные previews,
проверяет полноту активной точки и удаляет только распознанные сгенерированные файлы,
которых нет среди ссылок. Business images с другими именами не затрагиваются.
Повреждённая JSON/metadata или недоступное чтение останавливают GC. Ошибка cleanup
не отменяет проверенный результат восстановления. После process death без обычного
apply cleanup часть временных файлов может остаться до следующей подготовки.

## Системные сигналы

Перед закрытием базы RestTimerService ждёт поздние schedules и снимает только
принадлежащие rest-timer OS requests/presented notifications/launch response.
Imported signal IDs не считаются правом отменять уведомления других features.
На boot/reopen очищаются устаревшие rest notifications; активные таймеры получают
новые OS IDs с прежним endAt без запроса разрешения. Paused остаются paused,
expired удаляются без повторного запуска. Отказ платформы оставляет визуальный таймер.
Calendar/другие notification kinds сохраняются. После сбоя сохранения нового ID
свежий OS request отменяется. UI не остаётся с dock прежнего workspace.

## Проверки и границы

Foundation на интеграционном срезе **1086/1086**: новые late-preview-cancel, шесть timer reconciliation/race
checks и три проверки реального ownership-filter helper; прежние WAL/maintenance/
writer/point/SIGKILL checks также прошли. Root/mobile/spike typecheck, lint и arch494
прошли. После последних isolated recovery-result правок: целевые controller tests
**15/15**, включая commit/rollback/старый receipt и недоступный point summary;
полный foundation повторно не запускался. Текущий Android JS/Hermes bundle:
**5614 modules/1185 assets**. По просьбе владельца проверки выбираются по изменённой
области; полный набор запускается на крупных контрольных этапах.

Нативный actions probe использует тот же ExpoRestoreJobs/controller/core,
15 runtime holders и workflow, только synthetic private пути. Он выбирает известный
synthetic source через test composition; это не ручной E2E Alert/system picker UI.
Android **24/24**: preview/cancel/stale business write/safe reopen/orphan cleanup,
полная замена без merge, точные фото, point после cleanup, Return с фото после
потери оригинала, GC прежних restore/Return images после sealing новой точки,
поздние writes/receipt replay/следующий Restore/explicit delete/no resurrection.
Весь этот synthetic сценарий занял 284130 мс, это не время одного Restore.
Последнее изменение recover receipt проверено отдельно на той же завершённой
fixture: **3/3**, 6463 мс, повторная большая подготовка не запускалась.
[Фактические отчёты и границы](R06_RESTORE_ACTIONS_ANDROID_REPORT.json).

Открыты: обычный enabled UI E2E/Back/Alert на Android, native OS timer signals,
реальный ENOSPC/другие providers, publication process death/partial cleanup,
full populated owner matrix, autoscheduler/3 daily rotation, first-run restore
choice и полный legacy mapping/staging/IDs/provenance/parity/retry. 2.0 build128,
личные backup-файлы и секреты не затрагиваются. Excel идёт после backup/restore.
