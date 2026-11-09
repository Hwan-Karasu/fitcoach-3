import assert from "node:assert/strict";
import test from "node:test";
import { REST_SPACER_BASE, restSpacerHeight } from "../src/shared/ui/components/restSpacerRules.ts";

test("REST-INSET-1 запас под таймером равен реальному перекрытию, а не постоянным 200", () => {
  // Нет таймеров: inset 0 — обычный запас.
  assert.equal(restSpacerHeight(0, 0), REST_SPACER_BASE);
  // Панель вкладок 80 уже лежит под областью прокрутки; панель таймера занимает 80 + 90 = 170 от низа окна: перекрытие 90.
  assert.equal(restSpacerHeight(170, 80), 90);
  // Две карточки рядом выше одной — запас растёт вместе с панелью, но не больше неё.
  assert.equal(restSpacerHeight(210, 80), 130);
  // Свёрнутая «таблетка» 44 над панелью вкладок: перекрытие 44, а не 200.
  assert.equal(restSpacerHeight(124, 80), 44);
  // Панель целиком в пределах нижней области (экран без прокрутки до края): перекрытия нет.
  assert.equal(restSpacerHeight(60, 80), REST_SPACER_BASE);
  // Отрицательное измерение не ломает расчёт.
  assert.equal(restSpacerHeight(90, -5), 90);
});
