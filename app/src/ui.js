import React from 'react';
import { Pressable as NativePressable } from 'react-native';

const pressedStyle = { opacity: 0.55, transform: [{ scale: 0.98 }] };

// Every button dims the moment it is touched, so taps feel instant even while the network works.
export function Pressable({ style, ...props }) {
  return (
    <NativePressable
      {...props}
      style={(state) => [typeof style === 'function' ? style(state) : style, state.pressed && pressedStyle]}
    />
  );
}

// App-wide text size: every fontSize (and lineHeight) in a style sheet grows by `step` px.
export const TEXT_STEP = 1;
export function largerText(styles, step = TEXT_STEP) {
  return Object.fromEntries(Object.entries(styles).map(([name, style]) => {
    if (typeof style?.fontSize !== 'number') return [name, style];
    const grown = { ...style, fontSize: style.fontSize + step };
    if (typeof style.lineHeight === 'number') grown.lineHeight = style.lineHeight + step;
    return [name, grown];
  }));
}
