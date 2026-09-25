import { useState } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { Card, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { SettingRow, parseSetting } from '@/components/control/SettingRow';

/**
 * Marination hours and the two graces. They are separate on purpose: early =
 * pulled before its time (under-marinated, a food-safety breach, keep it
 * tight); late = forgotten (can be generous). The reminder follows the hours.
 */
export function MarinationRulesCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { settings, save } = useOrgSettings();
  const [hours, setHours] = useState<string | null>(null);
  const [early, setEarly] = useState<string | null>(null);
  const [late, setLate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const h = hours == null ? settings.marinationHours : parseSetting(hours, 0.5, 12, true);
  const e = early == null ? settings.marinationEarlyGraceMin : parseSetting(early, 0, 120);
  const l = late == null ? settings.marinationLateGraceMin : parseSetting(late, 0, 240);
  const valid = h != null && e != null && l != null;
  const dirty = hours != null || early != null || late != null;

  const onSave = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await save({ marinationHours: h!, marinationEarlyGraceMin: e!, marinationLateGraceMin: l! });
      setHours(null);
      setEarly(null);
      setLate(null);
      setNotice(t('control.saved'));
    } catch (err: any) {
      setError(err?.message ?? t('control.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('control.marinationTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('control.marinationHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <SettingRow label={t('control.marinationHours')} value={settings.marinationHours} unit={t('control.unitHours')} decimal onChange={setHours} testID="setting-marination-hours" />
      <SettingRow label={t('control.earlyGrace')} hint={t('control.earlyGraceHint')} value={settings.marinationEarlyGraceMin} unit={t('control.unitMin')} onChange={setEarly} />
      <SettingRow label={t('control.lateGrace')} hint={t('control.lateGraceHint')} value={settings.marinationLateGraceMin} unit={t('control.unitMin')} onChange={setLate} />
      {/* The early side is the dangerous one: never let it be looser than the late side unnoticed. */}
      {e != null && l != null && e > l ? (
        <Text style={{ fontSize: 12, color: c.amber, marginTop: 8 }}>{t('control.earlyLooserWarning')}</Text>
      ) : null}
      {!valid && dirty ? <Text style={{ fontSize: 12, color: c.rose, marginTop: 8 }}>{t('control.invalidNumbers')}</Text> : null}
      {notice ? <Text style={{ fontSize: 12, color: c.brand, marginTop: 8 }}>{notice}</Text> : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton title={t('control.save')} onPress={onSave} loading={busy} disabled={!valid || !dirty} />
      </View>
    </Card>
  );
}
