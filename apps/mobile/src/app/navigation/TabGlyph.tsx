import { StyleSheet, View } from "react-native";

export type TabGlyphKind = "clients" | "calendar" | "archive" | "home" | "nutrition" | "training" | "more";

export function TabGlyph({ kind, color }: Readonly<{ kind: TabGlyphKind; color: string }>) {
  if (kind === "clients") {
    return <View style={styles.frame}><View style={[styles.head, { borderColor: color }]} /><View style={[styles.shoulders, { borderColor: color }]} /></View>;
  }
  if (kind === "calendar") {
    return <View style={[styles.calendar, { borderColor: color }]}><View style={[styles.calendarRule, { backgroundColor: color }]} /><View style={styles.calendarDots}><View style={[styles.dot, { backgroundColor: color }]} /><View style={[styles.dot, { backgroundColor: color }]} /><View style={[styles.dot, { backgroundColor: color }]} /></View></View>;
  }
  if (kind === "archive") {
    return <View style={styles.frame}><View style={[styles.archiveBox, { borderColor: color }]} /><View style={[styles.archiveHandle, { borderColor: color }]} /></View>;
  }
  if (kind === "home") {
    return <View style={styles.frame}><View style={[styles.roof, { borderColor: color }]} /><View style={[styles.house, { borderColor: color }]} /></View>;
  }
  if (kind === "nutrition") {
    return <View style={[styles.plate, { borderColor: color }]}><View style={[styles.plateInner, { borderColor: color }]} /></View>;
  }
  if (kind === "training") {
    return <View style={styles.frame}><View style={[styles.bar, { backgroundColor: color }]} /><View style={[styles.weightLeft, { borderColor: color }]} /><View style={[styles.weightRight, { borderColor: color }]} /></View>;
  }
  return <View style={styles.moreRow}><View style={[styles.moreDot, { backgroundColor: color }]} /><View style={[styles.moreDot, { backgroundColor: color }]} /><View style={[styles.moreDot, { backgroundColor: color }]} /></View>;
}

const styles = StyleSheet.create({
  frame: { width: 24, height: 24 },
  head: { position: "absolute", top: 2, left: 9, width: 7, height: 7, borderWidth: 2, borderRadius: 4 },
  shoulders: { position: "absolute", top: 11, left: 4, width: 17, height: 10, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 9, borderTopRightRadius: 9 },
  calendar: { width: 21, height: 20, marginTop: 2, borderWidth: 2, borderRadius: 3 },
  calendarRule: { height: 2, marginTop: 4 },
  calendarDots: { flexDirection: "row", justifyContent: "space-around", marginTop: 4 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  archiveBox: { position: "absolute", top: 6, left: 3, width: 18, height: 15, borderWidth: 2, borderRadius: 2 },
  archiveHandle: { position: "absolute", top: 2, left: 1, width: 22, height: 6, borderWidth: 2, borderRadius: 2 },
  roof: { position: "absolute", top: 2, left: 6, width: 13, height: 13, borderLeftWidth: 2, borderTopWidth: 2, transform: [{ rotate: "45deg" }] },
  house: { position: "absolute", top: 10, left: 5, width: 15, height: 12, borderWidth: 2, borderTopWidth: 0, borderRadius: 1 },
  plate: { width: 21, height: 21, marginTop: 1, borderWidth: 2, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  plateInner: { width: 10, height: 10, borderWidth: 1.5, borderRadius: 5 },
  bar: { position: "absolute", top: 11, left: 2, width: 20, height: 2 },
  weightLeft: { position: "absolute", top: 5, left: 3, width: 5, height: 14, borderWidth: 2, borderRadius: 1 },
  weightRight: { position: "absolute", top: 5, right: 3, width: 5, height: 14, borderWidth: 2, borderRadius: 1 },
  moreRow: { width: 24, height: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  moreDot: { width: 4, height: 4, borderRadius: 2 },
});
