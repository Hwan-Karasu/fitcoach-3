# S04 — внешний build120 reference

**Проверено:** 2026-10-15 через remote refs, без локального клона.  
**Статус:** baseline identity подтверждена; реальные redacted fixtures не
предоставлены и остаются отдельным входом для `R02`.

## Идентичность

| Ref | Commit |
|---|---|
| `refs/heads/stable/v2.0.0-build120` | `e116b42e95f70a5a5e563420ab25394944c59ffd` |
| peeled `refs/tags/v2.0.0-build120^{}` | `e116b42e95f70a5a5e563420ab25394944c59ffd` |
| tag object `refs/tags/v2.0.0-build120` | `3e9c0c996faaf0c079996ff94f62d341491951b1` |
| `refs/heads/main` | `a5fbc2430247cce9841f799c44080d497f8ce6e2` |

Remote: `https://github.com/Hwan-Karasu/fitcoach.git`.

## Изоляция

- Новый проект — самостоятельный Git repository; его рабочая ветка называется
  `rewrite/fitcoach-3.0`.
- Legacy remote намеренно не добавляется как `origin`, чтобы исключить случайный
  push или изменение `stable/main`.
- Build120 разрешено читать точечно по commit для UI/data migration evidence.
  Его architecture, auth, backend, sync и client-role код не являются target.
- Ни один файл build120 не скопирован в новый source tree.

## Fixture policy

Личный `.atbackup` предоставлен 2026-10-15 и инвентаризирован в R02 только
на временной копии. Это **не** обезличенная test fixture; APK и отдельные
account-scoped SQLite не предоставлены. До помещения материалов в test fixtures
обязательны:

1. Работать только с копией, не с единственным пользовательским экземпляром.
2. Удалить ФИО, контакты, заметки, медицинские сведения и иные PII либо заменить
   синтетическими значениями с сохранением структуры и связей.
3. Не включать JKS/PEM, passwords, `keystore.properties` и access tokens.
4. Составить manifest: source kind, schema/user_version, размер, SHA-256,
   ожидаемые counts и подтверждение redaction.
5. При нескольких account DB или неоднозначном owner/workspace — `SAFE STOP`.

`.gitignore` запрещает случайное добавление DB, backups, APK и signing files.
Redacted fixtures допускаются только по явному allowlist-решению в задаче `R02`.

## Что ещё не доказано

- Сертификат реально установленного APK не сравнивался с candidate signing.
- Overlay поверх build120 не выполнялся.
- Legacy DB paths/account mapping не инвентаризированы.
- Обезличенные backup fixtures и полный набор account DB отсутствуют, поэтому
  полная acceptance `S04/R02` ещё не подтверждена фактическими данными.

