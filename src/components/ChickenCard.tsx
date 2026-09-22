import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChicken } from '@/hooks/useChicken';
import { ChickenSheet } from '@/components/ChickenSheet';
import { useThemeColors } from '@/components/ui';

/** Dashboard card for supervisors/managers to record a chicken marination. */
export function ChickenCard({ isAudit }: { isAudit?: boolean } = {}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { records } = useChicken();
  const [open, setOpen] = useState(false);

  const todays = useMemo(() => {
    const today = new Date().toDateString();
    return records.filter((x) => new Date(x.marinatedAt).toDateString() === today).length;
  }, [records]);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="restaurant" size={22} color={c.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{t('chicken.cardTitle')}</Text>
          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t('chicken.todayCount', { count: todays })}</Text>
        </View>
        <Ionicons name="add-circle" size={28} color={c.brand} />
      </Pressable>
      <ChickenSheet visible={open} isAudit={isAudit} onClose={() => setOpen(false)} />
    </>
  );
}
