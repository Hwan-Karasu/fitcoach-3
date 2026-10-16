# R08 — изолированный React Navigation spike

Это **не основной интерфейс FitCoach** и не production architecture. Только
синтетические `client-a`/`client-b`; пользовательские данные не читаются.
Единственный источник требований — соседний пакет
`FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`, Product §§2,53,
Architecture ADR-A08 и Technical Stage 3 §03.

Проверяется реальная связка native stack + три trainer tabs + четыре client
controls. Разделы `Анкета / Архив / Статистика` открываются из «Ещё» как
самостоятельные stack destinations. Settings и Bell — отдельные маршруты.
В SQLite хранится только allowlisted `SafeRoute`, а не внутренний JSON
навигационной библиотеки. Невалидный/удалённый client ID возвращает в
корневые «Клиенты». Синтетический `dataRevision` меняется без смены ключа
`NavigationContainer`.

```powershell
cd spikes/navigation
npm ci
npm run typecheck
npm run test
npm run doctor
cd ../..
npm run mobile:navigation
```

Для Android bundle нужен Node 24.3.0 или совместимая версия; он установлен
локально через devDependency `node`. `mobile:navigation` использует USB/ADB,
порт 8082 и Expo Go. `npm run mobile` в корне по-прежнему открывает R07 SQLite
spike, не этот экран. Нижняя диагностическая панель `R08 Report` показывает
`bootCount`, `mountId`, `dataRevision` и текущий `safeRoute`. Кнопка `Stale
fixture` записывает несуществующий client ID для проверки cold-start fallback;
после её нажатия перезапустить Expo Go без дополнительных переходов.

Expo Go может накрывать правую кнопку глобального меню своей кнопкой Tools.
`Settings test`/`Bell test` в диагностической панели проверяют эти маршруты
без такого перекрытия; расположение реальных кнопок не считается UI-golden.
Проверка custom APK и точных Back/UI сценариев остаётся отдельным gate.
