import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOrgData } from '@/hooks/useOrgData';
import { CHECK_IN_MIN_M, CHECK_IN_MAX_M, DEFAULT_CHECK_IN_M } from '@/lib/checkIn';
import { Card, ErrorBanner, useThemeColors } from '@/components/ui';

/** Whole metres in the allowed range, or null. */
function parseMeters(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= CHECK_IN_MIN_M && n <= CHECK_IN_MAX_M ? n : null;
}

/**
 * Per-branch check-in distance, plus one row that sets every branch at once.
 * Only the distance — the pin is moved on the Branches tab (set_team_location).
 */
export function CheckInDistanceCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { teams, refresh } = useOrgData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [allText, setAllText] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // a branch id, 'all', or null
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (teamId: string | null, meters: number) => {
    setBusy(teamId ?? 'all');
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await supabase.rpc('set_branch_radius', { p_team_id: teamId, p_radius_m: meters });
      if (e) throw e;
      await refresh();
      if (teamId) {
        setDrafts(({ [teamId]: _, ...rest }) => rest);
        setNotice(t('control.distanceSaved', { name: teams.find((b) => b.id === teamId)?.name ?? '', m: meters }));
      } else {
        setDrafts({});
        setAllText('');
        setNotice(t('control.distanceSavedAll', { m: meters }));
      }
    } catch (e: any) {
      setError(e?.message ?? t('control.distanceFailed'));
    } finally {
      setBusy(null);
    }
  };

  const allMeters = parseMeters(allText);

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('control.distanceTitle')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 12 }}>{t('control.distanceHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <View style={{ backgroundColor: c.brandSoft, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: c.brand, fontSize: 13 }}>{notice}</Text>
        </View>
      ) : null}

      {teams.length > 1 ? (
        <DistanceRow
          label={t('control.distanceAll')}
          sub={null}
          value={allText}
          onChange={setAllText}
          actionTitle={t('control.distanceSetAll')}
          canSave={allMeters != null}
          busy={busy === 'all'}
          onSave={() => allMeters != null && save(null, allMeters)}
          testID="distance-all"
        />
      ) : null}

      {teams.map((b) => {
        const text = drafts[b.id] ?? '';
        const meters = parseMeters(text);
        return (
          <DistanceRow
            key={b.id}
            label={b.name}
            sub={b.lat == null ? t('control.distanceNoPin') : t('control.distanceCurrent', { m: b.radiusM ?? DEFAULT_CHECK_IN_M })}
            value={text}
            onChange={(v) => setDrafts((d) => ({ ...d, [b.id]: v }))}
            actionTitle={t('control.distanceSave')}
            canSave={meters != null && meters !== (b.radiusM ?? DEFAULT_CHECK_IN_M)}
            busy={busy === b.id}
            onSave={() => meters != null && save(b.id, meters)}
            testID={`distance-${b.name}`}
          />
        );
      })}

      <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 8 }}>
        {t('control.distanceRange', { min: CHECK_IN_MIN_M, max: CHECK_IN_MAX_M })}
      </Text>
    </Card>
  );
}

function DistanceRow(props: {
  label: string;
  sub: string | null;
  value: string;
  onChange: (v: string) => void;
  actionTitle: string;
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
  testID: string;
}) {
  const c = useThemeColors();
  const disabled = !props.canSave || props.busy;
  return (
    <View testID={props.testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{props.label}</Text>
        {props.sub ? <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{props.sub}</Text> : null}
      </View>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        keyboardType="number-pad"
        placeholder="m"
        placeholderTextColor={c.textFaint}
        maxLength={4}
        style={{ width: 72, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, fontSize: 14, color: c.text, textAlign: 'center' }}
      />
      <Pressable
        onPress={props.onSave}
        disabled={disabled}
        accessibilityRole="button"
        style={{ backgroundColor: c.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, minWidth: 64, alignItems: 'center', opacity: disabled ? 0.45 : 1 }}
      >
        {props.busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{props.actionTitle}</Text>}
      </Pressable>
    </View>
  );
}
