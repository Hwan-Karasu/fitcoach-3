# R07 — отчёт с Android-устройства

**Дата:** 2026-10-15. **Источник:** тестовый экран изолированного
`spikes/sqlite`, открытый в Expo Go через USB `adb reverse` и Metro на
`127.0.0.1:8081`. Личный серийный номер устройства не сохраняется.

| Поле | Значение |
|---|---|
| Android / модель | 16 / RMX3706 |
| Expo Go | 57.0.9 |
| SQLite | 3.50.3 |
| Run ID | `1792044481677-k4dsmcjl62q` (синтетический) |
| Результат | `allPassed=true`, 14/14 checks |

Проверки со значением `passed=true`: `foreign_keys`, `wal`,
`exclusive_commit`, `rollback`, `nested_use_case`,
`rollback_keeps_read_model`, `serialized_writes`, `post_commit_revision`,
`targeted_read_model`, `two_connections`, `wal_checkpoint`,
`foreign_key_check`, `integrity_check`, `indexed_query`.

Ключевые детали отчёта: `post_commit_revision=1,2`; после rollback исходная
строка осталась `revision=0`, зависимая строка не сохранилась;
`wal_checkpoint={busy:0,log:15,checkpointed:15}`; план запроса:
`SEARCH spike_items USING INDEX spike_items_value_idx (value=?)`.

ADB `uiautomator dump` считал текст JSON с тестового экрана; JSON был
десериализован и отдельно проверен: 14 записей, 14 `passed=true`, ни одного
failed. Данные прототипа синтетические, реальная база FitCoach не открывалась.

Ограничения доказательства: Expo Go, не подписанный custom APK; не проверены
релизная сборка, миграция, backup/restore, длительная нагрузка и process-death
recovery. Это отдельные gates, не покрытые `R07`.
