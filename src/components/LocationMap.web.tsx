import { createElement, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { mapsUrl, tileGrid } from '@/lib/maps';

/**
 * Web: react-native-maps has no web build, so draw OpenStreetMap tiles with a
 * pin — the same static map the PDF uses. (OSM's embed page was tried first,
 * but its "Report a problem / Make a Donation" credits cover half a small map.)
 * A tap opens Google Maps, same as the phone versions.
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
        ? tileGrid(lat, lng, width, height).map((t) =>
            createElement('img', {
              key: t.url,
              src: t.url,
              alt: '',
              draggable: false,
              style: { position: 'absolute', left: t.left, top: t.top, width: t.size, height: t.size },
            })
          )
        : null}
      {createElement(
        'svg',
        {
          width: 26,
          height: 34,
          viewBox: '0 0 26 34',
          style: { position: 'absolute', left: width / 2 - 13, top: height / 2 - 32 },
        },
        createElement('path', {
          d: 'M13 1C6.4 1 1 6.3 1 12.8 1 21.6 13 33 13 33s12-11.4 12-20.2C25 6.3 19.6 1 13 1z',
          fill: '#dc2626',
          stroke: '#fff',
          strokeWidth: 2,
        }),
        createElement('circle', { cx: 13, cy: 12.5, r: 4.5, fill: '#fff' })
      )}
      <View
        style={{
          position: 'absolute',
          right: 4,
          bottom: 3,
          backgroundColor: 'rgba(255,255,255,0.85)',
          paddingHorizontal: 4,
          borderRadius: 3,
        }}
      >
        <Text style={{ fontSize: 8, color: '#6b7280' }}>© OpenStreetMap</Text>
      </View>
    </Pressable>
  );
}
