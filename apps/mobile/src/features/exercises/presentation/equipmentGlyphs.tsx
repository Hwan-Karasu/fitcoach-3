import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect, SvgXml } from "react-native-svg";
import { approvedEquipmentGlyphs } from "./approvedEquipmentGlyphs.generated.ts";

/**
 * Значки оборудования (UI-OWN-031). Основа — открытые наборы IconOven (© Appic Marketing, iconoven.com) и
 * Huge Icons (© Hugeicons), оба MIT, получены через Iconify; сгенерировано скриптом, правка — заменой SVG.
 * Чего в наборах нет (брусья, TRX, тумба, ролик, гребной, велотренажёр, сани, слэмбол), — свои значки в том же
 * стиле: сетка 24, линия 1,5, скруглённые концы. Узкие тренажёры — общий значок «тренажёр».
 *
 * MIT: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files, to deal in the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */
const library: Readonly<Record<string, string>> = {
  barbell: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><rect width=\"2\" height=\"7\" x=\"3.5\" y=\"8.5\" rx=\".75\"/><rect width=\"2.25\" height=\"12\" x=\"5.5\" y=\"6\" rx=\"1\"/><rect width=\"2.25\" height=\"12\" x=\"16.25\" y=\"6\" rx=\"1\"/><rect width=\"2\" height=\"7\" x=\"18.5\" y=\"8.5\" rx=\".75\"/><path d=\"M2.75 12h.75m4.25 0h8.5m4.25 0h.75\"/></g>",
  dumbbell: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><rect width=\"4\" height=\"13.5\" x=\"4.75\" y=\"5.25\" rx=\"1.5\"/><rect width=\"4\" height=\"13.5\" x=\"15.25\" y=\"5.25\" rx=\"1.5\"/><path d=\"M2.75 12h2m14.5 0h2m-12.5 0h6.5\"/></g>",
  ez_bar: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M10.529 8h2.942c.56 0 1.147.002 1.397.617c.176.433.176 1.333 0 1.766c-.25.615-.837.617-1.397.617H10.53c-.56 0-1.147-.002-1.397-.617c-.176-.433-.176-1.333 0-1.766C9.383 8.002 9.97 8 10.53 8m-.001 3h2.942c.56 0 1.147.002 1.397.617c.176.433.176 1.333 0 1.766c-.25.615-.837.617-1.397.617H10.53c-.56 0-1.147-.002-1.397-.617c-.176-.433-.176-1.333 0-1.766c.25-.615.837-.617 1.397-.617M7.5 19c.042-.127.063-.19.086-.246a2 2 0 0 1 1.735-1.25c.06-.004.127-.004.26-.004h4.838c.133 0 .2 0 .26.004a2 2 0 0 1 1.735 1.25c.023.056.044.12.086.246M12 17.5V22m0 0h7m-7 0H5\"/><path d=\"m21 8.5l-1.204-1.405c-.884-1.03-1.325-1.546-1.922-1.82C17.277 5 16.598 5 15.24 5H8.76c-1.358 0-2.037 0-2.634.274c-.597.275-1.038.79-1.922 1.821L3 8.5m9-.5V2\"/></g>",
  kettlebell: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M8.91 20.5a6.75 6.75 0 1 1 6.18 0Z\"/><path d=\"M8 9.25v-2.5A3.75 3.75 0 0 1 11.75 3h.5A3.75 3.75 0 0 1 16 6.75v2.5\"/></g>",
  plates: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M12 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6m3.07 0H8.93c-1.372 0-2.057 0-2.573.378c-.516.377-.733 1.037-1.166 2.357l-1.314 4c-.789 2.403-1.183 3.604-.593 4.434S5.12 21 7.616 21h8.768c2.495 0 3.743 0 4.333-.83c.59-.831.195-2.032-.594-4.435l-1.314-4c-.433-1.32-.65-1.98-1.166-2.357S16.442 9 15.071 9\"/>",
  smith_machine: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><circle cx=\"13\" cy=\"4.5\" r=\"1.75\"/><path d=\"M2.75 9.25h18.5M4.5 7v4.5m15-4.5v4.5m-7.25-.75L7.5 14.5h7l-1.75 6.75h4\"/></g>",
  pull_up_bar: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M2.75 3h18.5\"/><circle cx=\"12\" cy=\"6.75\" r=\"1.25\"/><path d=\"m5.5 3l4 7.5h5l4-7.5M12 10.5V15m0 0l-1.25 6.25M12 15l1.25 6.25\"/></g>",
  rings: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M5.25 2.75v5m13.5-5v5\"/><circle cx=\"5.25\" cy=\"9.5\" r=\"1.75\"/><circle cx=\"18.75\" cy=\"9.5\" r=\"1.75\"/><circle cx=\"12\" cy=\"5.75\" r=\"1.75\"/><path d=\"M7 9.5h10m-5 0v6.25l-1 5.5m1-5.5l1 5.5\"/></g>",
  flat_bench: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M18 3v5M6 3v5m14.5-4v1.5m0 0V7m0-1.5H22M3.5 4v1.5m0 0V7m0-1.5H2m16 0H6m4 0V10m4-4.5V10m4.952 6H5.062m9.194-6h-4.05c-1.007 0-1.38.144-1.934.992l-3.013 4.612c-.186.284-.259.51-.259.854C5 18.611 5.873 19 7.847 19h8.25C18.133 19 19 18.616 19 16.408c0-.306-.057-.51-.204-.773l-2.537-4.53c-.534-.953-.918-1.105-2.003-1.105M16 19v2m-8-2v2\"/>",
  resistance_band: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M8 3.25h8m-10 3h12\"/><rect width=\"16\" height=\"11.5\" x=\"4\" y=\"9.25\" rx=\"2\"/><path d=\"M2.75 15H10l2-1.75L14 15h7.25\"/></g>",
  loop_band: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M8 3.25h8m-10 3h12\"/><rect width=\"16\" height=\"11.5\" x=\"4\" y=\"9.25\" rx=\"2\"/><path d=\"M2.75 15H10l2-1.75L14 15h7.25\"/></g>",
  stability_ball: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10Z\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M18.853 4.717C18.038 9.422 13.937 13 9 13a9.97 9.97 0 0 1-6.854-2.717m19.664-.233C19.693 14.738 14.977 18 9.5 18a13.44 13.44 0 0 1-6.52-1.676m.674-9.836a7.002 7.002 0 0 0 11.202-4.074\"/></g>",
  battle_rope: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M2.75 7.5q2.25-3 4.5 0c2.25 3 3 2 4.5 0s3-2 4.5 0c1.25 1.6 3 3.6 4.75 4.5M2.75 16.5q2.25 3 4.5 0c2.25-3 3-2 4.5 0s3 2 4.5 0c1.25-1.6 3-3.6 4.75-4.5m.25-6.5v13\"/>",
  climbing_rope: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"m13.5 10.75l.05.36l-.01.38l-.09.39l-.16.37l-.24.35l-.3.32l-.37.26l-.42.2l-.46.12l-.49.04l-.51-.05l-.5-.14l-.48-.24l-.45-.32l-.38-.41l-.32-.49l-.23-.55l-.14-.59l-.03-.62l.08-.63l.2-.62l.31-.59l.42-.54l.52-.46l.6-.38l.68-.26l.72-.15l.75-.02l.76.12l.74.25l.7.39l.62.51l.54.62l.43.73l.3.8l.16.85l.01.88l-.15.89l-.31.85l-.46.81l-.61.72l-.73.61l-.84.49l-.93.33l-.98.17l-1.01-.01l-1.01-.18l-.98-.36l-.91-.54l-.81-.7l-.69-.84l-.54-.95l-.37-1.06L5 10.75l.02-1.14l.22-1.14l.41-1.09l.62-1.02l.78-.91l.95-.76l1.08-.6l1.18-.4l1.24-.19l1.27.03l1.27.25l1.21.47l1.12.69l1 .88l.84 1.06l.65 1.19l.44 1.31l.2 1.37m0 0c0 4.5-.5 7.5-2.25 10.5\"/>",
  jump_rope: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><circle cx=\"12\" cy=\"7.25\" r=\"1.75\"/><path d=\"M12 10.5V15m-4-1.75L12 11l4 2.25M12 15l-2.5 2l1.5 2.5m1-4.5l2.5 2l-1.5 2.5\"/><path d=\"M8 13.25c-4-3-4-10.5 4-10.5s8 7.5 4 10.5M5.5 21h3m7 0h3\"/></g>",
  treadmill: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><rect width=\"17\" height=\"4.5\" x=\"2.75\" y=\"16.25\" rx=\"2.25\"/><path d=\"M6 18.5h10.5m1-2.25l-2.75-11.5h4.5\"/></g>",
  elliptical: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><circle cx=\"18\" cy=\"17.25\" r=\"3.25\"/><path d=\"m18 14l-1.75-5.75m0 0l3.25-5.5m-3.25 5.5l-4.5-5m-1.09 12.53a4.5 2.25 0 0 1-4.43 3.66m-2.39-.72a4.5 2.25 0 0 1 4.43-3.66\"/><circle cx=\"9.5\" cy=\"15.3\" r=\"1.25\"/><circle cx=\"5\" cy=\"19.2\" r=\"1.25\"/></g>",
  stair_climber: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M2.75 21.25H7v-3.5h4.75v-3.5h4.75v-3.5h4.75\"/><circle cx=\"8.75\" cy=\"4.5\" r=\"1.75\"/><path d=\"m9 7.25l1.25 3.25m0 0l-.75 7.25m.75-7.25l3.5 1l-.25 2.75m-4-5.75l3 1L14 7.75\"/></g>",
  cable: "<g fill=\"none\" stroke=\"currentColor\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"round\" d=\"M3 3h18\"/><circle cx=\"15.5\" cy=\"10.5\" r=\"3.5\" stroke-linecap=\"round\"/><circle cx=\"8.5\" cy=\"17.5\" r=\"3.5\" stroke-linecap=\"round\"/><path stroke-linecap=\"round\" d=\"M5 17.5V3m7 14.5v-7M15.5 7V3M19 17v-6.5\"/><path d=\"M19 17c-.714 0-1.097.2-1.383.896c-.373.908-.826 2.254-.511 2.807c.168.297.554.297 1.325.297h1.137c.772 0 1.158 0 1.326-.297c.315-.553-.138-1.9-.51-2.807C20.11 17.232 19.741 17 19 17Z\"/></g>",
  lat_pulldown_machine: "<g fill=\"none\" stroke=\"currentColor\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"round\" d=\"M3 3h18\"/><circle cx=\"15.5\" cy=\"10.5\" r=\"3.5\" stroke-linecap=\"round\"/><circle cx=\"8.5\" cy=\"17.5\" r=\"3.5\" stroke-linecap=\"round\"/><path stroke-linecap=\"round\" d=\"M5 17.5V3m7 14.5v-7M15.5 7V3M19 17v-6.5\"/><path d=\"M19 17c-.714 0-1.097.2-1.383.896c-.373.908-.826 2.254-.511 2.807c.168.297.554.297 1.325.297h1.137c.772 0 1.158 0 1.326-.297c.315-.553-.138-1.9-.51-2.807C20.11 17.232 19.741 17 19 17Z\"/></g>",
  chest_press_machine: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M13.91 8.368c.302.233.364.621.49 1.398l.457 2.849c.163 1.008.244 1.512-.076 1.84c-.756.774-4.9.678-5.562 0c-.32-.328-.239-.832-.077-1.84L9.6 9.766c.125-.777.188-1.165.49-1.398c.62-.478 3.167-.503 3.82 0M7.5 19c.042-.127.063-.19.086-.246a2 2 0 0 1 1.735-1.25c.06-.004.127-.004.26-.004h4.838c.133 0 .2 0 .26.004a2 2 0 0 1 1.735 1.25c.023.056.044.12.086.246M12 17.5V22m0 0h7m-7 0H5\"/><path d=\"M21 14v-3.597c0-.695 0-1.042-.113-1.363c-.113-.322-.33-.593-.764-1.136l-1.922-2.403c-.59-.737-.885-1.106-1.296-1.304C16.495 4 16.022 4 15.077 4H8.923c-.944 0-1.416 0-1.827.197c-.41.198-.706.567-1.296 1.304L3.877 7.904c-.434.543-.652.814-.764 1.136C3 9.36 3 9.708 3 10.403V14m0-2h3m15 0h-3m-6-4V2\"/></g>",
  machine: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M7.75 11.5h8.5c1.393 0 1.75.41 1.75 1.75c0 1.393-.41 1.75-1.75 1.75h-8.5C6.357 15 6 14.59 6 13.25c0-1.393.41-1.75 1.75-1.75m0 3.5h8.5c1.393 0 1.75.41 1.75 1.75c0 1.393-.41 1.75-1.75 1.75h-8.5C6.357 18.5 6 18.09 6 16.75C6 15.357 6.41 15 7.75 15m0 3.5h8.5c1.393 0 1.75.41 1.75 1.75c0 1.393-.41 1.75-1.75 1.75h-8.5C6.357 22 6 21.59 6 20.25c0-1.393.41-1.75 1.75-1.75M22 7.5l-.799-1c-.59-.737-.885-1.106-1.296-1.303c-.344-.166-.732-.193-1.405-.197M2 7.5l.799-1c.59-.737.885-1.106 1.296-1.303c.344-.166.732-.193 1.405-.197M16 5H8m8-3v9.5M8 2v9.5\"/>",
  leg_press: "<g fill=\"none\" stroke=\"currentColor\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"round\" d=\"M3 3v18M21 3v18m1-15H2\"/><path d=\"M15.5 10c1.105 0 2 .97 2 2.165c0 .283-.05.554-.142.802c-.294.798-3.489.617-3.716 0a2.3 2.3 0 0 1-.142-.802c0-1.196.895-2.165 2-2.165Zm-7 0c1.105 0 2 .97 2 2.165c0 .283-.05.554-.142.802c-.294.798-3.489.617-3.716 0a2.3 2.3 0 0 1-.142-.802c0-1.196.895-2.165 2-2.165Z\"/><path stroke-linecap=\"round\" d=\"M8.5 10V6m7 4V6\"/></g>",
  none: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M12.002 14.003v-1.64m0 1.64q2.5 0 5-.546a26 26 0 0 0 3.823-1.158c.39-.15.832-.285 1.04-.677c.137-.256.137-.565.137-1.183c0-1.233 0-2.851-.301-3.173c-.57-.61-1.657-.048-2.289.157q-7.41 2.403-14.82 0c-.633-.205-1.72-.766-2.29-.157c-.3.322-.3 1.94-.3 3.173c0 .445-.053.966.237 1.34c.175.225.43.324.94.52q1.912.74 3.824 1.158q2.5.546 4.999.546m-4.999-.546l-.001-1.642m10 1.642v-1.642m2 7.195q-7 2.004-14 0\"/><path d=\"M19.191 2.998c-.577 1.311-1.107 3.56-1.107 4.59M4.815 2.998c.577 1.311 1.108 3.56 1.108 4.59m-.524 7.923c-.439 1.38-1.598 4.11-1.395 5.492m14.61-5.492c.44 1.38 1.599 4.11 1.395 5.492\"/></g>",
};

