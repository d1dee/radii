import { useState, useMemo, useRef } from 'react';

export interface Signal<T> {
  get value(): T;
  set value(v: T);
  peek(): T;
}

export function useSignal<T>(initialValue: T): Signal<T> {
  const [state, setState] = useState(initialValue);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [, setTick] = useState(0);

  return useMemo(() => {
    return {
      get value() { return stateRef.current; },
      set value(v: T) {
        stateRef.current = v;
        setState(v);
        setTick(t => t + 1);
      },
      peek() { return stateRef.current; }
    };
  }, [state]);
}
