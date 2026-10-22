import type { MatrixCell, ProgramMatrix } from "./programMatrix.ts";
import { MATRIX_ZOOM } from "./matrixZoom.ts";

/**
 * Матрица недель как веб-страница (модель 2.0: `ProgramMatrixViewport` + `buildProgramMatrixHtml`): масштаб — CSS `zoom`
 * на слоях шапки и тела, браузер сам перестраивает таблицу на каждом кадре щипка; закреплённые шапка и колонка названий
 * (`position: sticky`) масштабируются вместе с содержимым. Правка ячейки идёт сообщением в приложение, оно пишет через
 * тот же порт, что дневник. Динамические тексты обновляются `patch`, страница при этом не перезагружается.
 */
export interface MatrixHtmlColors {
  readonly canvas: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accentInk: string;
  readonly success: string;
  readonly input: string;
}

/** Цвета колонки недели: окраска типа недели (`null` у «Индивидуальной»). */
export interface MatrixHtmlWeek {
  readonly index: number;
  readonly caption: string | null;
  readonly tone: string | null;
  readonly tint: string;
  readonly headTint: string;
}

export interface MatrixHtmlView {
  readonly zoom: number;
  /** Смещения в единицах масштаба 1. */
  readonly x: number;
  readonly y: number;
}

const LABEL = 92;
const PLAN = 40;
const PREV = 40;
const REPS = 32;
const LOAD = 38;
const CELL = PLAN + PREV + REPS + LOAD;

export const kgText = (grams: number | null) => grams === null ? "" : (grams / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const volumeText = (kg: number | undefined) => kg === undefined ? "—" : `${Math.round(kg).toLocaleString("ru-RU")} кг`;

export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const setKey = (rowKey: string, index: number, week: number) => `s:${rowKey}:${index}:${week}`;

/** Подход, который правится в матрице: и число, и цель записи (без них — только текст). */
function isEditable(set: MatrixCell["sets"][number]): boolean {
  return set.target !== null && (set.hasReps || set.hasLoad);
}

/**
 * Все изменяемые тексты матрицы: ключ элемента → текст. Страница строится один раз по структуре, а при изменении данных
 * получает только эту карту (`patch`).
 */
export function matrixTexts(matrix: ProgramMatrix): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const section of matrix.sections) {
    for (const row of section.rows) {
      const count = Math.max(0, ...[...row.cells.values()].map((cell) => cell.sets.length));
      for (const week of matrix.weeks) {
        const cell = row.cells.get(week.index);
        for (let index = 0; index < count; index += 1) {
          const set = cell?.sets[index];
          if (set === undefined) continue;
          const key = setKey(row.key, index, week.index);
          texts[`${key}:plan`] = set.plan;
          texts[`${key}:prev`] = set.previous ?? "—";
          texts[`${key}:fact`] = set.fact ?? "—";
          texts[`${key}:reps`] = set.reps === null ? "" : String(set.reps);
          texts[`${key}:load`] = kgText(set.loadGrams);
        }
        texts[`v:${row.key}:${week.index}`] = volumeText(cell?.volumeKg);
      }
    }
    for (const week of matrix.weeks) texts[`t:${section.key}:${week.index}`] = volumeText(section.totals.get(week.index));
  }
  for (const week of matrix.weeks) texts[`T:${week.index}`] = volumeText(matrix.totals.get(week.index));
  return texts;
}

/** Ключи структуры: при их смене страницу нужно собрать заново (число недель, строк и подходов, режим правки). */
export function matrixStructureKey(matrix: ProgramMatrix, editable: boolean): string {
  return [editable ? "e" : "r", matrix.weeks.map((week) => week.index).join(","),
    ...matrix.sections.map((section) => `${section.key}[${section.rows.map((row) =>
      `${row.key}:${Math.max(0, ...[...row.cells.values()].map((cell) => cell.sets.length))}:${[...row.cells.entries()].map(([week, cell]) =>
        `${week}${cell.sets.map((set) => (isEditable(set) ? (set.hasReps ? "r" : "") + (set.hasLoad ? "l" : "") : "-")).join("")}`).join(".")}`).join("|")}]`)].join("#");
}