const own: Readonly<Record<string, ReactNode>> = {
  dip_station: <Path d="M3 9h7M14 9h7M5 9v11M8 9v11M16 9v11M19 9v11" />,
  plyo_box: <Path d="M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9" />,
  suspension_trainer: <><Circle cx={12} cy={3.5} r={1.5} /><Path d="M12 5L7 18M12 5l5 13M4.5 18.5h5M14.5 18.5h5" /></>,
  slam_ball: <><Circle cx={12} cy={12} r={8} /><Path d="M4 12h16M12 4c-3 3-3 13 0 16" /></>,
  ab_wheel: <><Circle cx={12} cy={12} r={5} /><Circle cx={12} cy={12} r={1} /><Path d="M2 12h5M17 12h5" /></>,
  rower: <><Path d="M2 18h20M5 18v3M19 18v3M16 12l-6-3M9 8v2" /><Rect x={7} y={14.5} width={5} height={3} rx={1} /><Circle cx={18.5} cy={13} r={3} /></>,
  stationary_bike: <><Path d="M3 21h18M8 21V9M5 9h6M16 14V7M14 7h5" /><Circle cx={16} cy={17} r={3} /></>,
  sled: <Path d="M2 18h17c1.5 0 2.5-1 2.5-2.5M6 18V8M14 18V8M6 8h8M6 13h8" />,
};

const aliases: Readonly<Record<string, string>> = {
  air_bike: "stationary_bike", ski_erg: "cable", trap_bar: "barbell", wrist_roller: "ab_wheel", hack_squat: "leg_press",
};

export function EquipmentGlyph({ id, color, size = 24 }: Readonly<{ id: string; color: string; size?: number }>) {
  const approved = approvedEquipmentGlyphs[id];
  if (approved !== undefined) return <SvgXml xml={approved.split("currentColor").join(color)} width={size} height={size} />;
  const key = aliases[id] ?? id;
  const xml = library[key];
  const custom = own[key];
  if (xml === undefined && custom !== undefined) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round">{custom}</Svg>
    );
  }
  const body = (xml ?? library.machine!).split("currentColor").join(color);
  return <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`} width={size} height={size} />;
}
