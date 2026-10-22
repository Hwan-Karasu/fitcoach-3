# R01 — Android package / signing / versionCode

## Повторная read-only проверка 2026-10-22

Через ADB подтверждено наличие двух отдельных пакетов на одном доступном
устройстве (другой ADB transport не был ready; команды направлены явно
на единственный transport со статусом device):

| Пакет | versionName | versionCode | min/target SDK |
|---|---|---|---|
| `com.fitcoach.app` | `2.0.0` | 128 | 24 / 36 |
| `com.fitcoach.v3dev` | `0.0.1` | 1 | 24 / 36 |

Метод: `pm list packages` с фильтром package name и `dumpsys package` каждого
пакета; наружу выводились только package/version/SDK/flags. Базы, файлы клиентов,
секреты и APK не читались и не копировались; install/uninstall/clear-data не
выполнялись. Наличие 2.0 — теперь проверенное package evidence.

**Текущая dev-сборка не может обновить `com.fitcoach.app` как есть:** другой
package и versionCode 1. Это ожидаемая изоляция dev-установки, а не основание
менять её package и рисковать существующими данными. Для отдельного будущего
production-кандидата требуются package `com.fitcoach.app`, versionCode >128,
совместимая подпись и пройденный migration/restore gate. Наличие установленного
`com.fitcoach.v3dev` не является доказательством готовности production-кандидата.

Сертификаты повторно не извлекались. Полный R01/overlay acceptance остаётся
OPEN; сведения о сертификате ниже — evidence от 2026-10-15, не новый замер.

---

**Статус 2026-10-15: PARTIAL EVIDENCE / OVERLAY UNDETERMINED.**
Нормативный backlog `R01` остаётся `PLANNED`: требуемое сравнение с кандидатной
подписью и тест обновления не проведены.

## Входы, зависимости и границы

- Зависимость `S04`: старый `stable/v2.0.0-build120` — только read-only
  reference. На телефоне оказался другой установленный build, поэтому его
  нельзя выдавать за build120.
- Product Contract §4 (DECISION-002), §46.6: утверждена цель in-place update
  без удаления данных; технически нужны тот же `applicationId`, совместимая
  подпись/lineage и увеличенный `versionCode`. Миграция данных — отдельный gate.
- `ui_gate=none`. Проверка была только чтением package metadata и APK;
  не выполнялись install, uninstall, clear-data, запуск миграции или чтение БД.
- Устройство: Android 16, RMX3706, ADB serial `9b0360f1`; второй ADB transport
  `Ucamera001` был offline, поэтому команды направлялись только на serial.

## Подтверждённые значения установленного APK

| Параметр | Значение |
|---|---|
| Package | `com.fitcoach.app` |
| Version | `2.0.0`, `versionCode=128` |
| min / target SDK | 24 / 36 |
| APK SHA-256 | `6658F7B290CC52F848F50A3857F87AE408B24BA3899E565A5A8B63164F4E576A` |
| Signature | APK Signature Scheme v2; один signer |
| Signer DN | `C=US, O=Android, CN=Android Debug` |
| Signer certificate SHA-256 | `05a1a1b022e6f2a7bce4db3fb55d70dbb9ca505117013ebc4f9bfa702099cb43` |
| Public key SHA-256 | `15bc145ee60d373b0c64ff95a2316bec64b949bd9c3578ce8f57ab3f9cd4afe5` |

Получено через `adb -s 9b0360f1 shell pm path/dumpsys package`, временное
`adb pull` установленного `base.apk`, `Get-FileHash SHA256` и Android SDK
`apksigner verify --print-certs --verbose` (build-tools 36.0.0). Хэши
сертификата и публичного ключа не раскрывают приватный ключ. Копия APK не
коммитилась и после измерения удалена из `.cache/r01/`.

## Вывод и gate

Нельзя пока ответить `can overlay`: установленная версия на этом телефоне —
build128, кандидатный APK и его signing certificate отсутствуют. Для обновления
именно этой установки потребуется `versionCode > 128` и совместимая подпись;
условие backlog `>120` само по себе здесь недостаточно. Сертификат upload key
нельзя автоматически считать overlay-совместимым (Product §4).

Для завершения `R01` нужны кандидатный подписанный APK или безопасно доступный
публичный сертификат его signer и тестовая копия фактического build120.
Затем сравнить package/signing lineage/versionCode и провести установку поверх
только на защищённой тестовой установке с проверенной копией данных. Без этого
не выпускать APK с обещанием сохранения существующей установки.
