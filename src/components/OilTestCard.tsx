import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOilTests } from '@/hooks/useOilTests';
import { OilTestSheet } from '@/components/OilTestSheet';
import { useThemeColors } from '@/components/ui';

const GRADE_HEX = { good: '#10B981', watch: '#F59E0B', change: '#E8141A' } as const;

/** Dashboard card for supervisors/managers: today's oil-test count and a way
 * to run another one (they test several times a day). */
export function OilTestCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { tests } = useOilTests();
  const [open, setOpen] = useState(false);

  const todays = useMemo(() => {
    const today = new Date().toDateString();
    return tests.filter((x) => new Date(x.testedAt).toDateString() === today);
  }, [tests]);
  const worst = todays.some((x) => x.grade === 'change') ? 'change' : todays.some((x) => x.grade === 'watch') ? 'watch' : todays.length ? 'good' : null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: worst ? GRADE_HEX[worst] + '22' : c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="thermometer" size={22} color={worst ? GRADE_HEX[worst] : c.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{t('oil.cardTitle')}</Text>
          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t('oil.todayTests', { count: todays.length })}</Text>
        </View>
        <Ionicons name="add-circle" size={28} color={c.brand} />
      </Pressable>
      <OilTestSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
