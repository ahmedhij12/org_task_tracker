import { Linking, Pressable, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { mapsUrl } from '@/lib/maps';

/** A small, non-interactive map with a pin; tapping it opens the full map app. */
export function LocationMap({ lat, lng, height = 150 }: { lat: number; lng: number; height?: number }) {
  return (
    <Pressable onPress={() => Linking.openURL(mapsUrl(lat, lng))} style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ flex: 1 }}>
        <MapView
          style={{ flex: 1 }}
          liteMode
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
          region={{ latitude: lat, longitude: lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} />
        </MapView>
      </View>
    </Pressable>
  );
}
