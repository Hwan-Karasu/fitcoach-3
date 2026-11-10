import assert from "node:assert/strict";
import test from "node:test";
import { historyCaption, questionnaireCaption } from "../src/read-models/moreCaptions.ts";

const done = (actualDate: string | null) => ({ status: "COMPLETED", actualDate });

test("UIX-10: подпись анкеты — процент, «Не заполнена» для нуля, пока данных нет — без подписи", () => {
  assert.equal(questionnaireCaption(80), "Заполнена на 80 %");
  assert.equal(questionnaireCaption(100), "Заполнена на 100 %");
  assert.equal(questionnaireCaption(0), "Не заполнена");
  assert.equal(questionnaireCaption(null), null);
});

test("UIX-10: подпись истории — завершённые занятия и дата последнего, склонение, пустая история", () => {
  assert.equal(historyCaption([]), "Занятий пока нет");
  assert.equal(historyCaption([{ status: "MISSED", actualDate: "2026-11-01" }, { status: "IN_PROGRESS", actualDate: null }]), "Занятий пока нет", "пропущенные и в работе не считаются проведёнными");
  assert.equal(historyCaption([done("2026-11-07")]), "1 занятие, последнее 7 нояб.");
  assert.equal(historyCaption([done("2026-10-31"), done("2026-11-07"), done("2026-11-03")]), "3 занятия, последнее 7 нояб.", "последнее — по дате, а не по порядку записей");
  const many = Array.from({ length: 43 }, (_, index) => done(`2026-09-${String((index % 28) + 1).padStart(2, "0")}`));
  assert.equal(historyCaption(many), "43 занятия, последнее 28 сент.");
  assert.equal(historyCaption(Array.from({ length: 5 }, () => done("2026-12-01"))), "5 занятий, последнее 1 дек.");
  assert.equal(historyCaption([done(null)]), "1 занятие", "дата неизвестна — только число");
});
