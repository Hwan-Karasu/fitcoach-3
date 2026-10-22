# R07 — Expo Android SQLite spike

Стенд также запускает R06 native backup/guarded restore через
`EXPO_PUBLIC_R06_BACKUP=1`; default R07 режим сохранён. Настройки,
process-kill сценарий и фактическое устройство:
[R06 native storage](../../docs/spikes/R06_NATIVE_STORAGE.md).

Изолированный TypeScript-прототип проверки `expo-sqlite`. Android package
`com.fitcoach.r07sqlite` не совпадает с release-приложением.

## Проверки

- `foreign_keys=ON` и WAL;
- commit/rollback `withExclusiveTransactionAsync`;
- вложенный use-case в одной транзакции, две сериализованные записи и ревизии после commit;
- второе соединение, WAL checkpoint и точечная инвалидация read model;
- `foreign_key_check`, `integrity_check`, индексный `EXPLAIN QUERY PLAN`.

Запуск на Android после установки зависимостей:

```powershell
npm ci
npm run mobile
npm run typecheck
npm run doctor
```

`npm run mobile` требует одно online ADB-устройство с Expo Go и сам настраивает
USB reverse/localhost. `npm run android` остаётся отдельной командой для custom
debug APK; он пока не собран из-за недоступного Gradle distribution.

Отчёт появляется на экране и не содержит пользовательских данных. Прототип
использует только собственную тестовую базу `fitcoach_r07_spike.db`.

Для Metro/native build нужен Node >=22.13 или >=24.3; установленный в среде
Node 22.12 ниже требования React Native. Android bundle успешно проверен через
временный `node@24.3.0`, без смены системного Node. TypeScript 6.0.3 выбран
для прототипа по результату закреплённого `expo-doctor@1.20.4` (21/21).

Временная связка Expo 57/RN 0.86/React 19.2/TS 6.0 — кандидат из Stage 3, а
не утверждённый стек `F01`. Доказательства и открытые gates:
[`docs/spikes/R07_SQLITE_STATUS.md`](../../docs/spikes/R07_SQLITE_STATUS.md).
На Android 16 в Expo Go 57.0.9 получено `allPassed=true` (14/14); см.
[device report](../../docs/spikes/R07_DEVICE_REPORT.md). Custom APK и
F01 Debug/Release smoke этим не проверены.
