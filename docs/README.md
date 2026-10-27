# Документы FitCoach 3.0

| Документ | Назначение |
|---|---|
| `docs/SOURCE_BASELINE.md` | Task S00: источник, hashes, статусы и открытые gates |
| `docs/LEGACY_CROSSWALK.md` | Task S01: что из build120 является только reference и что запрещено переносить |
| `docs/STAGE_SYNC_AUDIT.md` | Task S02: исправления Stage 3/4 и R08 по §§53–56; ручная ревизия ещё открыта |
| `docs/S02_FEATURE_REVIEW.md` | Task S02: тематическая проверка 20 feature-spec по Product §§53–56 и граница статуса |
| `docs/ui/README.md` | Task S03: правила и результаты карты утверждения 43 UI-сценариев |
| `docs/LEGACY_REFERENCE.md` | Task S04: внешний read-only build120 reference и fixture policy |
| `docs/spikes/R07_SQLITE_STATUS.md` | Task R07: TypeScript SQLite spike, полученные проверки и открытый Android gate |
| `docs/spikes/R01_ANDROID_IDENTITY.md` | Task R01: package/signing/versionCode установленного APK и открытое сравнение с кандидатом |
| `docs/spikes/R02_LEGACY_BACKUP_INVENTORY.md` | Task R02: read-only inventory переданного SQLite `.atbackup`, без PII и без cutover |
| `docs/spikes/R03_SYNTHETIC_MIGRATION_FIXTURES.md` | Task R03: synthetic SQLite fixtures, counts/hashes и открытые migration gates |
| `docs/spikes/R08_NAVIGATION_STATUS.md` | Task R08: TypeScript React Navigation spike, Expo Go device evidence и открытый custom APK gate |
| `docs/adr/F01_STACK_CANDIDATE.md` | Task F01: запускаемый mobile TypeScript candidate, проверенные версии и открытые native/security gates |
| `docs/adr/F02_CHECKS_CANDIDATE.md` | Task F02: частичные автоматические проверки и ещё не закрытые CI/native/security gates |
| `docs/adr/F03_BOOT_CANDIDATE.md` | Task F03: чистая boot state machine, её тесты и открытая интеграция SQLite/UI |
| `docs/adr/F06_READ_MODELS_CANDIDATE.md` | Task F06: scoped subscriptions, post-commit invalidation и открытые production/Android gates |
| `docs/adr/F07_THEME_CANDIDATE.md` | Task F07: runtime-снимок 9×3 палитр, типизированный resolver, частичные тесты и открытый UI/Android gate |
| `docs/CODE_AUDIT_2026-10-27.md` | Технический аудит всего приложения: реестр CA-01…CA-24, очистка, зависимости, ограничения |
| `docs/IMPORT_ENGINE_V2.md` | Новый движок импорта и экспорта Excel: решения владельца, конвейер, срезы S1–S5, риски |
| `docs/PROJECT_STATUS.md` | Текущее состояние нового репозитория и следующий task |

Нормативные документы не дублируются в этом репозитории. Единственная актуальная
копия находится в `../FitCoach_3_DOCUMENTS_SYNCED_2026-10-14` и проверяется через
`npm run source:verify`.

