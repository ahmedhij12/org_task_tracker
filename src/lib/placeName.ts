import { Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * "Street, area, city" for a point — the phone's own geocoder natively, the
 * free OpenStreetMap one on the web. Null when nothing comes back. Used where
 * a checklist is signed and for the admin-activity locations.
 */
export async function resolveAddress(lat: number, lng: number): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!place) return null;
    return [place.street ?? place.name, place.district, place.city].filter(Boolean).join(', ') || null;
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}&accept-language=en,ar`
  );
  if (!res.ok) return null;
  const json = await res.json();
  const a = json?.address ?? {};
  return (
    [a.road ?? a.pedestrian ?? a.neighbourhood, a.suburb ?? a.city_district, a.city ?? a.town ?? a.village]
      .filter(Boolean)
      .join(', ') ||
    json?.display_name ||
    null
  );
}
