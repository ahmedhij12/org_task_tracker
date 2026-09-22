import { useState } from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import MapView, { Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { PrimaryButton, SecondaryButton, useThemeColors } from '@/components/ui';

export interface PinnedLocation { lat: number; lng: number; radiusM: number }

const DEFAULT_CENTER = { lat: 33.3152, lng: 44.3661 }; // Baghdad

/**
 * Native branch-location picker: move the map, the pin stays centred, tap save.
 * The admin pins a branch from wherever they are (head office), so this never
 * asks for the device's own location.
 */
export function BranchLocationPicker({ visible, initial, onSave, onClose }: {
  visible: boolean;
  initial?: PinnedLocation | null;
  onSave: (loc: PinnedLocation) => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const start = initial ?? { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng, radiusM: 40 };
  const [center, setCenter] = useState({ lat: start.lat, lng: start.lng });
  const [radius, setRadius] = useState(start.radiusM);

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
        </View>

        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 13, color: c.textMuted, flex: 1 }}>{t('branchLoc.radius', { m: radius })}</Text>
            {[30, 40, 60, 100].map((m) => (
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
