# S03 — карта утверждения UI

Источник — Screen Atlas v0.7 и `screen-registry.json` из единственного
нормативного пакета. Генерация:

```powershell
npm run source:ui-matrix
```

Результаты:

- `docs/ui/SCREEN_APPROVAL_MATRIX.json` — полная machine-readable карта;
- `docs/ui/SCREEN_APPROVAL_MATRIX.csv` — плоская таблица для review.

## Статус

- В Atlas подробно перечислены 43 экрана. Все остаются `PROPOSED` до явной
  визуальной приёмки владельцем.
- Для каждого экрана указан `PRODUCT_OWNER`, Product refs, входы/действия,
  состояния и обязательные проверки длинного текста, font scale, keyboard,
  focus, Back, safe area и TalkBack.
- Dark/light Android goldens отсутствуют и честно имеют статус `MISSING`.
- `import` дополнительно требует продуктовой сверки объёма Smart Import.
- Registry содержит ещё пять записей: `calendar-copy-week`,
  `training-conflicts`, `nutrition-serving`, `nutrition-product-new`,
  `nutrition-recipe-editor`. Они вынесены в `supplementalRegistryEntries` и не
  считаются автоматически частью 43 экранов Atlas.

Наличие матрицы закрывает только документальную карту `S03`; оно не закрывает
ни одного per-screen UI gate и не разрешает production UI coding экрана без
golden/approval.

