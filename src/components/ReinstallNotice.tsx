import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useWebPush } from '@/hooks/useWebPush';
import { useThemeColors } from '@/components/ui';

const DISMISS_KEY = 'rungs.reinstallNoticeDismissed';

/**
 * Shown to people whose Home Screen icon was added before the app became a
 * proper web app — those shortcuts cannot receive notifications. They must
 * delete the old icon and add it again. Targeted, so anyone already set up
 * never sees it.
 */
export function ReinstallNotice() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { state } = useWebPush();
  const [hidden, setHidden] = useState(() => {
    try { return !!localStorage?.getItem(DISMISS_KEY); } catch { return false; }
  });

  // 'needs-install' means iPhone, and not running from a proper Home Screen app.
  if (hidden || state !== 'needs-install') return null;

  const dismiss = () => {
    try { localStorage?.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.amberSoft, borderWidth: 1, borderColor: c.amber + '66' }}>
      <Ionicons name="phone-portrait" size={20} color={c.amber} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: c.text, marginBottom: 3 }}>{t('reinstall.title')}</Text>
        <Text style={{ fontSize: 12, color: c.text, lineHeight: 18 }}>{t('reinstall.body')}</Text>
      </View>
      <Pressable onPress={dismiss} hitSlop={8}><Ionicons name="close" size={18} color={c.textMuted} /></Pressable>
    </View>
  );
}
