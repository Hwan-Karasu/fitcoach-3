# R08 — React Navigation lifecycle spike

**Статус 2026-10-15: EXPO GO DEVICE EVIDENCE / READY_FOR_REVIEW; custom APK и
видео OPEN.** Изолированный TypeScript spike: [исходники](../../spikes/navigation/README.md).
`R08` в нормативном backlog остаётся `PLANNED`: эти результаты не закрывают
полную приёмку автоматически.

## Входы и границы

- Зависимость `S04`: build120 reference зафиксирован read-only; пользовательские
  базы/backup не использовались. `ui_gate=none` для самого spike.
- Product §§2,53, Architecture ADR-A08, Technical Stage 3 §03. Реализация
  проверяет структуру маршрутов, не внешний вид или бизнес-экраны.
- Android 16, RMX3706, Expo Go 57.0.9; React Native 0.86.3, Expo 57.
  Custom APK не собран, signing/overlay и release не проверялись.

## Проверено

| Проверка | Фактический результат |
|---|---|
| TypeScript strict | PASS, `npm run typecheck` |
| SafeRoute unit tests | PASS, 5/5; stale ID, запрет `Settings` как tab, шесть client sections, More и active route projection |
| Expo Doctor | PASS, 21/21 |
| Android bundle | PASS, 1032 modules, локальный Node 24.3.0 |
| Trainer/Client tabs | На устройстве 3 root tabs; внутри клиента 4 controls; `Статистика` из «Ещё» сохранила `client-a` |
| Data revision | Calendar: `dataRevision 0 → 1`, `mountId bh19u1f` и safe route Calendar не изменились |
| Cold start | `bootCount 1 → 2`, новый mount ID, `client-a/Statistics` восстановлен из allowlisted snapshot |
| Android Back | Statistics → More → Home → root Clients; отдельные stack transitions без remount от data revision |
| Stale client | Fixture с `deleted-client` после cold start: `bootCount 3`, safe route `root/Clients`, приложение открылось |
| Settings/Bell routes | Через диагностические кнопки открылись `settings` и `notifications`, оба вне root tabs |
| Warm resume | Home → Expo Go: `bootCount 4`, `mountId h9l8bff`, `notifications` остались неизменными |

В отчёте UI дерева Android были видны значения `R08 Report` для каждого
сценария. Логика сохраняет только `{kind,tab}` или
`{kind,clientId,section}`; произвольные params и черновик редактора не
попадают в persisted snapshot. `More` сам по себе не седьмой раздел:
при открытии меню snapshot остаётся на предыдущем смысловом разделе.

## Открытые проверки

- Custom Debug/Release APK на устройстве, включая React Native Screens Android
  fragment restoration/configuration и точный Back после OS process death.
- Непрерывная видеозапись приёмочных переходов и повторение на custom APK.
- UI visual gate, TalkBack, keyboard/safe-area и производительность конкретных
  экранов: этот spike не является дизайн-эталоном.
- Реальный восстановленный ID клиента/программы должен валидироваться по
  production owner и workspace, а не по синтетическому `Set`.
- При холодном запуске Expo Go иногда сначала выводил свою LauncherActivity;
  повторный intent открывал ExperienceActivity. Это наблюдение хоста Expo Go,
  не доказательство такого же поведения будущего APK.

React Navigation [рекомендует осторожно обращаться с persisted state](https://reactnavigation.org/docs/state-persistence/):
в spike не сохраняется весь внутренний navigator state, а только собственный
разрешённый маршрут. [Установка native stack](https://reactnavigation.org/docs/native-stack-navigator/)
и [Android screens configuration](https://reactnavigation.org/docs/getting-started/)
должны быть повторно проверены при сборке собственного APK.
