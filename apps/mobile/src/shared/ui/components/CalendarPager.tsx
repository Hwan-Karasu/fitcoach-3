import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FlatList, StyleSheet, View } from "react-native";

interface Props {
  readonly page: number;
  readonly pageCount: number;
  readonly initialWidth?: number;
  readonly height?: number;
  readonly onPageChange: (page: number, previous: number) => void;
  readonly renderPage: (page: number, width: number) => ReactElement | null;
  readonly testID?: string;
}

/** Native calendar paging: fixed frame, exact page width, neighbouring pages rendered in advance.
 * Shared by appointments and nutrition; only the settled page changes the browsing period.
 */
export function CalendarPager({ page, pageCount, initialWidth = 0, height, onPageChange, renderPage, testID }: Props) {
  const [width, setWidth] = useState(initialWidth);
  const target = Math.max(0, Math.min(pageCount - 1, page));
  const list = useRef<FlatList<number>>(null);
  const shown = useRef(target);
  const lastWidth = useRef(width);
  const pending = useRef<number | null>(null);
  const data = useMemo(() => Array.from({ length: pageCount }, (_, index) => index), [pageCount]);
  const renderItem = useCallback(({ item }: Readonly<{ item: number }>) => renderPage(item, width), [renderPage, width]);

  useEffect(() => {
    const resized = Math.abs(lastWidth.current - width) >= 0.5;
    lastWidth.current = width;
    if (width <= 0 || (!resized && target === shown.current)) return;
    shown.current = target;
    pending.current = target;
    list.current?.scrollToOffset({ offset: target * width, animated: !resized });
  }, [target, width]);

  return <View style={[styles.frame, height === undefined ? null : { height }]} testID={testID}
    onLayout={(event) => { const next = event.nativeEvent.layout.width;
      setWidth((current) => Math.abs(current - next) < 0.5 ? current : next); }}>
    {width > 0 ? <FlatList ref={list} data={data} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      keyExtractor={(item) => String(item)} initialScrollIndex={target} windowSize={3}
      initialNumToRender={1} maxToRenderPerBatch={2}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      onScrollBeginDrag={() => { pending.current = null; }}
      onMomentumScrollEnd={(event) => {
        const index = Math.max(0, Math.min(pageCount - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
        if (pending.current !== null && index !== pending.current) return;
        pending.current = null;
        if (index === shown.current) return;
        const previous = shown.current;
        shown.current = index;
        onPageChange(index, previous);
      }} renderItem={renderItem} /> : null}
  </View>;
}

const styles = StyleSheet.create({ frame: { overflow: "hidden" } });
