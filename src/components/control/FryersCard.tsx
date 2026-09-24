import { Text } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FryersSheet } from '@/components/FryersSheet';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';

/** Fryers per branch — the sheet picks the branch first. Moved here from Settings unchanged. */
export function FryersCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [managingFryers, setManagingFryers] = useState(false);

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('oil.fryersCardTitle')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 12 }}>{t('oil.fryersCardHint')}</Text>
      <PrimaryButton title={t('oil.manageFryers')} onPress={() => setManagingFryers(true)} />
      <FryersSheet visible={managingFryers} onClose={() => setManagingFryers(false)} />
    </Card>
  );
}
