import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { PersonStanding } from "lucide-react-native";

/**
 * Значки оборудования (UI-OWN-031): свой набор в стиле lucide — сетка 24, линия 1,8, скруглённые концы. В lucide
 * нет спортивного оборудования (гантели, штанга и EZ-гриф выглядели одинаково). Узкие тренажёры — общий «тренажёр».
 */
type Glyph = ReactNode;

const glyphs: Readonly<Record<string, Glyph>> = {
  barbell: <>
    <Path d="M2 12h2M9.5 12h5M20 12h2" />
    <Rect x={4} y={5} width={2.5} height={14} rx={1} /><Rect x={7} y={7.5} width={2.5} height={9} rx={1} />
    <Rect x={17.5} y={5} width={2.5} height={14} rx={1} /><Rect x={14.5} y={7.5} width={2.5} height={9} rx={1} />
  </>,
  dumbbell: <>
    <Rect x={3} y={7} width={4} height={10} rx={1.5} /><Rect x={17} y={7} width={4} height={10} rx={1.5} />
    <Path d="M7 12h10M1.5 10v4M22.5 10v4" />
  </>,
  ez_bar: <>
    <Path d="M2 12h3M19 12h3M8 12l1.33-2 1.34 2 1.33 2 1.33-2 1.34 2 1.33-2" />
    <Rect x={5} y={6} width={3} height={12} rx={1} /><Rect x={16} y={6} width={3} height={12} rx={1} />
  </>,
  trap_bar: <Path d="M7.5 6h9l4 6-4 6h-9l-4-6zM9.5 9.5v5M14.5 9.5v5M1 12h2.5M20.5 12H23" />,
  kettlebell: <>
    <Circle cx={12} cy={14.5} r={6} />
    <Path d="M8.5 10.3V7a3.5 3.5 0 0 1 7 0v3.3" />
  </>,
  plates: <><Circle cx={12} cy={12} r={9} /><Circle cx={12} cy={12} r={5.5} /><Circle cx={12} cy={12} r={1.5} /></>,
  smith_machine: <>
    <Path d="M4 22V2M20 22V2M2 10h20" />
    <Rect x={6} y={7} width={2} height={6} rx={0.5} /><Rect x={16} y={7} width={2} height={6} rx={0.5} />
  </>,
  pull_up_bar: <Path d="M4 21V4M20 21V4M2.5 7h19M2 21h4M18 21h4" />,
  dip_station: <Path d="M3 9h7M14 9h7M5 9v11M8 9v11M16 9v11M19 9v11" />,
  rings: <><Path d="M8 2v9M16 2v9" /><Circle cx={8} cy={15} r={3.5} /><Circle cx={16} cy={15} r={3.5} /></>,
  flat_bench: <><Rect x={2} y={9} width={20} height={3} rx={1} /><Path d="M5 12v8M19 12v8M3 20h4M17 20h4" /></>,
  plyo_box: <Path d="M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9" />,
  cable: <><Path d="M3 22V3h18v19M12 9.5V16M9 17h6" /><Circle cx={12} cy={7} r={2.5} /></>,
  resistance_band: <>
    <Path d="M6 7c0 8 12 3 12 11" />
    <Rect x={2} y={4} width={7} height={3} rx={1.5} /><Rect x={15} y={18} width={7} height={3} rx={1.5} />
  </>,
  loop_band: <><Rect x={2.5} y={7} width={19} height={10} rx={5} /><Rect x={5.5} y={9.5} width={13} height={5} rx={2.5} /></>,
  suspension_trainer: <><Circle cx={12} cy={3.5} r={1.5} /><Path d="M12 5L7 18M12 5l5 13M4.5 18.5h5M14.5 18.5h5" /></>,
  stability_ball: <><Circle cx={12} cy={12} r={9} /><Path d="M3.5 10c5 2.5 12 2.5 17 0" /></>,
  slam_ball: <><Circle cx={12} cy={12} r={8} /><Path d="M4 12h16M12 4c-3 3-3 13 0 16" /></>,
  battle_rope: <Path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />,
  climbing_rope: <Path d="M8 2h8M12 2c-2.5 2.5 2.5 4.5 0 7s2.5 4.5 0 7 2.5 3.5 0 6" />,
  jump_rope: <>
    <Rect x={4.5} y={2} width={3} height={7} rx={1.5} /><Rect x={16.5} y={2} width={3} height={7} rx={1.5} />
    <Path d="M6 9c0 13 12 13 12 0" />
  </>,
  ab_wheel: <><Circle cx={12} cy={12} r={5} /><Circle cx={12} cy={12} r={1} /><Path d="M2 12h5M17 12h5" /></>,
  rower: <><Path d="M2 18h20M5 18v3M19 18v3M16 12l-6-3M9 8v2" /><Rect x={7} y={14.5} width={5} height={3} rx={1} /><Circle cx={18.5} cy={13} r={3} /></>,
  stationary_bike: <><Path d="M3 21h18M8 21V9M5 9h6M16 14V7M14 7h5" /><Circle cx={16} cy={17} r={3} /></>,
  treadmill: <><Rect x={2} y={16} width={17} height={4} rx={2} /><Path d="M17 16l3-10M16.5 6h4.5" /></>,
  stair_climber: <Path d="M3 20h4v-4h4v-4h4V8h4V4" />,
  sled: <Path d="M2 18h17c1.5 0 2.5-1 2.5-2.5M6 18V8M14 18V8M6 8h8M6 13h8" />,
};

const aliases: Readonly<Record<string, string>> = {
  air_bike: "stationary_bike", ski_erg: "cable", lat_pulldown_machine: "cable", elliptical: "stationary_bike",
  wrist_roller: "ab_wheel",
};

/** Общий значок тренажёра: рама, грузовой блок, сиденье. */
const machine: Glyph = <>
  <Path d="M4 22V3h12M16 3v7" />
  <Rect x={13} y={10} width={6} height={11} rx={1} /><Path d="M13 14h6M13 17.5h6" />
  <Rect x={3} y={14} width={7} height={2.5} rx={1} />
</>;

export function EquipmentGlyph({ id, color, size = 24 }: Readonly<{ id: string; color: string; size?: number }>) {
  if (id === "none") return <PersonStanding size={size} color={color} strokeWidth={1.8} />;
  const glyph = glyphs[aliases[id] ?? id] ?? machine;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round">
      {glyph}
    </Svg>
  );
}
