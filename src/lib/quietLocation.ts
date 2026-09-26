import { Dimensions, Platform } from 'react-native';
import * as Location from 'expo-location';
import { resolveAddress } from '@/lib/placeName';

/**
 * Where a watched admin's phone is (admins and the hygiene auditor — see
 * isWatchedAdmin), for the super admin's activity record. Read ONLY when the
 * phone already allows location: this never asks (his call, 2026-09-26).
 * The latest reading rides on every database request as the `x-geo` header
 * (see supabase.ts), so each activity line — screens opened and changes
 * made — keeps it (2026-09-26-activity-location.sql). Nobody else's app
 * reads anything.
 */
type Reading = {
  s: 'ok' | 'denied' | 'ask' | 'none';
  lat?: number;
  lng?: number;
  acc?: number;
  place?: string;
  at?: string;
  sw?: number;
  sh?: number;
};

let active = false;
let header: string | null = null;
let inflight: Promise<void> | null = null;
let firstDone: Promise<void> | null = null;
const places = new Map<string, string | null>();

/** The header value for the next request, or null (not a watched admin / nothing read yet). */
export function geoHeader(): string | null {
  return active ? header : null;
}

export function startQuietLocation(): void {
  if (active) return;
  active = true;
  firstDone = refreshQuietLocation();
}

export function stopQuietLocation(): void {
  active = false;
  header = null;
  firstDone = null;
}

/** Resolves once the first reading after start has been tried (at most ~12 s). */
export function whenLocationTried(): Promise<void> {
  return firstDone ? withTimeout(firstDone, 12000).catch(() => {}) : Promise.resolve();
}

export function refreshQuietLocation(): Promise<void> {
  if (!active) return Promise.resolve();
  if (!inflight) {
    inflight = read()
      .then((r) => {
        if (active) header = encode(r);
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function read(): Promise<Reading> {
  const screen = screenSize();
  const perm = await permissionState();
  if (perm !== 'granted') return { s: perm === 'denied' ? 'denied' : perm === 'prompt' ? 'ask' : 'none', ...screen };
  const pos = await position().catch(() => null);
  if (!pos) return { s: 'none', ...screen };
  const key = `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}`;
  if (!places.has(key)) places.set(key, await withTimeout(resolveAddress(pos.lat, pos.lng), 6000).catch(() => null));
  return { s: 'ok', ...pos, place: places.get(key) ?? undefined, at: new Date().toISOString(), ...screen };
}

async function permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (Platform.OS !== 'web') {
    const p = await Location.getForegroundPermissionsAsync().catch(() => null);
    return p?.granted ? 'granted' : p?.canAskAgain === false ? 'denied' : 'prompt';
  }
  // Without the Permissions API there is no way to know it would not ask — so don't read.
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return (st?.state as 'granted' | 'denied' | 'prompt' | undefined) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function position(): Promise<{ lat: number; lng: number; acc: number }> {
  if (Platform.OS !== 'web') {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? 0 };
  }
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    ),
  );
}

/** Portrait width × height in points: which size of phone, not the model (the web is never told the model). */
function screenSize(): { sw?: number; sh?: number } {
  const w = Platform.OS === 'web' && typeof window !== 'undefined' ? window.screen?.width : Dimensions.get('screen').width;
  const h = Platform.OS === 'web' && typeof window !== 'undefined' ? window.screen?.height : Dimensions.get('screen').height;
  if (!w || !h) return {};
  return { sw: Math.round(Math.min(w, h)), sh: Math.round(Math.max(w, h)) };
}

// base64 of UTF-8 JSON: a header must be plain ASCII, and the place can be Arabic.
function encode(r: Reading): string {
  const bytes = new TextEncoder().encode(JSON.stringify(r));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
