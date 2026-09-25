import { useState } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { Card, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { SettingRow, parseSetting } from '@/components/control/SettingRow';

/**
 * The flat amount each automatic penalty costs. Nothing to do with points.
 * A penalty keeps the amount it was given with, so a change here only
 * affects penalties from now on.
 */
export function PenaltyAmountsCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { settings, save, loaded } = useOrgSettings();
  const [checklist, setChecklist] = useState<string | null>(null);
  const [marination, setMarination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const a = checklist == null ? settings.lateChecklistPenaltyIqd : parseSetting(checklist, 0, 100000000);
  const b = marination == null ? settings.marinationPenaltyIqd : parseSetting(marination, 0, 100000000);
  const valid = a != null && b != null;
  const dirty = checklist != null || marination != null;

  const onSave = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await save({
        ...(checklist != null ? { lateChecklistPenaltyIqd: a! } : {}),
        ...(marination != null ? { marinationPenaltyIqd: b! } : {}),
      });
      setChecklist(null);
      setMarination(null);
      setNotice(t('control.saved'));
    } catch (err: any) {
      setError(err?.message ?? t('control.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('control.penaltiesTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('control.penaltiesHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <SettingRow label={t('control.lateChecklistPenalty')} value={settings.lateChecklistPenaltyIqd} unit="IQD" onChange={setChecklist} />
      <SettingRow label={t('control.marinationPenalty')} value={settings.marinationPenaltyIqd} unit="IQD" onChange={setMarination} />
      {!valid && dirty ? <Text style={{ fontSize: 12, color: c.rose, marginTop: 8 }}>{t('control.invalidNumbers')}</Text> : null}
      {notice ? <Text style={{ fontSize: 12, color: c.brand, marginTop: 8 }}>{notice}</Text> : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton title={t('control.save')} onPress={onSave} loading={busy} disabled={!valid || !dirty || !loaded} />
      </View>
    </Card>
  );
}
