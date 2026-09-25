import { useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native';
import MapView, { Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { PrimaryButton, SecondaryButton, useThemeColors } from '@/components/ui';

export interface PinnedLocation { lat: number; lng: number; radiusM: number }

const DEFAULT_CENTER = { lat: 33.3152, lng: 44.3661 }; // Baghdad

/**
 * Native branch-location picker: move the map, the pin stays centred, tap save.
 * Pinned from head office by moving the map, or — standing in the branch —
 * with "My location".
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
  const [center, setCenter] = useState({ lat: start.lat, lng: start.lng });
  const [radius, setRadius] = useState(start.radiusM);
  const mapRef = useRef<MapView>(null);
  const [locating, setLocating] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);

  const locate = async () => {
    setLocating(true);
    setGpsNote(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setGpsNote(t('branchLoc.gpsDenied')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      mapRef.current?.animateToRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.002, longitudeDelta: 0.002 }, 400);
      if (pos.coords.accuracy != null) setGpsNote(t('branchLoc.gpsAccuracy', { m: Math.round(pos.coords.accuracy) }));
    } catch {
      setGpsNote(t('branchLoc.gpsFailed'));
    } finally {
      setLocating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 50 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{t('branchLoc.title')}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={26} color={c.textMuted} /></Pressable>
        </View>
        <Text style={{ fontSize: 13, color: c.textMuted, paddingHorizontal: 16, marginBottom: 10 }}>{t('branchLoc.hint')}</Text>

        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={{ latitude: start.lat, longitude: start.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
            onRegionChangeComplete={(r) => setCenter({ lat: r.latitude, lng: r.longitude })}
          >
            <Circle center={{ latitude: center.lat, longitude: center.lng }} radius={radius}
              strokeColor="rgba(0,48,78,0.8)" fillColor="rgba(0,48,78,0.15)" />
          </MapView>
          {/* Fixed centre pin — the map moves under it. */}
          <View pointerEvents="none" style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -16, marginTop: -34 }}>
            <Ionicons name="location" size={34} color="#E8141A" />
          </View>
          <Pressable
            onPress={locate}
            disabled={locating}
            style={{ position: 'absolute', bottom: 16, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, opacity: locating ? 0.6 : 1 }}
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
          <PrimaryButton title={t('branchLoc.save')} onPress={() => onSave({ lat: center.lat, lng: center.lng, radiusM: radius })} />
          <SecondaryButton title={t('branchLoc.cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
