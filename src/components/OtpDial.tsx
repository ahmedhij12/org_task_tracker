import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, AccessibilityInfo, StyleSheet } from 'react-native';
import Animated, {
  type SharedValue,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useThemeColors } from './ui';

// The dial: slots sit on a ring and a bright arc rotates to whichever slot you
// are filling. Six digits in a circle would otherwise have no obvious starting
// point — the arc is what makes the reading order unambiguous, so it earns its
// place rather than decorating.
const RADIUS = 96;
const SLOT_W = 52;
const SLOT_H = 62;
const RING_STROKE = 1.5;
const BOX = (RADIUS + SLOT_H / 2) * 2 + 8;
const CENTER = BOX / 2;
const CIRC = 2 * Math.PI * RADIUS;
/** Arc long enough to sit behind one slot, no longer. */
const ARC = CIRC / 12;

/** Slot i sits at 12 o'clock + i steps clockwise. */
function angleFor(index: number, total: number) {
  return -90 + (360 / total) * index;
}

function positionFor(index: number, total: number) {
  const rad = (angleFor(index, total) * Math.PI) / 180;
  return { x: Math.cos(rad) * RADIUS, y: Math.sin(rad) * RADIUS };
}

function Slot({
  digit,
  active,
  errored,
  index,
  total,
  collapse,
  reduceMotion,
}: {
  digit: string;
  active: boolean;
  errored: boolean;
  index: number;
  total: number;
  collapse: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const c = useThemeColors();
  const { x, y } = useMemo(() => positionFor(index, total), [index, total]);
  const focus = useSharedValue(active ? 1 : 0);
  const pop = useSharedValue(digit ? 1 : 0);

  useEffect(() => {
    focus.value = withTiming(active ? 1 : 0, { duration: reduceMotion ? 0 : 180 });
  }, [active, focus, reduceMotion]);

  useEffect(() => {
    pop.value = withTiming(digit ? 1 : 0, { duration: reduceMotion ? 0 : 160, easing: Easing.out(Easing.back(2)) });
  }, [digit, pop, reduceMotion]);

  const boxStyle = useAnimatedStyle(() => {
    // On success every slot falls back into the hub.
    const home = 1 - collapse.value;
    return {
      transform: [
        { translateX: x * home },
        { translateY: y * home },
        { scale: interpolate(collapse.value, [0, 1], [1 + focus.value * 0.06, 0.4]) },
      ],
      opacity: 1 - collapse.value,
      borderColor: errored ? c.rose : focus.value > 0.5 ? c.indigo : c.border,
      backgroundColor: focus.value > 0.5 ? c.indigoSoft : c.bgSubtle,
    };
  });

  const digitStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: interpolate(pop.value, [0, 1], [0.5, 1]) }],
  }));

  return (
    <Animated.View style={[styles.slot, { borderRadius: 16 }, boxStyle]}>
      <Animated.Text style={[styles.digit, { color: c.text }, digitStyle]}>{digit}</Animated.Text>
    </Animated.View>
  );
}

export function OtpDial({
  length,
  value,
  onChange,
  onComplete,
  errored,
  succeeded,
  disabled,
}: {
  length: number;
  value: string;
  onChange: (next: string) => void;
  onComplete: (code: string) => void;
  errored: boolean;
  succeeded: boolean;
  disabled?: boolean;
}) {
  const c = useThemeColors();
  const inputRef = useRef<TextInput>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const shake = useSharedValue(0);
  const pointer = useSharedValue(angleFor(0, length));
  const collapse = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const activeIndex = Math.min(value.length, length - 1);

  useEffect(() => {
    pointer.value = withTiming(angleFor(activeIndex, length), {
      duration: reduceMotion ? 0 : 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeIndex, length, pointer, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || succeeded) return;
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduceMotion, succeeded]);

  useEffect(() => {
    if (!errored || reduceMotion) return;
    shake.value = withSequence(
      withTiming(-9, { duration: 45 }),
      withTiming(9, { duration: 90 }),
      withTiming(-6, { duration: 90 }),
      withTiming(0, { duration: 60 })
    );
  }, [errored, shake, reduceMotion]);

  useEffect(() => {
    collapse.value = withTiming(succeeded ? 1 : 0, {
      duration: reduceMotion ? 0 : 420,
      easing: Easing.in(Easing.cubic),
    });
  }, [succeeded, collapse, reduceMotion]);

  const dialStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const pointerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${pointer.value + 90}deg` }],
    opacity: interpolate(pulse.value, [0, 1], [0.55, 1]) * (1 - collapse.value),
  }));
  const hubStyle = useAnimatedStyle(() => ({
    opacity: collapse.value,
    transform: [{ scale: interpolate(collapse.value, [0, 1], [0.6, 1]) }],
  }));

  const handleChange = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete(digits);
  };

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessibilityRole="none">
      <Animated.View style={[{ width: BOX, height: BOX, alignSelf: 'center' }, dialStyle]}>
        {/* Ring the slots rest on. */}
        <Svg width={BOX} height={BOX} style={StyleSheet.absoluteFill}>
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            stroke={c.border}
            strokeWidth={RING_STROKE}
            strokeDasharray="2 8"
            fill="none"
          />
        </Svg>

        {/* The arc that points at the slot you are filling. */}
        <Animated.View style={[StyleSheet.absoluteFill, pointerStyle]}>
          <Svg width={BOX} height={BOX}>
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              stroke={errored ? c.rose : c.indigo}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={`${ARC} ${CIRC - ARC}`}
              fill="none"
            />
          </Svg>
        </Animated.View>

        <View style={styles.center}>
          {Array.from({ length }).map((_, i) => (
            <Slot
              key={i}
              index={i}
              total={length}
              digit={value[i] ?? ''}
              active={!succeeded && i === activeIndex}
              errored={errored}
              collapse={collapse}
              reduceMotion={reduceMotion}
            />
          ))}

          {/* Hub: empty until the code lands, then it is the whole story. */}
          <Animated.View style={[styles.hub, { backgroundColor: c.emerald }, hubStyle]}>
            <Text style={styles.hubMark}>✓</Text>
          </Animated.View>
        </View>

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={handleChange}
          autoFocus
          editable={!disabled && !succeeded}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={length}
          caretHidden
          accessibilityLabel={`Verification code, ${length} digits`}
          style={styles.hiddenInput}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  slot: {
    position: 'absolute',
    width: SLOT_W,
    height: SLOT_H,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hub: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubMark: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  // Present for the keyboard and for one-time-code autofill, never seen.
  hiddenInput: { ...StyleSheet.absoluteFillObject, opacity: 0 },
});
