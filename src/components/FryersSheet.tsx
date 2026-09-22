import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOilTests } from '@/hooks/useOilTests';
import { useOrgData } from '@/hooks/useOrgData';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';

/** Owner-only: add/rename/remove the fryers a branch tests. */
export function FryersSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { fryers, refresh } = useOilTests();
  const { teams } = useOrgData();

  const [branchId, setBranchId] = useState<string | null>(teams[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchFryers = fryers.filter((f) => f.teamId === branchId);

  const run = async (fn: () => PromiseLike<{ error: any }>) => {
    setBusy(true); setError(null);
    try {
      const { error: e } = await fn();
      if (e) throw e;
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const addFryer = () => {
    if (!branchId || !newName.trim()) return;
    run(() => supabase.rpc('set_oil_fryer', { p_team_id: branchId, p_name: newName.trim() }))
      .then(() => setNewName(''));
  };
  const rename = (id: string, name: string) =>
    run(() => supabase.rpc('set_oil_fryer', { p_team_id: branchId, p_name: name, p_fryer_id: id }));
  const archive = (id: string) => run(() => supabase.rpc('archive_oil_fryer', { p_fryer_id: id }));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{t('oil.manageFryers')}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
          </View>

          {error ? <ErrorBanner message={error} /> : null}

          {teams.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
              {teams.map((tm) => {
                const active = branchId === tm.id;
                return (
                  <Pressable key={tm.id} onPress={() => setBranchId(tm.id)}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{tm.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <ScrollView style={{ maxHeight: 320 }}>
            {branchFryers.map((f) => (
              <FryerRow key={f.id} name={f.name} onRename={(n) => rename(f.id, n)} onArchive={() => archive(f.id)} />
            ))}
            {branchFryers.length === 0 ? <Text style={{ fontSize: 13, color: c.textFaint, paddingVertical: 12 }}>{t('oil.noFryersYet')}</Text> : null}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 }}>
            <TextInput value={newName} onChangeText={setNewName} placeholder={t('oil.newFryer')} placeholderTextColor={c.textFaint}
              style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, textAlign: textAlignFor(newName) }} />
            <Pressable onPress={addFryer} disabled={busy || !newName.trim()}
              style={{ backgroundColor: c.brand, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center', opacity: busy || !newName.trim() ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="add" size={22} color="#fff" />}
            </Pressable>
          </View>

          <SecondaryButton title={t('oil.done')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function FryerRow({ name, onRename, onArchive }: { name: string; onRename: (n: string) => void; onArchive: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
      {editing ? (
        <TextInput value={text} onChangeText={setText} autoFocus
          style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, fontSize: 14, color: c.text, textAlign: textAlignFor(text) }} />
      ) : (
        <Text style={{ flex: 1, fontSize: 15, color: c.text }}>{name}</Text>
      )}
      {editing ? (
        <Pressable onPress={() => { onRename(text.trim() || name); setEditing(false); }} hitSlop={6}>
          <Ionicons name="checkmark" size={20} color={c.emerald} />
        </Pressable>
      ) : (
        <Pressable onPress={() => { setText(name); setEditing(true); }} hitSlop={6}>
          <Ionicons name="pencil" size={17} color={c.textMuted} />
        </Pressable>
      )}
      <Pressable onPress={onArchive} hitSlop={6} accessibilityLabel={t('oil.removeFryer')}>
        <Ionicons name="trash-outline" size={17} color={c.rose} />
      </Pressable>
    </View>
  );
}
