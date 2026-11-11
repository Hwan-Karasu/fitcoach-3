/**
 * Подписи сторон по роду части тела: левое плечо, левое предплечье, левое бедро, левая голень (а не «лев./прав.» и не «левый»
 * для среднего рода). Прочие группы (шея, плечи, талия…) парные не бывают — запасной вариант мужского рода.
 */
const NEUTER = new Set(["BICEPS", "FOREARM", "THIGH"]);
const FEMININE = new Set(["CALF"]);

/** `["Левое", "Правое"]` и т. п. — с заглавной буквы, для подписей полей. */
export function sideLabels(groupId: string): readonly [string, string] {
  if (NEUTER.has(groupId)) return ["Левое", "Правое"];
  if (FEMININE.has(groupId)) return ["Левая", "Правая"];
  return ["Левый", "Правый"];
}

/** Те же слова строчными — для озвучивания («левое плечо 32, правое плечо 33»). */
export function sideWords(groupId: string): readonly [string, string] {
  const [left, right] = sideLabels(groupId);
  return [left.toLowerCase(), right.toLowerCase()];
}