export function buildMatrixHtml(matrix: ProgramMatrix, names: (exerciseId: string) => string, weeks: readonly MatrixHtmlWeek[],
  colors: MatrixHtmlColors, editable: boolean, view: MatrixHtmlView): string {
  const texts = matrixTexts(matrix);
  const text = (key: string) => escapeHtml(texts[key] ?? "");
  const grid = `${LABEL}px repeat(${weeks.length}, ${CELL}px)`;
  const canvas = LABEL + weeks.length * CELL;
  const weekAttr = (week: MatrixHtmlWeek) => `style="--tint:${week.tint};--head:${week.headTint};--tone:${week.tone ?? colors.border}"`;

  const header = weeks.map((week) => `<div class="head" ${weekAttr(week)}>
      <div class="head-title">Неделя ${week.index}</div>
      ${week.caption === null ? "" : `<div class="caption" style="color:${week.tone ?? colors.textSecondary}">${escapeHtml(week.caption)}</div>`}
      <div class="subhead"><span>План</span><span>Пред.</span><span>Повт</span><span>Кг</span></div>
    </div>`).join("");

  const valueCell = (key: string, field: "reps" | "load", canEdit: boolean) => canEdit
    ? `<button type="button" class="val" data-k="${escapeHtml(key)}" data-id="${escapeHtml(key)}" data-field="${field}">${text(key)}</button>`
    : `<div class="sub val-plain" data-k="${escapeHtml(key)}">${text(key) || "—"}</div>`;

  const body = matrix.sections.map((section) => {
    const rows = section.rows.map((row) => {
      const count = Math.max(0, ...[...row.cells.values()].map((cell) => cell.sets.length));
      const sets = Array.from({ length: count }, (_, index) => {
        const label = [...row.cells.values()].map((cell) => cell.sets[index]?.label).find((value) => value !== undefined) ?? "";
        const cells = weeks.map((week) => {
          const set = row.cells.get(week.index)?.sets[index];
          if (set === undefined) return `<div class="wcell dash" ${weekAttr(week)}>—</div>`;
          const key = setKey(row.key, index, week.index);
          const plain = set.target === null || (!set.hasReps && !set.hasLoad);
          const canEdit = editable && set.target !== null;
          return `<div class="wcell sets" ${weekAttr(week)}>
            <div class="sub plan" data-k="${escapeHtml(`${key}:plan`)}">${text(`${key}:plan`)}</div>
            <div class="sub prev" data-k="${escapeHtml(`${key}:prev`)}">${text(`${key}:prev`)}</div>
            ${plain ? `<div class="sub fact${set.done ? " done" : ""}" data-k="${escapeHtml(`${key}:fact`)}">${text(`${key}:fact`)}</div>`
              : `${valueCell(`${key}:reps`, "reps", canEdit && set.hasReps)}${valueCell(`${key}:load`, "load", canEdit && set.hasLoad)}`}
          </div>`;
        }).join("");
        return `<div class="row" style="grid-template-columns:${grid}"><div class="lab set-lab">${label === "Р" ? "Разминка" : `Подход ${escapeHtml(label)}`}</div>${cells}</div>`;
      }).join("");
      const volume = weeks.map((week) => `<div class="wcell vol" ${weekAttr(week)}><span data-k="${escapeHtml(`v:${row.key}:${week.index}`)}">${text(`v:${row.key}:${week.index}`)}</span></div>`).join("");
      return `<div class="row" style="grid-template-columns:${grid}"><div class="lab ex">${escapeHtml(names(row.exerciseId))}</div>${weeks.map((week) => `<div class="wcell" ${weekAttr(week)}></div>`).join("")}</div>
        ${sets}
        <div class="row" style="grid-template-columns:${grid}"><div class="lab muted">Объём</div>${volume}</div>`;
    }).join("");
    const totals = weeks.map((week) => `<div class="wcell vol strong" ${weekAttr(week)}><span data-k="${escapeHtml(`t:${section.key}:${week.index}`)}">${text(`t:${section.key}:${week.index}`)}</span></div>`).join("");
    return `<section><div class="section" style="grid-template-columns:${grid}"><div class="lab section-title">${escapeHtml(section.title)}</div></div>
      ${rows}
      <div class="row" style="grid-template-columns:${grid}"><div class="lab strong">Объём тренировки</div>${totals}</div></section>`;
  }).join("");

  const totalRow = matrix.sections.length === 0 ? `<div class="empty">В этой версии нет упражнений.</div>` : `<div class="row" style="grid-template-columns:${grid}">
    <div class="lab strong">Тоннаж недели</div>${weeks.map((week) => `<div class="wcell vol strong" ${weekAttr(week)}><span data-k="T:${week.index}">${text(`T:${week.index}`)}</span></div>`).join("")}</div>`;

  const config = JSON.stringify({ min: MATRIX_ZOOM.min, max: MATRIX_ZOOM.max, zoom: view.zoom, x: view.x, y: view.y });
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" />
<style>
  :root { --canvas:${colors.canvas}; --surface:${colors.surface}; --border:${colors.border}; --text:${colors.text}; --secondary:${colors.textSecondary};
    --muted:${colors.textMuted}; --ink:${colors.accentInk}; --success:${colors.success}; --input:${colors.input}; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100%; background: var(--canvas); color: var(--text); font: 10px/12px -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
  #viewport { height: 100%; overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; background: var(--canvas); }
  .layer { min-width: ${canvas}px; }
  #header-layer { position: sticky; top: 0; z-index: 40; display: grid; grid-template-columns: ${grid}; background: var(--canvas); border-bottom: 1px solid var(--border); }
  .corner { position: sticky; left: 0; z-index: 50; background: var(--canvas); padding: 3px 4px 2px 0; font-weight: 600; color: var(--muted); }
  .head { border-left: 1px solid var(--border); border-bottom: 2px solid var(--tone); background: var(--head); padding: 3px 0 2px; text-align: center; }
  .head-title { font-weight: 600; }
  .caption { font-size: 9px; line-height: 11px; }
  .subhead, .sets { display: grid; grid-template-columns: ${PLAN}px ${PREV}px ${REPS}px ${LOAD}px; }
  .subhead { margin-top: 2px; font-size: 9px; line-height: 11px; font-weight: 500; color: var(--muted); }
  .row, .section { display: grid; min-width: ${canvas}px; border-bottom: 1px solid var(--border); }
  .lab { position: sticky; left: 0; z-index: 20; background: var(--canvas); padding: 2px 4px 2px 0; font-weight: 500; }
  .ex { font-weight: 600; font-size: 11px; line-height: 13px; padding-top: 4px; }
  .set-lab { font-weight: 400; display: flex; align-items: center; color: var(--secondary); }
  .muted { font-weight: 400; color: var(--secondary); }
  .strong { font-weight: 600; }
  .section { margin-top: 3px; }
  .section-title { grid-column: 1; width: ${LABEL}px; background: var(--surface); border-radius: 4px; padding: 3px 4px; font-weight: 600; font-size: 11px; line-height: 13px; }
  .wcell { width: ${CELL}px; min-height: 18px; border-left: 1px solid var(--border); background: var(--tint); }
  .sets { min-height: 24px; align-items: center; }
  .dash { display: flex; align-items: center; justify-content: center; color: var(--muted); min-height: 24px; }
  .sub { text-align: center; padding: 0 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .plan { color: var(--secondary); }
  .prev { color: var(--muted); }
  .fact { grid-column: span 2; color: var(--text); }
  .fact.done { color: var(--success); }
  .val-plain { font-weight: 500; }
  .val, .inp { width: calc(100% - 2px); margin: 0 1px; height: 20px; min-width: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--input); color: var(--text);
    font: 500 10px/12px -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 0; appearance: none; -webkit-appearance: none; }
  .inp { outline: none; border-color: var(--ink); }
  .vol { display: flex; align-items: center; justify-content: center; color: var(--ink); }
  .vol.strong { color: var(--text); }
  .empty { padding: 12px 0; color: var(--secondary); font-size: 11px; }
  .failed { outline: 2px solid #d34256; }
</style></head>
<body>
<div id="viewport">
  <div id="header-layer" class="layer"><div class="corner">Упражнение</div>${header}</div>
  <div id="body-layer" class="layer">${body}${totalRow}</div>
</div>
<script>window.__CFG = ${config};</script>
<script>${MATRIX_SCRIPT}</script>
</body></html>`;
}

/** Масштаб щипком — как в 2.0: центр пальцев запоминается при касании, прокрутка пересчитывается на каждом кадре. */
const MATRIX_SCRIPT = String.raw`
(function () {
  var cfg = window.__CFG;
  var zoom = cfg.zoom, renderedZoom = zoom, pinch = null, frame = null;
  var viewport = document.getElementById("viewport");
  var layers = [document.getElementById("header-layer"), document.getElementById("body-layer")];
  function post(message) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  function clamp(v) { return Math.min(cfg.max, Math.max(cfg.min, v)); }
  function setZoom(value) { layers.forEach(function (el) { el.style.zoom = String(value); }); renderedZoom = value; }
  setZoom(zoom);
  viewport.scrollLeft = cfg.x * zoom;
  viewport.scrollTop = cfg.y * zoom;

  function metrics(touches) {
    var a = touches[0], b = touches[1];
    return { distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
  }
  function scrollTo(relative) {
    viewport.scrollLeft = Math.max(0, pinch.originX * relative - pinch.vx);
    viewport.scrollTop = Math.max(0, pinch.originY * relative - pinch.vy);
  }
  function apply(next) {
    zoom = next;
    if (frame != null) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      if (!pinch || Math.abs(zoom - renderedZoom) < 0.01) return;
      setZoom(zoom);
      scrollTo(zoom / pinch.base);
    });
  }
  function reportView() { post({ type: "view", zoom: zoom, x: viewport.scrollLeft / zoom, y: viewport.scrollTop / zoom }); }
  viewport.addEventListener("touchstart", function (event) {
    if (event.touches.length !== 2) return;
    var m = metrics(event.touches), box = viewport.getBoundingClientRect();
    var vx = m.cx - box.left, vy = m.cy - box.top;
    pinch = { distance: m.distance, base: zoom, originX: viewport.scrollLeft + vx, originY: viewport.scrollTop + vy, vx: vx, vy: vy };
  }, { passive: true });
  viewport.addEventListener("touchmove", function (event) {
    if (event.touches.length !== 2 || !pinch) return;
    event.preventDefault();
    var ratio = metrics(event.touches).distance / pinch.distance;
    if (Math.abs(ratio - 1) < 0.03) return;
    apply(clamp(pinch.base * ratio));
  }, { passive: false });
  function endPinch() {
    if (!pinch) return;
    if (frame != null) { cancelAnimationFrame(frame); frame = null; }
    setZoom(zoom);
    scrollTo(zoom / pinch.base);
    pinch = null;
    reportView();
  }
  viewport.addEventListener("touchend", endPinch);
  viewport.addEventListener("touchcancel", endPinch);
  var scrollTimer = null;
  viewport.addEventListener("scroll", function () { clearTimeout(scrollTimer); scrollTimer = setTimeout(reportView, 300); });

  var nodes = {};
  Array.prototype.forEach.call(document.querySelectorAll("[data-k]"), function (el) { nodes[el.getAttribute("data-k")] = el; });
  var active = null;
  window.fitcoachMatrix = {
    patch: function (texts) {
      Object.keys(texts).forEach(function (key) {
        var el = nodes[key];
        if (el && !(active && active.key === key) && el.textContent !== texts[key]) el.textContent = texts[key];
      });
    },
    flush: function () { if (active) active.finish(); }
  };

  function valid(field, value) { return field === "reps" ? /^[0-9]{0,3}$/.test(value) : /^[0-9]*([.,][0-9]*)?$/.test(value); }
  document.addEventListener("click", function (event) {
    var button = event.target;
    if (!button || !button.classList || !button.classList.contains("val") || active) return;
    var key = button.getAttribute("data-id"), field = button.getAttribute("data-field");
    var input = document.createElement("input");
    input.className = "inp";
    input.value = button.textContent;
    input.inputMode = field === "load" ? "decimal" : "numeric";
    button.replaceWith(input);
    input.focus();
    input.select();
    var sent = button.textContent, timer = null, done = false;
    function send() {
      clearTimeout(timer);
      var value = input.value.trim();
      if (value === sent || !valid(field, value)) return;
      sent = value;
      post({ type: "edit", id: key, field: field, text: value.replace(",", ".") });
    }
    function finish() {
      if (done) return;
      done = true;
      send();
      button.textContent = valid(field, input.value.trim()) ? input.value.trim() : button.textContent;
      input.replaceWith(button);
      active = null;
    }
    active = { key: key, finish: finish };
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(send, 500); });
    input.addEventListener("blur", finish);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") input.blur(); });
  });
  window.addEventListener("pagehide", function () { if (active) active.finish(); });
})();
`;

/** Куда писать правку из ячейки страницы: идентификатор элемента → неделя, тренировка и цель записи. */
export function matrixEditTargets(matrix: ProgramMatrix): ReadonlyMap<string, Readonly<{ weekIndex: number; workoutId: string;
  target: NonNullable<MatrixCell["sets"][number]["target"]> }>> {
  const targets = new Map<string, { weekIndex: number; workoutId: string; target: NonNullable<MatrixCell["sets"][number]["target"]> }>();
  for (const section of matrix.sections) for (const row of section.rows) for (const [weekIndex, cell] of row.cells) {
    cell.sets.forEach((set, index) => {
      if (set.target === null) return;
      for (const field of ["reps", "load"]) targets.set(`${setKey(row.key, index, weekIndex)}:${field}`, { weekIndex, workoutId: cell.workoutId, target: set.target! });
    });
  }
  return targets;
}
