import { useEffect, useRef, useState } from 'react';
import { Modal, View, Pressable, ScrollView, Text, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';

const MAX_ZOOM = 5;
/** What a double tap jumps to. */
const TAP_ZOOM = 2.5;

/**
 * One photo, zoomed the way every photo app does it: pinch with two fingers,
 * double tap a spot to jump in on it, drag to look around. Gesture-handler and
 * reanimated drive it, so a browser, an iPhone and an Android all behave the
 * same — the old version used a native ScrollView on iOS and a tap-to-zoom
 * fallback everywhere else, which on the web build zoomed but would not move.
 */
function ZoomablePhoto({
  uri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const imgH = height * 0.85;

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  // How far the photo may be dragged before its edge comes past the screen.
  const clamp = (v: number, limit: number) => {
    'worklet';
    return Math.min(limit, Math.max(-limit, v));
  };
  const limitX = (s: number) => {
    'worklet';
    return Math.max(0, (width * s - width) / 2);
  };
  const limitY = (s: number) => {
    'worklet';
    return Math.max(0, (imgH * s - height) / 2);
  };

  const settle = () => {
    'worklet';
    if (scale.value < 1) {
      scale.value = withTiming(1);
      x.value = withTiming(0);
      y.value = withTiming(0);
    } else if (scale.value > MAX_ZOOM) {
      scale.value = withTiming(MAX_ZOOM);
    }
    x.value = withTiming(clamp(x.value, limitX(Math.min(scale.value, MAX_ZOOM))));
    y.value = withTiming(clamp(y.value, limitY(Math.min(scale.value, MAX_ZOOM))));
    runOnJS(onZoomChange)(scale.value > 1.01);
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.5, Math.min(MAX_ZOOM + 0.5, startScale.value * e.scale));
    })
    .onEnd(settle);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      // Only meaningful once there is something off-screen to look at; below
      // that the pager's own swipe should win.
      if (scale.value <= 1.01) return;
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    })
    .onEnd(settle);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onEnd((e) => {
      if (scale.value > 1.01) {
        scale.value = withTiming(1);
        x.value = withTiming(0);
        y.value = withTiming(0);
        runOnJS(onZoomChange)(false);
        return;
      }
      // Zoom toward the spot that was tapped, not the middle of the photo.
      const dx = (width / 2 - e.x) * (TAP_ZOOM - 1);
      const dy = (height / 2 - e.y) * (TAP_ZOOM - 1);
      scale.value = withTiming(TAP_ZOOM);
      x.value = withTiming(clamp(dx, limitX(TAP_ZOOM)));
      y.value = withTiming(clamp(dy, limitY(TAP_ZOOM)));
      runOnJS(onZoomChange)(true);
    });

  // Pinch and drag run together; the double tap races them.
  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Animated.View style={style}>
          <Image source={{ uri }} style={{ width, height: imgH }} contentFit="contain" transition={120} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** Full-screen photo viewer: swipe between photos, zoom in to inspect, tap × to close. */
export function PhotoViewer({ urls, index, onClose }: { urls: string[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const [current, setCurrent] = useState(index ?? 0);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (index == null) return;
    setCurrent(index);
    setZoomed(false);
    // Jump to the tapped photo once the pager has laid out.
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: index * width, animated: false }));
  }, [index, width]);

  if (index == null) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
          onScroll={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
          scrollEventThrottle={100}
        >
          {urls.map((u) => (
            <ZoomablePhoto key={u} uri={u} width={width} height={height} onZoomChange={setZoomed} />
          ))}
        </ScrollView>
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
        <View style={{ position: 'absolute', bottom: 36, alignSelf: 'center', alignItems: 'center', gap: 4 }} pointerEvents="none">
          {urls.length > 1 && !zoomed ? (
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
              {current + 1} / {urls.length}
            </Text>
          ) : null}
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
            {zoomed ? t('viewer.drag') : t('viewer.pinch')}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
