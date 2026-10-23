# R06 — автоматические копии и три дневные версии

Дата: 2026-10-23. База fafe3e5. R06/D05 OPEN; не готовая миграция 2.0.
Входы: общий SQLite snapshot engine, Manual/Restore ports, RuntimeCommandGate,
Android Downloads/SAF publisher. R06→R03, D05→D01/R06, Product §§46.13–46.16,
46.20, 46.25 и поздние §§53–56. Migration/overlay/signing/release gates OPEN.

## Подключение

AutomaticBackupHost связывает AppState с AutomaticBackupScheduler и runtime port.
Первая проверка регистрирует 30-минутный срок; при активности следующая проверка
идёт по сохранённому checkedAt. Возврат из фона проверяет срок сразу. Дублирующее
active событие не создаёт ещё одну попытку. Фон не обещает периодической записи.
Unmount отменяет таймер, не начатый job. Runtime gate держит весь online reader,
публикацию и cleanup; maintenance ждёт его окончания. Timer delay ограничен
интервалом, поэтому обратный скачок даты не переполняет платформенный setTimeout.

Dev/ExpoGo и старая версия native module отключены. Production использует
automaticProtocolVersion=1. SharedSqliteDatabase/DDL и установленные данные 2.0
не меняются. Настройки показывают отдельные automatic/manual/Return sections;
значимая неисправность видна также общей плашкой с переходом к копиям. В продукте
нет системных кодов/путей. Fixed failure status хранится вне SQLite и не пропадает
после recreation; успешная проверка снимает его. AUTO_NOT_READY во время maintenance
не превращается в сохраняемую неисправность копий.

## Снимок и состояние

ExpoAutomaticBackupFiles создаёт свежий owner-marked UUID job, online private copy
и logical hash до embedding media. При совпадении с последним опубликованным
content hash новый snapshot/внешний файл не создаётся даже в другой день.
Перед этим проверяется доступность прежних записанных файлов. Изменённая private
копия проходит общий full snapshot engine с manifest/media/readback. Прежняя LIVE
остаётся открытой для обычных записей; следующая попытка захватит позднюю запись.

Atomic automatic.json хранит destination, sequence, entries≤3, pending и retired.
Полный план pending записывается до native publication. Поля содержат UUID/hash/
размеры/даты, не импортируемые пути. Native ownership receipt позволяет повторно
получить тот же URI после неоднозначного результата, в том числе без private source.
После проверенной публикации новый набор и очередь retired сохраняются/readback;
лишь затем можно удалять прежние файлы. Ошибка cleanup оставляет пригодную новую
копию и сохранённую очередь повтора. Неопределённый catalog write перечитывается
новым service, а не компенсируется удалением нового/старого файла наугад.

Sequence задаёт свежесть независимо от wall time. День хранится по локальной дате
фактического успеха и offset, отдельно от snapshot createdAt. Новый файл заменяет
только прежний текущий день; сохраняются предыдущие два дня, если есть. Для
свободных historical slots текущий **технический кандидат** берёт последние
существующие различные старые дни по sequence. Не выдаёт их за вчерашние.
Fallback-политика и time recovery требуют технического закрытия перед release.

При изменении offset или обратном времени публикация/ротация приостанавливаются
до удаления какой-либо истории. Безопасного re-anchor для постоянной поездки/DST
ещё нет; это открытый край, а не доказательство полной timezone acceptance.

При явной смене папки прежний catalog/pending архивируется atomically в private
metadata. Старые файлы не удаляются/не объявляются перенесёнными; новый destination
получает собственный новый managed set. Archived pending IDs защищены от orphan GC.
Private metadata/temporary pending source не выдаются за внешнюю успешную копию;
скрытого backup fallback нет. Лимит три относится к текущему управляемому набору,
сохранённые файлы прежнего места не уничтожаются ради этого лимита.

## Native ownership

AutomaticPublications.kt — платформенное дополнение существующего local Expo module,
без зависимости или storage-wide permission. Автофайлы имеют отдельный auto prefix.
Private receipt содержит точный URI/день snapshot/hash/bytes/destination. В Downloads
receipt сохраняется до снятия IS_PENDING; повтор завершает видимость существующего
файла. Manual и неизвестный URI не получают права удаления через один только UUID.
Проверяются native receipt, имя, размер/SHA и MediaStore owner package либо точный
persisted SAF tree grant. Removed receipt остаётся tombstone для безопасного replay.

SAF receipt записывается после rename/readback. **Окно process death между rename и
native receipt ещё открыто**: прежний набор не удаляется, возможен неучтённый новый
файл. Provider/partial cleanup acceptance не закрыта. Atomic file rename не является
доказательством directory fsync/power-loss durability Android.

## Фактические проверки

- Целевые host sets: automatic15/15, scheduler4/4, manual12/12, restore15/15.
  Запущено 45/45 до последнего bounded-clock case, затем отдельно scheduler4/4.
  Полный foundation не перезапускался. Fault/recreation проверки не выдаются за SIGKILL.
- Root/mobile/spike typecheck, lint/arch503/source/secrets/diff; Kotlin compile и
  arm64 debug APK собраны. Проверена package identity, обновлён только отдельный
  com.fitcoach.r07sqlite. SHA APK зафиксирован в отчёте. 2.0 build128 не изменена.
- Android **21/21**, весь synthetic сценарий71393ms: online согласованный snapshot
  при поздней business write, same-day replacement, unchanged skip, три настоящих
  разных дня через injected clock, native verification/ownership negatives,
  idempotent receipt без source, tombstone, точный manual export после ротации,
  staging всех клиентов и точного PNG после потери исходника, 15 holders доступны.
- После isolated status change — отдельные **3/3 за448ms** на той же fixture без
  новой публикации: persistence, recreation visibility, clear после verified retry.
- Android JS/Hermes bundle **5622modules/1185assets**.

[Фактические результаты и границы](R06_AUTOMATIC_ANDROID_REPORT.json).

Следующий обязательный край: сейчас отсутствующий старый файл считается verification
failure. Нужно отличать доказанно удалённую копию от отзыва grant/ошибки provider,
сохранять остальные пригодные версии и воссоздавать удалённую штатную папку.
Также OPEN: real kill/SAF/ENOSPC/provider matrix, enabled UI/AppState E2E, native OS
rest signals, first-run choice, full populated histories и полный legacy mapping/
staging/IDs/provenance/parity/retry. Excel после backup/restore, UI/темы позже.
