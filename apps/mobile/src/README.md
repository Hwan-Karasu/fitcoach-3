# Production layout (S02)

Это production-дерево запускаемого Expo/TypeScript-проекта. Пока его runtime
содержит только диагностический экран F01, не готовые продуктовые экраны. Дерево
повторяет концепцию Architecture Design §10 и владельцев данных из §4. Код из
`spikes/` сюда пока не переносится: native smoke — gate F01, production SQLite
DDL — gate D01, экраны — отдельное UI-утверждение.

```text
app/                  bootstrap, navigation, composition root
features/             владельцы бизнес-данных и их публичные API
workflows/            атомарные операции нескольких владельцев
read-models/          производные межмодульные запросы без записи фактов
shared/               общие технические механизмы без бизнес-правил
```

Правило зависимостей: экран → публичный API своей/чужой фичи → domain и порты
→ data/platform adapter. Соседняя фича доступна только через её `public.ts`.
UI не импортирует SQLite, а feature не импортирует `data`, `screens` или
`internal` соседней feature. `workflows/` координирует кросс-модульные команды
в одной транзакции; `read-models/` только читает и не владеет фактами.

Внутри фичи `domain/`, `application/`, `data/`, `presentation/` появятся по
реальной сложности; пустые слои и 20 отдельных npm-пакетов не требуются.
