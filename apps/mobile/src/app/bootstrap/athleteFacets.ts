/** Traced on source-foreground.png in normalized image coordinates (including transparent margins).
 * These faces mask the original metal texture; the launcher frame is never used. */
export interface AthleteFacet {
  readonly id: string;
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly order: number;
  readonly reflection: number;
  readonly gradient: "rising" | "falling";
}

const leftFaces: readonly AthleteFacet[] = [
  { id: "wrist-top", path: "M15.6 12.5L27 8.3L21.5 15Z", x: 23, y: 12, order: 0.1, reflection: 0.72, gradient: "rising" },
  { id: "wrist-inner", path: "M27 8.3L33.8 16.8L21.5 15Z", x: 28, y: 14, order: 0.16, reflection: 0.48, gradient: "falling" },
  { id: "forearm-outer", path: "M15.6 12.5L21.5 15L2.4 33Z", x: 13, y: 24, order: 0.24, reflection: 0.5, gradient: "rising" },
  { id: "forearm-inner", path: "M2.4 33L19.1 20.4L12.6 35.2L6.3 42.2Z", x: 10, y: 34, order: 0.3, reflection: 0.85, gradient: "falling" },
  { id: "bicep-top", path: "M19.1 32.2L27.8 35.2L29.8 42.3L10 40.2Z", x: 21, y: 37, order: 0.38, reflection: 0.6, gradient: "rising" },
  { id: "bicep-bottom", path: "M10 40.8L29.6 42.8L22.3 50L6.6 42.8Z", x: 18, y: 45, order: 0.42, reflection: 0.3, gradient: "falling" },
  { id: "shoulder", path: "M22 31.8L29 29L36.2 32.8L29.2 33.8Z", x: 29, y: 32, order: 0.32, reflection: 0.72, gradient: "rising" },
  { id: "collar", path: "M43.5 28L47 36.7L39 31.1Z", x: 43, y: 32, order: 0.2, reflection: 0.55, gradient: "falling" },
  { id: "chest", path: "M29.3 33.8L36.2 32.9L45.4 37L49 46.8L49 56.3Z", x: 40, y: 44, order: 0.5, reflection: 0.82, gradient: "rising" },
  { id: "ribs", path: "M28 48.5L31.6 45.2L36.2 61.1L30 56.8Z", x: 33, y: 54, order: 0.65, reflection: 0.32, gradient: "falling" },
  { id: "abs-top", path: "M36.2 51.3L48.8 58.5L49 65.7L38.5 59.4Z", x: 43, y: 59, order: 0.65, reflection: 0.5, gradient: "rising" },
  { id: "abs-middle", path: "M38.9 61.8L48.8 68.4L49 74.7L40.9 69.3Z", x: 44, y: 69, order: 0.82, reflection: 0.4, gradient: "falling" },
  { id: "waist", path: "M39 69L48.9 91L35.9 77.2Z", x: 42, y: 80, order: 0.9, reflection: 0.25, gradient: "rising" },
  { id: "abs-bottom", path: "M42.8 73L49 77.6L49.3 89.5Z", x: 47, y: 81, order: 1, reflection: 0.35, gradient: "falling" },
];

// Mirror coordinates, preserving bilateral geometry and changing the reflection angle.
const rightFaces = leftFaces.map((face): AthleteFacet => ({ ...face, id: `right-${face.id}`,
  path: face.path.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/gu, (_, x: string, y: string) => `${100 - Number(x)} ${y}`),
  x: 100 - face.x, order: Math.min(1, face.order + 0.06),
  reflection: face.reflection * 0.9, gradient: face.gradient === "rising" ? "falling" : "rising",
}));

export const ATHLETE_FACETS: readonly AthleteFacet[] = [
  { id: "head-left-top", path: "M50 6.1L42 12.6L50 21.2Z", x: 47, y: 13, order: 0, reflection: 0.35, gradient: "falling" },
  { id: "head-right-top", path: "M50 6.1L50 21.2L58 12.6Z", x: 53, y: 13, order: 0.04, reflection: 0.65, gradient: "rising" },
  { id: "head-left-bottom", path: "M42 12.6L42.5 21.5L50 30.5L50 21.2Z", x: 47, y: 22, order: 0.08, reflection: 0.25, gradient: "rising" },
  { id: "head-right-bottom", path: "M58 12.6L50 21.2L50 30.5L57.5 21.5Z", x: 53, y: 22, order: 0.1, reflection: 0.45, gradient: "falling" },
  ...leftFaces, ...rightFaces,
];
