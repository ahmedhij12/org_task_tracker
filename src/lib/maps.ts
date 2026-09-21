import { Platform } from 'react-native';

/** Opens the phone's own maps app: Apple Maps on iPhone, Google Maps on Android and the web. */
export function mapsUrl(lat: number, lng: number): string {
  if (Platform.OS === 'ios') return `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * OpenStreetMap tiles laid out so (lat, lng) sits at the centre of a
 * width×height box. Fetches one zoom level deeper and draws each tile at
 * half size so it stays sharp on high-density screens and in print.
 */
export function tileGrid(lat: number, lng: number, width: number, height: number, zoom = 16) {
  const tileZoom = zoom + 1;
  const size = 128;
  const n = 2 ** tileZoom;
  const px = ((lng + 180) / 360) * n * size;
  const latRad = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * size;
  const originX = px - width / 2;
  const originY = py - height / 2;
  const tiles: { url: string; left: number; top: number; size: number }[] = [];
  for (let tx = Math.floor(originX / size); tx <= Math.floor((originX + width) / size); tx += 1) {
    for (let ty = Math.floor(originY / size); ty <= Math.floor((originY + height) / size); ty += 1) {
      tiles.push({
        url: `https://tile.openstreetmap.org/${tileZoom}/${tx}/${ty}.png`,
        left: Math.round(tx * size - originX),
        top: Math.round(ty * size - originY),
        size,
      });
    }
  }
  return tiles;
}
