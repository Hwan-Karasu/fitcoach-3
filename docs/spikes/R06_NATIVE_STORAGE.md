# R06 — нативное хранение и восстановление на Android

2026-10-22. **DEVICE PROOF FOR NATIVE PROTOCOL; R06/D05 STILL OPEN.**

Task R06, входы: D01 production catalog/identity, SharedSqliteDatabase maintenance,
GuardedRestore; Product §46, Feature Spec 18 BU-01/03/06. Production DDL и
реальная миграция/overlay не выполняются. Стенд использует только свежие
синтетические файлы в собственном `r06-native/run-*` Expo Go project directory.

## Реализация

`ExpoRestoreStorage` реализует прежний порт GuardedRestore. Типы порта вынесены
в domain, чтобы data/application не импортировали друг друга. Caller задаёт
фиксированные private slots и maintenance gate; никаких путей из внешнего
manifest/guard. SQLite sidecars блокируют файловую замену. Нормальный UI не
вызывает этот adapter: пока его запускает только отдельный spike.

SHA-256 читает файл блоками 256 КиБ, каждые 4 МиБ отдаёт управление event loop,
проверяет длину/EOF и закрывает handle при сбое. Используется закреплённый
`@noble/hashes@2.4.0`, [partial updates по документации автора](https://github.com/paulmillr/noble-hashes#implementations).
Пятнадцать portable tests сравнивают результат с node:crypto, включая пустой
файл/границы блока/5 МиБ, short/growing/throwing reads и close failure.

Из установленного Expo source подтверждено:

- expo-sqlite открывает через sqlite3_open, без SQLITE_OPEN_READONLY option.
  Валидатор открывает только private slot после header/sidecar проверки,
  включает query_only и запрещает run в reader port. Внешний файл сначала
  должен копироваться в private staging; открывать его напрямую нельзя.
- Новый File.copy возвращает Promise. Первое устройство выявило преждевременную
  проверку SAFETY без await; adapter исправлен, после этого normal run проходит.
- Android legacy moveAsync для file URI использует File.renameTo, при отказе
  бросает ошибку без copy/delete fallback. Это используется для private rename
  и записи guard через complete .next→guard. Проверка подтверждает process death,
  не гарантирует directory fsync/выключение питания.

## Устройство и доказательство

Android API 36, Expo Go 57.0.9 (445). На телефоне по-прежнему установлен
com.fitcoach.app 2.0.0 (128); его БД не открывалась. Read-only metadata и
контролируемые операции относятся к стенду host.exp.exponent.

Результаты из Metro/ReactNativeJS сохранены в [R06_NATIVE_REPORT.json](R06_NATIVE_REPORT.json):

- normal: **9/9**, native SQLite backup API сохраняет source; guarded replace
  хранит SAFETY/PREVIOUS, repository reopen читает snapshot client без merge;
  receipt replay сохраняет последующие записи;
- kill/recover: после `R06_INTERRUPT_READY AFTER_FILE_SWITCH_BEFORE_COMMIT`
  ADB останавливает Expo Go; отсутствие PID подтверждено. Новый процесс выполняет
  recovery **до** открытия repository: **7/7**, точные старые байты, SAFETY,
  отвергнутый кандидат, прежний клиент, отсутствие merge и idempotent recovery.

Это синтетическая схема всех D01 owners с заполненной client identity, не
доказательство полноты всех доменных историй. Время 24665/11747 мс — время
всего spike run, не release performance SLA.

## Повторение

Специальная Metro configuration позволяет spike импортировать настоящий adapter
из mobile source и сохраняет единственные React/Expo instances. Default R07
режим остаётся доступен; R06 включает env:

```powershell
$env:EXPO_PUBLIC_R06_BACKUP = '1'
# NORMAL (unset), INTERRUPT или RECOVER; режим меняют до старта нового Metro.
$env:EXPO_PUBLIC_R06_PHASE = 'NORMAL'
node node_modules/expo/bin/cli start --offline --port 8096
```

Нужен поддерживаемый Node, в среде использован локальный 24.3.0. Для устройства
настроить ADB reverse tcp:8096 и открыть exp://127.0.0.1:8096 в Expo Go.
INTERRUPT ждёт принудительной остановки после swap; RECOVER потребляет private
pointer только своего синтетического job. Не запускать новый INTERRUPT поверх
незавершённого job. Стенд не удаляет чужие/предыдущие job directories.

Открыты native SQLite `.atbackup` metadata/media/parity, SAF/MediaStore, full-owner
device roundtrip, low-storage/power-loss, normal app boot/scheduler/read-model
integration, automatic rotation/Return и реальный 2.0 upgrade/signing.
