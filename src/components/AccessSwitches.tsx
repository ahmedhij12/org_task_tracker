import { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { FieldLabel, useThemeColors } from '@/components/ui';
import type { Permission } from '@/lib/roles';
import type { Profile } from '@/types';

type Row = { permission: Permission; allowed: boolean; is_default: boolean };

/**
 * What this person can do, one switch each, in their Staff sheet next to
 * Deactivate and Delete (his design, 2026-09-26: "as admin I can add for the
 * auditor the control panel and hide it with a toggle"). An admin sets them
 * for anyone who is not an admin; the super admin for admins too. Never your
 * own, never the super admin's — the database refuses those, and
 * permissions_of() returns nothing, so no switch is ever offered just to fail.
 */
export function AccessSwitches({ member }: { member: Profile }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<Permission | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible =
    profile?.role === 'owner' &&
    member.id !== profile.id &&
    !member.isSuperAdmin &&
    !member.deletedAt &&
    (member.role !== 'owner' || !!profile.isSuperAdmin);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('permissions_of', { p_profile: member.id });
    setRows(!e && Array.isArray(data) ? (data as Row[]) : []);
  }, [member.id]);
  useEffect(() => {
    if (eligible) load();
  }, [eligible, load]);

  if (!eligible || !rows || rows.length === 0) return null;

  const flip = async (perm: Permission, next: boolean) => {
    setBusy(perm);
    setError(null);
    // Show it at once; the database has the last word.
    setRows((rs) => rs && rs.map((r) => (r.permission === perm ? { ...r, allowed: next, is_default: false } : r)));
    const { error: e } = await supabase.rpc('set_person_permission', { p_profile: member.id, p_perm: perm, p_allowed: next });
    if (e) setError(e.message ?? t('access.failed'));
    await load();
    setBusy(null);
  };

  return (
    <View testID="access-switches" style={{ marginTop: 20 }}>
      <FieldLabel>{t('access.title')}</FieldLabel>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 8 }}>{t('access.hint', { name: member.name })}</Text>
      {error ? <Text style={{ fontSize: 12, color: c.rose, marginBottom: 8 }}>{error}</Text> : null}
      {rows.map((r) => (
        <View
          key={r.permission}
          testID={`access-${r.permission}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{t(`access.${r.permission}`)}</Text>
            <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>{t(`access.${r.permission}Hint`)}</Text>
          </View>
          {busy === r.permission ? <ActivityIndicator color={c.brand} /> : null}
          <Switch
            value={r.allowed}
            onValueChange={(v) => flip(r.permission, v)}
            disabled={busy != null}
            trackColor={{ false: c.border, true: c.brand }}
            thumbColor="#fff"
            // react-native-web's own prop; without it the knob turns teal on web.
            {...({ activeThumbColor: '#fff' } as object)}
            accessibilityLabel={t(`access.${r.permission}`)}
          />
        </View>
      ))}
    </View>
  );
}
