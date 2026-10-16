# S00 — source baseline FitCoach 3.0

## Актуальная редакция после S02

**Дата:** 2026-10-15. Единственный источник истины остаётся в
`E:\ProjectFitCoach\FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`.
После разрешённой владельцем коррекции Stage 2/3/4 и R08 текущий
`MANIFEST_SHA256.json` имеет SHA-256
`b1d3a6e0cef468ef40919287e12f7dffc869f9a6d2961e6274f7acb26c09045f`
и содержит 73 файла. История правки сохранена в `00-S02_REVISION_LOG.md` внутри
пакета. Product Contract не менялся: SHA-256
`4b95fb2fe457571af9b353bda727b1a0e331eb0048ca69a2228756d800ad9442`.
Автоматические проверки прошли; ручная семантическая ревизия всех 20
feature-спецификаций и UI/Android gates остаются открытыми.

## Исходный снимок S00 (исторический)

**Дата фиксации:** 2026-10-14  
**Статус:** `READY_FOR_REVIEW`; это документационная фиксация, не runtime или
Android verification.

## Источник истины

Единственный актуальный пакет:
`E:\ProjectFitCoach\FitCoach_3_DOCUMENTS_SYNCED_2026-10-14`.

SHA-256 `MANIFEST_SHA256.json` на 2026-10-14:
`7df7a30b03398c8ee7ccf0540f452494a4cc82f12f585e1e6707fe87b647e73c`.

Тот manifest содержал 72 файла. Сам manifest ожидаемо не включает собственный hash.

## Основные нормативные документы исходного снимка

| Уровень | Путь внутри пакета | SHA-256 | Статус |
|---:|---|---|---|
| 1 | `00-SOURCE_OF_TRUTH.md` | `55739883e75f2d88b6a08d40e1cc859ec64ba18baa21eea3d599ab77eb282d5c` | Иерархия и границы |
| 2 | `01-Product-Contract/PRODUCT_CONTRACT_SYNCED.md` | `4b95fb2fe457571af9b353bda727b1a0e331eb0048ca69a2228756d800ad9442` | Норматив поведения; §§53–56 приоритетны |
| 3 | `02-Architecture/ARCHITECTURE_DESIGN_SYNCED.md` | `ae36f9129856805e666e2d5282fa2d7e771c8aec7f948ecea2a44b873bea2dff` | Architecture baseline; gates открыты |
| 4 | `03-Data-Technical/DATA_TECHNICAL_DESIGN_SYNCED.md` | `f2e465b2c63b4ebb523ba05d5fdc10e915d4abc9b49d734d90394d935391f769` | Technical baseline; schema reference-only |
| 5 | `04-Feature-Specifications/FEATURE_SPECIFICATIONS_SYNCED.md` | `366a6152abb4c890a5140f31645e41fe25e338210c8f789aded4f3ded4d414fa` | 20 технических feature contracts |
| 6 | `05-UI-UX/UI_UX_DESIGN_SYNCED.md` | `c4b2cc5a55c9a36e3e338e1b9818fd70ff6899cdd3a32ebd58a998b74e08e8aa` | Foundations complete |
| 7 | `05-UI-UX/SCREEN_ATLAS_SPECIFICATIONS_SYNCED.md` | `1c676ad465cdd914cc51aa75a47b6226fba9a1bab94fd9f1313d1740d3f0b53a` | `PROPOSED`, требует screen gates |
| 8 | `06-Implementation/IMPLEMENTATION_PLAN_SYNCED.md` | `216b386f72d88f34b93fe4e006a9985953b405e0cac86d617cb504333437f5e6` | План подготовлен, execution не доказан |

Дополнительные machine-readable inputs:

| Путь | SHA-256 |
|---|---|
| `05-UI-UX/theme-catalog.v1.json` | `68c836d685b0dec264c9acbb1492f96cba9906903de1f77854acccd4db977af8` |
| `05-UI-UX/screen-registry.json` | `cf43ea6c8170a0ff8571f9edd9a70f2de3eb33b09e51aa930d8464105471ba22` |
| `06-Implementation/TASK_BACKLOG.json` | `1696bb5b99ec256d3e761e61b6ab4728b14eb53053db6a6ec3dcd2155480e516` |

## Устаревший UI/reference source

- Remote: `https://github.com/Hwan-Karasu/fitcoach.git`.
- Ветка: `stable/v2.0.0-build120`.
- Commit ветки на момент проверки: `e116b42e95f70a5a5e563420ab25394944c59ffd`.
- Тег `v2.0.0-build120` указывает на тот же commit.
- Remote `main` был зафиксирован отдельно как
  `a5fbc2430247cce9841f799c44080d497f8ce6e2` и baseline не является.

Этот GitHub-код не находится внутри нового проекта и не является источником
требований или target architecture.

## Открытые gates

- Совместимость подписи установленного APK build120 и candidate release.
- Обнаружение и однозначный mapping реальных legacy SQLite.
- Production DDL и migration/cutover с crash/kill/retry.
- Backup/restore после uninstall и Android SAF.
- Exact dependency lock и Android debug/release smoke.
- Утверждение экранов, golden screenshots, TalkBack, keyboard и performance.

