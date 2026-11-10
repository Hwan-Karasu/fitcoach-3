/** Несколько открытых экранов удерживают состояние; перемонтирование в том же кадре не сбрасывает его. */
export function createViewRetainer(clear: (key: string) => void) {
  const holders = new Map<string, number>();
  return (key: string): (() => void) => {
    holders.set(key, (holders.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (holders.get(key) ?? 1) - 1;
      holders.set(key, left);
      if (left === 0) setTimeout(() => {
        if (holders.get(key) !== 0) return;
        holders.delete(key); clear(key);
      }, 0);
    };
  };
}
