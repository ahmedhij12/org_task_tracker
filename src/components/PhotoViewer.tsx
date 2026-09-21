import { useEffect, useRef, useState } from 'react';
import { Modal, View, Image, Pressable, ScrollView, Text, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const ZOOM = 3;

/**
 * One photo that can be zoomed to inspect detail. iPhone: native pinch-zoom
 * and pan. Web/Android (no native pinch in a ScrollView there): tap to zoom
 * 3×, drag to look around, tap again to zoom back out.
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
  const [zoomed, setZoomed] = useState(false);
  const hRef = useRef<ScrollView>(null);
  const vRef = useRef<ScrollView>(null);
  const imgH = height * 0.85;

  if (Platform.OS === 'ios') {
    return (
      <ScrollView
        style={{ width, height }}
        contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
        bouncesZoom
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => onZoomChange((e.nativeEvent.zoomScale ?? 1) > 1.01)}
        scrollEventThrottle={50}
      >
        <Image source={{ uri }} style={{ width, height: imgH }} resizeMode="contain" />
      </ScrollView>
    );
  }

  const toggle = () => {
    setZoomed((z) => !z);
    onZoomChange(!zoomed);
  };

  if (!zoomed) {
    return (
      <Pressable onPress={toggle} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Image source={{ uri }} style={{ width, height: imgH }} resizeMode="contain" />
      </Pressable>
    );
  }

  // Zoomed: the photo drawn 3× larger inside two nested scrollers, scrolled
  // to its centre once laid out (contentOffset isn't honoured on web).
  return (
    <ScrollView
      ref={hRef}
      horizontal
      style={{ width, height }}
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => hRef.current?.scrollTo({ x: (width * ZOOM - width) / 2, animated: false })}
    >
      <ScrollView
        ref={vRef}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => vRef.current?.scrollTo({ y: (imgH * ZOOM - height) / 2, animated: false })}
      >
        <Pressable onPress={toggle}>
          <Image source={{ uri }} style={{ width: width * ZOOM, height: imgH * ZOOM }} resizeMode="contain" />
        </Pressable>
      </ScrollView>
    </ScrollView>
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
            {Platform.OS === 'ios' ? t('viewer.pinch') : zoomed ? t('viewer.drag') : t('viewer.tap')}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
