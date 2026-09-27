import { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOilTests } from '@/hooks/useOilTests';
import { useAlertsSeen } from '@/hooks/useAlertsSeen';
import type { OilTest } from '@/types';

const CHANGE = '#E8141A';

/** Admin/manager alert: how many fryers currently read "change the oil". Only
 * shows when at least one does — routine good/watch tests stay quiet in History.
 * An admin or the hygiene auditor can hide it once seen; a fryer comes back
 * when a newer test still reads "change". */
export function OilAlert() {
  const { t } = useTranslation();
  const { tests } = useOilTests();
  const { canMark, isNew, markSeen } = useAlertsSeen();

  const needChange = useMemo(() => {
    const latest = new Map<string, OilTest>();
    for (const x of tests) if (!latest.has(x.fryerId)) latest.set(x.fryerId, x); // newest-first
    return [...latest.values()].filter((x) => x.grade === 'change' && isNew('oil_change', x.testedAt));
  }, [tests, isNew]);

  if (needChange.length === 0) return null;
  const newest = needChange.reduce((max, x) => (x.testedAt > max ? x.testedAt : max), needChange[0].testedAt);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: CHANGE + '18', borderWidth: 1, borderColor: CHANGE + '55' }}>
      <Ionicons name="warning" size={24} color={CHANGE} />
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '800', color: CHANGE }}>{t('oil.needChange', { count: needChange.length })}</Text>
      {canMark ? (
        <Pressable testID="oil-alert-seen" onPress={() => markSeen('oil_change', newest)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('oil.alertSeen')}>
          <Ionicons name="close" size={22} color={CHANGE} />
        </Pressable>
      ) : null}
    </View>
  );
}
