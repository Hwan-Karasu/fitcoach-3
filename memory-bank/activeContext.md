# Active context — 2026-10-28

«Дневник атлета», FitCoach_3, ветка perf/week-participant-navigation. Русские коммиты, push только по просьбе,
закреплённый Node 24.3 (`node_modules/node/bin/node.exe`; системный Node 22 без `node:sqlite`), строгий TS.
Параллельные правки в дереве: коммитить поимённо, чужое не трогать.

**Решение владельца 2026-10-27 (ADR-043, R04-RETIRE):** прямая миграция 2.0 → 3.0 отменена, перенос — только
тренировки через Excel (и теперь текст заметок). Контракт: docs/INDEPENDENT_V3_AND_EXCEL.md, задачи: docs/TRANSFER_BACKLOG.json.

## Фокус и следующий шаг
Срез 2026-10-28 (ADR-045, ADR-046), коммиты b2066e1…7bb8ccc:
- IMPORT-HINT-SCROLL — подсказка сверки прокручивает к карточке упражнения;
- CYCLE-PRESETS — сила 6–8, мощность 3–5, выносливость 12–15, рекомпозиция 9–12, «Свой» пусто;
- TEXT-LOG — «Вставить из заметок»: текст → распределение (чипы 1…N, «+») → обычная сверка (TextWorkoutLog.ts);
- EXCEL-AI — образец «строка = подход» + промпт для внешнего ИИ, синонимы заголовков;
- BUILDER-FACTS — факты импортированных циклов в карточке конструктора, sourceHash не пересчитывается.

Следующий шаг: проверка владельцем на телефоне (вставка заметок, распределение, прокрутка по подсказке, образец → ИИ →
импорт, правка фактов); решение о `expo-clipboard` для кнопки «Скопировать промпт»; сборка APK.

Открыто рядом: ExerciseCard ещё не собран из ExerciseCardShell (в WorkoutsEditor.tsx чужая правка комментария);
excel:test I07 падает с 77af02e (MIGRATION_HISTORY_MISMATCH).

## Прочее открытое
1. AUD26-01: удаление клиента и таблица training_transfer_receipts (createLocalRepositories.ts, DevClientRepository.ts:193).
2. CA-23: падение импорта больших книг — ждём данные владельца. CA-24: замер inline requires.
3. I01-USER-PARITY: 544 значения исправляет владелец, затем 25 книг и сверка с 2.0.
4. Выпуск: подпись не debug (REL-ANDROID).

Gates: production DDL, подпись, release — OPEN. Не открывать *.atbackup/*.jks/*.pem/keystore.properties;
SmokeA/B/C не удалять. Файл Excel владельца с реальным именем клиента (корень E:\ProjectFitCoach) — не копировать в репозиторий.
Архив: memory-bank/archive/activeContext-before-text-log-2026-10-28.md, …-before-retire-2026-10-27.md.
