import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Image, Pressable, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withDecay, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const MAX_SCALE = 6;
const TAP_SCALE = 2.5;
/** How far below "fits the screen" a pinch may squeeze before it springs back. */
const MIN_SQUEEZE = 0.7;
/** Release a pinch smaller than this and the photo closes, as it does in Telegram. */
const CLOSE_SCALE = 0.82;
/** Drag the photo this far down (or this fast) and it closes. */
const CLOSE_DRAG = 110;
const CLOSE_VELOCITY = 900;
const FLIP_RATIO = 0.22;
const FLIP_VELOCITY = 700;
const SNAP = { duration: 220 };

const MODE_UNDECIDED = 0;
const MODE_PAGER = 1;
const MODE_PHOTO = 2;
const MODE_DISMISS = 3;

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(Math.max(v, lo), hi);
}

/** One photo in the pager. Only the page you are on carries the zoom. */
function Page({
  uri, i, width, height, imgH, page, scale, tx, ty, shrink,
}: {
  uri: string; i: number; width: number; height: number; imgH: number;
  page: SharedValue<number>;
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  shrink: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const active = page.value === i;
    return {
      transform: [
        { translateX: active ? tx.value : 0 },
        { translateY: active ? ty.value : 0 },
        { scale: (active ? scale.value : 1) * shrink.value },
      ],
    };
  });
  return (
    // Placed by physical `left`, not flex order, so Arabic does not mirror the pager.
    <Animated.View
      style={[
        { position: 'absolute', left: i * width, top: 0, width, height, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Image testID={`photo-${i}`} source={{ uri }} style={{ width, height: imgH }} resizeMode="contain" />
    </Animated.View>
  );
}

/**
 * Full-screen photo viewer that behaves like WhatsApp / Instagram / Telegram:
 * pinch to any zoom you like, double-tap to zoom in on the spot you tapped,
 * drag to look around (it glides on release), swipe sideways between photos,
 * swipe down — or squeeze — to dismiss, tap once to hide the buttons.
 *
 * The pager and the zoom run on the SAME gesture system on every platform.
 * That is the whole point: an earlier version paged with a ScrollView and
 * zoomed with gesture-handler, and on web the two raced for the touch — the
 * zoom detector held it and swiping died. Composed with Gesture.Simultaneous,
 * a drag never waits on a tap to fail.
 */
export function PhotoViewer({ urls, index, onClose }: { urls: string[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const { t } = useTranslation();
  const [current, setCurrent] = useState(index ?? 0);
  const [chrome, setChrome] = useState(true);
  const imgH = height * 0.85;
  const n = urls.length;

  const pagerX = useSharedValue(0);
  const page = useSharedValue(index ?? 0);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const shrink = useSharedValue(1);
  const fromScale = useSharedValue(1);
  const fromTx = useSharedValue(0);
  const fromTy = useSharedValue(0);
  const fromPager = useSharedValue(0);
  const mode = useSharedValue(MODE_UNDECIDED);

  useEffect(() => {
    if (index == null) return;
    setCurrent(index);
    setChrome(true);
    page.value = index;
    pagerX.value = -index * width;
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    dragX.value = 0;
    dragY.value = 0;
    shrink.value = 1;
  }, [index, width, height]);

  const gesture = useMemo(() => {
    /** How far the photo may be dragged at this scale before it shows black. */
    const limits = (s: number) => {
      'worklet';
      return { x: Math.max(0, (width * s - width) / 2), y: Math.max(0, (imgH * s - height) / 2) };
    };
    const fit = () => {
      'worklet';
      scale.value = withTiming(1, SNAP);
      tx.value = withTiming(0, SNAP);
      ty.value = withTiming(0, SNAP);
    };
    const letGo = () => {
      'worklet';
      dragX.value = withTiming(0, SNAP);
      dragY.value = withTiming(0, SNAP);
      shrink.value = withTiming(1, SNAP);
    };
    const dismiss = () => {
      'worklet';
      runOnJS(onClose)();
    };

    const pinch = Gesture.Pinch()
      .onStart(() => {
        fromScale.value = scale.value;
        fromTx.value = tx.value;
        fromTy.value = ty.value;
      })
      .onUpdate((e) => {
        const next = clamp(fromScale.value * e.scale, MIN_SQUEEZE, MAX_SCALE);
        // Keep the point between the fingers pinned while the scale changes.
        const k = next / fromScale.value;
        const fx = e.focalX - width / 2;
        const fy = e.focalY - height / 2;
        const l = limits(next);
        scale.value = next;
        tx.value = clamp(fx - (fx - fromTx.value) * k, -l.x, l.x);
        ty.value = clamp(fy - (fy - fromTy.value) * k, -l.y, l.y);
        // Squeezing below fit fades the background, so dismissing looks deliberate.
        shrink.value = 1;
        dragY.value = 0;
      })
      .onEnd(() => {
        if (scale.value < CLOSE_SCALE) {
          dismiss();
          return;
        }
        if (scale.value <= 1.01) fit();
      });

    const pan = Gesture.Pan()
      .maxPointers(1)
      .onStart(() => {
        fromTx.value = tx.value;
        fromTy.value = ty.value;
        fromPager.value = pagerX.value;
        mode.value = MODE_UNDECIDED;
      })
      .onUpdate((e) => {
        if (mode.value === MODE_UNDECIDED) {
          if (Math.abs(e.translationX) < 4 && Math.abs(e.translationY) < 4) return;
          const sideways = Math.abs(e.translationX) > Math.abs(e.translationY);
          if (scale.value <= 1.01) {
            // Fit to the screen: sideways pages, up/down dismisses.
            mode.value = sideways && n > 1 ? MODE_PAGER : MODE_DISMISS;
          } else {
            // Zoomed in: a sideways drag already at the photo's edge hands over
            // to the pager, the way it does in a phone gallery.
            const l = limits(scale.value);
            const atEdge =
              (e.translationX > 0 && fromTx.value >= l.x - 0.5) ||
              (e.translationX < 0 && fromTx.value <= -l.x + 0.5);
            mode.value = n > 1 && atEdge && sideways ? MODE_PAGER : MODE_PHOTO;
          }
        }
        if (mode.value === MODE_PAGER) {
          let x = fromPager.value + e.translationX;
          const min = -(n - 1) * width;
          if (x > 0) x = x * 0.3;
          if (x < min) x = min + (x - min) * 0.3;
          pagerX.value = x;
        } else if (mode.value === MODE_PHOTO) {
          const l = limits(scale.value);
          tx.value = clamp(fromTx.value + e.translationX, -l.x, l.x);
          ty.value = clamp(fromTy.value + e.translationY, -l.y, l.y);
        } else if (mode.value === MODE_DISMISS) {
          dragX.value = e.translationX;
          dragY.value = e.translationY;
          shrink.value = Math.max(0.8, 1 - Math.abs(e.translationY) / (height * 2));
        }
      })
      .onEnd((e) => {
        if (mode.value === MODE_PAGER) {
          let next = page.value;
          if (e.translationX < -width * FLIP_RATIO || e.velocityX < -FLIP_VELOCITY) next = Math.min(page.value + 1, n - 1);
          else if (e.translationX > width * FLIP_RATIO || e.velocityX > FLIP_VELOCITY) next = Math.max(page.value - 1, 0);
          if (next !== page.value) {
            page.value = next;
            scale.value = 1;
            tx.value = 0;
            ty.value = 0;
            runOnJS(setCurrent)(next);
          }
          pagerX.value = withTiming(-next * width, SNAP);
        } else if (mode.value === MODE_PHOTO) {
          // Let the photo keep gliding, stopped by its own edges.
          const l = limits(scale.value);
          tx.value = withDecay({ velocity: e.velocityX, clamp: [-l.x, l.x] });
          ty.value = withDecay({ velocity: e.velocityY, clamp: [-l.y, l.y] });
        } else if (mode.value === MODE_DISMISS) {
          if (e.translationY > CLOSE_DRAG || e.velocityY > CLOSE_VELOCITY) dismiss();
          else letGo();
        }
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(260)
      .maxDistance(24)
      .onEnd((e) => {
        if (scale.value > 1.01) {
          fit();
          return;
        }
        // Zoom in on what was tapped, not on the middle of the screen.
        const fx = e.x - width / 2;
        const fy = e.y - height / 2;
        const l = limits(TAP_SCALE);
        scale.value = withTiming(TAP_SCALE, SNAP);
        tx.value = withTiming(clamp(fx - fx * TAP_SCALE, -l.x, l.x), SNAP);
        ty.value = withTiming(clamp(fy - fy * TAP_SCALE, -l.y, l.y), SNAP);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(260)
      .maxDistance(24)
      .onEnd(() => {
        runOnJS(setChrome)(!chrome);
      });

    // Simultaneous, never Exclusive, between the taps and the drag: an
    // Exclusive tap makes every drag wait for the tap to time out, which is
    // what killed swiping before. The two taps race only with each other.
    return Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, singleTap));
  }, [width, height, imgH, n, chrome, onClose]);

  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pagerX.value + dragX.value }, { translateY: dragY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: clamp(1 - Math.abs(dragY.value) / (height * 0.7) - Math.max(0, 1 - shrink.value) * 2, 0.15, 1),
  }));

  if (index == null) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* A Modal is its own view root on native — gestures inside it are dead without this. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]} />
          <GestureDetector gesture={gesture}>
            <Animated.View style={{ flex: 1, overflow: 'hidden' }}>
              <Animated.View testID="photo-pager" style={[{ width: width * n, height }, pagerStyle]}>
                {urls.map((u, i) => (
                  <Page
                    key={`${i}-${u}`}
                    uri={u}
                    i={i}
                    width={width}
                    height={height}
                    imgH={imgH}
                    page={page}
                    scale={scale}
                    tx={tx}
                    ty={ty}
                    shrink={shrink}
                  />
                ))}
              </Animated.View>
            </Animated.View>
          </GestureDetector>
          {chrome ? (
            <>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityLabel={t('viewer.close')}
                style={{
                  position: 'absolute',
                  top: 54,
                  right: 18,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
              <View
                style={{ position: 'absolute', bottom: 36, alignSelf: 'center', alignItems: 'center', gap: 4 }}
                pointerEvents="none"
              >
                {n > 1 ? (
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                    {current + 1} / {n}
                  </Text>
                ) : null}
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{t('viewer.hint')}</Text>
              </View>
            </>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
