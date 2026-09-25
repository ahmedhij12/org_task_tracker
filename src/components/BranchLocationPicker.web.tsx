import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { PrimaryButton, SecondaryButton, useThemeColors } from '@/components/ui';

export interface PinnedLocation { lat: number; lng: number; radiusM: number }

const DEFAULT_CENTER = { lat: 33.3152, lng: 44.3661 }; // Baghdad
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`) as HTMLScriptElement | null;
    if (existing) { existing.addEventListener('load', () => resolve((window as any).L)); return; }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload = () => resolve((window as any).L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Web branch-location picker: a real draggable map; the pin stays in the
 * centre and the map moves under it. Pinned from head office by moving the
 * map, or — standing in the branch — with "My location" (his request,
 * 2026-09-25: there was no way to use the phone's own position).
 */
export function BranchLocationPicker({ visible, initial, onSave, onClose }: {
  visible: boolean;
  initial?: PinnedLocation | null;
  onSave: (loc: PinnedLocation) => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const start = initial ?? { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng, radiusM: 15 };
  const holderRef = useRef<View>(null);
  const mapRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const layersRef = useRef<{ satellite: any; street: any } | null>(null);
  const centerRef = useRef({ lat: start.lat, lng: start.lng });
  const [radius, setRadius] = useState(start.radiusM);
  const [ready, setReady] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const [locating, setLocating] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);

  // Standing in the branch: jump the map to where the phone is. The pin is
  // the map's centre, so the branch is then one tap on Save away.
  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setGpsNote(t('branchLoc.gpsFailed')); return; }
    setLocating(true);
    setGpsNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 18);
        setGpsNote(t('branchLoc.gpsAccuracy', { m: Math.round(pos.coords.accuracy) }));
      },
      (err) => {
        setLocating(false);
        setGpsNote(err?.code === 1 ? t('branchLoc.gpsDenied') : t('branchLoc.gpsFailed'));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet().catch(() => null);
      if (!L || cancelled) return;
      const holder = holderRef.current as unknown as HTMLElement | null;
      if (!holder) return;
      const div = document.createElement('div');
      div.style.cssText = 'width:100%;height:100%;';
      holder.replaceChildren(div);
      const map = L.map(div, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], 18);
      // Satellite by default: you can see the actual building, which makes
      // pinning a branch far more accurate than a sparse street map.
      // Esri has photos down to zoom 18 in every branch town (checked
      // 2026-09-26: Baghdad, Karbala, Samawah, Nasiriyah) but zoom 19 comes
      // back as a grey "Map data not yet available" tile outside Baghdad (his
      // screenshot). Past 18 Leaflet now stretches the zoom-18 photo instead of
      // asking for tiles that do not exist.
      const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, maxNativeZoom: 18, attribution: 'Esri' }
      );
      const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap',
      });
      satellite.addTo(map);
      layersRef.current = { satellite, street };
      const circle = L.circle([start.lat, start.lng], { radius: start.radiusM, color: '#00304E', fillColor: '#00304E', fillOpacity: 0.15 }).addTo(map);
      mapRef.current = map; circleRef.current = circle;
      map.on('move', () => {
        const ctr = map.getCenter();
        centerRef.current = { lat: ctr.lat, lng: ctr.lng };
        circle.setLatLng(ctr);
      });
      setTimeout(() => map.invalidateSize(), 150);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      try { mapRef.current?.remove(); } catch { /* already gone */ }
      mapRef.current = null; circleRef.current = null;
    };
  }, [visible]);

  useEffect(() => { circleRef.current?.setRadius(radius); }, [radius]);

  // Swap the base layer without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current; const layers = layersRef.current;
    if (!map || !layers) return;
    const show = satellite ? layers.satellite : layers.street;
    const hide = satellite ? layers.street : layers.satellite;
    if (map.hasLayer(hide)) map.removeLayer(hide);
    if (!map.hasLayer(show)) show.addTo(map);
  }, [satellite, ready]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{t('branchLoc.title')}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={26} color={c.textMuted} /></Pressable>
        </View>
        <Text style={{ fontSize: 13, color: c.textMuted, paddingHorizontal: 16, marginBottom: 10 }}>{t('branchLoc.hint')}</Text>

        <View style={{ flex: 1 }}>
          <View ref={holderRef} style={{ flex: 1, backgroundColor: c.bgSubtle }} />
          {/* Fixed centre pin — the map moves under it. */}
          <View pointerEvents="none" style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -17, marginTop: -34 }}>
            <Ionicons name="location" size={34} color="#E8141A" />
          </View>
          <Pressable
            onPress={() => setSatellite((v) => !v)}
            style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.border }}
          >
            <Ionicons name={satellite ? 'map' : 'globe'} size={15} color={c.brand} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: c.brand }}>
              {satellite ? t('branchLoc.showStreet') : t('branchLoc.showSatellite')}
            </Text>
          </Pressable>
          <Pressable
            testID="branch-loc-gps"
            onPress={locate}
            disabled={locating || !ready}
            style={{ position: 'absolute', bottom: 16, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, opacity: locating || !ready ? 0.6 : 1 }}
          >
            {locating ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="locate" size={16} color="#fff" />}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{t('branchLoc.myLocation')}</Text>
          </Pressable>
        </View>
        {gpsNote ? <Text style={{ fontSize: 12, color: c.textMuted, paddingHorizontal: 16, paddingTop: 8 }}>{gpsNote}</Text> : null}

        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 13, color: c.textMuted, flex: 1 }}>{t('branchLoc.radius', { m: radius })}</Text>
            {[15, 25, 40, 60].map((m) => (
              <Pressable key={m} onPress={() => setRadius(m)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: radius === m ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: radius === m ? c.brand : c.border }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: radius === m ? '#fff' : c.text }}>{m}m</Text>
              </Pressable>
            ))}
          </View>
          <PrimaryButton title={t('branchLoc.save')} disabled={!ready}
            onPress={() => onSave({ lat: centerRef.current.lat, lng: centerRef.current.lng, radiusM: radius })} />
          <SecondaryButton title={t('branchLoc.cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
