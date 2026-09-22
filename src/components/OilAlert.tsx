import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOilTests } from '@/hooks/useOilTests';
import { useThemeColors } from '@/components/ui';
import type { OilTest } from '@/types';

const CHANGE = '#E8141A';

/** Admin/manager alert: how many fryers currently read "change the oil". Only
 * shows when at least one does — routine good/watch tests stay quiet in History. */
export function OilAlert() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { tests } = useOilTests();

  const needChange = useMemo(() => {
    const latest = new Map<string, OilTest>();
    for (const x of tests) if (!latest.has(x.fryerId)) latest.set(x.fryerId, x); // newest-first
    return [...latest.values()].filter((x) => x.grade === 'change').length;
  }, [tests]);

  if (needChange === 0) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: CHANGE + '18', borderWidth: 1, borderColor: CHANGE + '55' }}>
      <Ionicons name="warning" size={24} color={CHANGE} />
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '800', color: CHANGE }}>{t('oil.needChange', { count: needChange })}</Text>
    </View>
  );
}
