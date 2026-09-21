import { useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mapsUrl, tileGrid } from '@/lib/maps';

// OpenStreetMap asks apps to identify themselves; Android's default HTTP
// client user agent is generic and can be refused.
const TILE_HEADERS = { 'User-Agent': 'Rungs/1.0 (+https://rungs.hijazionline.com)' };

/**
 * Android: react-native-maps draws with Google Maps there, which needs a
 * Google Cloud API key. This draws the same OpenStreetMap picture the PDF
 * uses instead — no key — and tapping opens the Google Maps app.
 */
export function LocationMap({ lat, lng, height = 150 }: { lat: number; lng: number; height?: number }) {
  const [width, setWidth] = useState(0);
  return (
    <Pressable
      onPress={() => Linking.openURL(mapsUrl(lat, lng))}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: '#eef0f3' }}
    >
      {width > 0
        ? tileGrid(lat, lng, width, height).map((t) => (
            <Image
              key={t.url}
              source={{ uri: t.url, headers: TILE_HEADERS }}
              style={{ position: 'absolute', left: t.left, top: t.top, width: t.size, height: t.size }}
            />
          ))
        : null}
      <View style={{ position: 'absolute', left: width / 2 - 14, top: height / 2 - 28 }}>
        <Ionicons name="location-sharp" size={28} color="#dc2626" />
      </View>
      <Text
        style={{
          position: 'absolute',
          right: 4,
          bottom: 3,
          fontSize: 8,
          color: '#6b7280',
          backgroundColor: 'rgba(255,255,255,0.85)',
          paddingHorizontal: 3,
          borderRadius: 3,
        }}
      >
        © OpenStreetMap contributors
      </Text>
    </Pressable>
  );
}
