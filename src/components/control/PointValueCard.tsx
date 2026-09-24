import { View, Text } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

/** 1 point = X IQD, company-wide. Moved here from Settings unchanged. */
export function PointValueCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { organization, setIqdPerPoint } = useAuth();
  const [rateText, setRateText] = useState(String(organization?.iqdPerPoint ?? ''));
  const [savingRate, setSavingRate] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  const parsedRate = Number(rateText.replace(/,/g, '').trim());
  const rateValid = rateText.trim() !== '' && Number.isFinite(parsedRate) && parsedRate > 0;

  const handleSaveRate = async () => {
    if (!rateValid || savingRate) return;
    setSavingRate(true);
    setRateNotice(null);
    setRateError(null);
    try {
      await setIqdPerPoint(parsedRate);
      setRateText(String(parsedRate));
      setRateNotice(t('settings.rateSaved', { rate: parsedRate.toLocaleString() }));
    } catch (e: any) {
      setRateError(e?.message ?? t('settings.rateFailed'));
    } finally {
      setSavingRate(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('settings.pointValue')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>
        {t('settings.pointValueHint', { rate: (organization?.iqdPerPoint ?? 0).toLocaleString() })}
      </Text>
      {rateError ? <ErrorBanner message={rateError} /> : null}
      {rateNotice ? (
        <View style={{ backgroundColor: c.brandSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ color: c.brand, fontSize: 13 }}>{rateNotice}</Text>
        </View>
      ) : null}
      <FieldInput
        placeholder="25000"
        value={rateText}
        onChangeText={(v) => {
          setRateText(v);
          setRateNotice(null);
        }}
        keyboardType="number-pad"
      />
      <PrimaryButton
        title={t('settings.savePointValue')}
        onPress={handleSaveRate}
        loading={savingRate}
        disabled={!rateValid || parsedRate === organization?.iqdPerPoint}
      />
    </Card>
  );
}
