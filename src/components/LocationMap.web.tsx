import { createElement } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { mapsUrl } from '@/lib/maps';

/**
 * Web: react-native-maps has no web build, so embed OpenStreetMap's own map
 * page with a marker. The iframe ignores clicks so a tap opens Google Maps,
 * same as the phone versions.
 */
export function LocationMap({ lat, lng, height = 150 }: { lat: number; lng: number; height?: number }) {
  const d = 0.003;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <Pressable onPress={() => Linking.openURL(mapsUrl(lat, lng))} style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ flex: 1 }}>
        {createElement('iframe', {
          src,
          title: 'Signing location',
          style: { border: 0, width: '100%', height: '100%', pointerEvents: 'none' },
          loading: 'lazy',
        })}
      </View>
    </Pressable>
  );
}
