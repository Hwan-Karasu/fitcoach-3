import { memo, useId } from "react";
import { StyleSheet } from "react-native";
import Svg, { Defs, Ellipse, G, Image, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import Animated, { useAnimatedProps, type SharedValue } from "react-native-reanimated";
import athleteTexture from "../../../assets/brand/source-foreground.png";
import { ATHLETE_FACETS, type AthleteFacet } from "./athleteFacets.ts";
import { facetReflection, facetReveal, smoothProgress } from "./launchTimeline.ts";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedGroup = Animated.createAnimatedComponent(G);

const RevealFace = memo(function RevealFace({ face, clock }: Readonly<{ face: AthleteFacet; clock: SharedValue<number> }>) {
  const props = useAnimatedProps(() => ({ opacity: facetReveal(clock.value, face.order) }));
  return <AnimatedPath d={face.path} fill="white" animatedProps={props} />;
});

const ReflectionFace = memo(function ReflectionFace({ face, clock, prefix }: Readonly<{
  face: AthleteFacet; clock: SharedValue<number>; prefix: string;
}>) {
  const props = useAnimatedProps(() => ({ opacity: facetReflection(clock.value, face.x, face.y, face.reflection) }));
  return <AnimatedPath d={face.path} animatedProps={props} fill={`url(#${prefix}-${face.gradient})`}
    stroke="#D9FAFF" strokeWidth={0.13} strokeLinejoin="round" />;
});

const SpecularGlint = memo(function SpecularGlint({ x, y, clock }: Readonly<{ x: number; y: number; clock: SharedValue<number> }>) {
  const props = useAnimatedProps(() => ({ opacity: facetReflection(clock.value, x, y, 1) }));
  return <AnimatedGroup transform={`translate(${x} ${y})`} animatedProps={props}>
    <Path d="M-3 0L-.55-.4L0-2.4L.55-.4L3 0L.55.4L0 2.4L-.55.4Z" fill="#A3EAF5" opacity={0.35} />
    <Path d="M-1.5 0L-.2-.2L0-1.5L.2-.2L1.5 0L.2.2L0 1.5L-.2.2Z" fill="#F5FFFF" />
  </AnimatedGroup>;
});

/** A single cached texture under an alpha mask. Gradients live on individual faces. */
export const LaunchArtwork = memo(function LaunchArtwork({ size, clock, onLoad }: Readonly<{
  size: number; clock: SharedValue<number>; onLoad: () => void;
}>) {
  const prefix = `athlete${useId().replace(/\W/gu, "")}`;
  const body = useAnimatedProps(() => ({ opacity: smoothProgress(clock.value, 740, 1050) }));
  const contours = useAnimatedProps(() => ({ opacity: smoothProgress(clock.value, 0, 450)
    * (1 - smoothProgress(clock.value, 600, 1050)) * 0.24 }));
  return <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
    <Defs>
      <Mask id={`${prefix}-assembly`} x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse" maskType="alpha">
        <AnimatedRect x="0" y="0" width="100" height="100" fill="white" animatedProps={body} />
        {ATHLETE_FACETS.map((face) => <RevealFace key={face.id} face={face} clock={clock} />)}
      </Mask>
      <LinearGradient id={`${prefix}-rising`} x1="0" y1="1" x2="1" y2="0">
        <Stop offset="0" stopColor="#72D4E4" stopOpacity="0.12" /><Stop offset="0.7" stopColor="#D9F8FF" stopOpacity="0.7" />
        <Stop offset="1" stopColor="#FFFFFF" />
      </LinearGradient>
      <LinearGradient id={`${prefix}-falling`} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#FFFFFF" /><Stop offset="0.35" stopColor="#DEF8FF" stopOpacity="0.65" />
        <Stop offset="1" stopColor="#65BDCF" stopOpacity="0.08" />
      </LinearGradient>
    </Defs>
    <AnimatedGroup animatedProps={contours} fill="none" stroke="#6BCED9" strokeWidth={0.16}>
      {ATHLETE_FACETS.map((face) => <Path key={face.id} d={face.path} />)}
    </AnimatedGroup>
    <Image href={athleteTexture} x="0" y="0" width="100" height="100" mask={`url(#${prefix}-assembly)`} onLoad={onLoad} />
    {ATHLETE_FACETS.map((face) => <ReflectionFace key={face.id} face={face} clock={clock} prefix={prefix} />)}
    <SpecularGlint x={6.3} y={42.2} clock={clock} />
    <SpecularGlint x={63.8} y={32.8} clock={clock} />
    <SpecularGlint x={84.4} y={12.5} clock={clock} />
  </Svg>;
});

/** Soft corner ribbons from the reference, without blur passes or animated full-screen surfaces. */
export const LaunchBackdrop = memo(function LaunchBackdrop() {
  const prefix = `ribbon${useId().replace(/\W/gu, "")}`;
  return <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} viewBox="0 0 309 552"
    preserveAspectRatio="xMidYMid slice" accessible={false}>
    <Defs>
      <RadialGradient id={prefix} cx="50%" cy="50%" rx="50%" ry="50%">
        <Stop offset="0" stopColor="#008C9F" stopOpacity="0.56" />
        <Stop offset="0.28" stopColor="#006273" stopOpacity="0.4" />
        <Stop offset="0.65" stopColor="#00323D" stopOpacity="0.22" />
        <Stop offset="1" stopColor="#00171C" stopOpacity="0" />
      </RadialGradient>
    </Defs>
    <G fill={`url(#${prefix})`}>
      <Ellipse cx="45" cy="25" rx="170" ry="45" transform="rotate(-42 45 25)" opacity={0.65} />
      <Ellipse cx="45" cy="25" rx="145" ry="17" transform="rotate(-42 45 25)" />
      <Ellipse cx="45" cy="25" rx="110" ry="3" transform="rotate(-42 45 25)" opacity={0.6} />
      <Ellipse cx="258" cy="501" rx="155" ry="48" transform="rotate(-45 258 501)" opacity={0.65} />
      <Ellipse cx="258" cy="501" rx="125" ry="19" transform="rotate(-45 258 501)" />
      <Ellipse cx="258" cy="501" rx="95" ry="3" transform="rotate(-45 258 501)" opacity={0.6} />
    </G>
    <G fill="none" stroke="#0792A4" strokeWidth="0.6" opacity="0.25">
      <Path d="M-15 121Q40 45 110-9" /><Path d="M177 573Q215 511 286 476" />
    </G>
  </Svg>;
});
