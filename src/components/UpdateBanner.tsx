import { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/components/ui';

const ENTRY = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;

/** The app bundle this page is running, e.g. "/_expo/static/js/web/entry-e77e….js". */
function runningBundle(): string | null {
  const script = Array.from(document.querySelectorAll('script[src]')).find((s) => ENTRY.test(s.getAttribute('src') ?? ''));
  return script?.getAttribute('src')?.match(ENTRY)?.[0] ?? null;
}

/** The bundle the live site serves right now (the page is tiny; never cached). */
async function liveBundle(): Promise<string | null> {
  const res = await fetch(`/?update-check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(ENTRY)?.[0] ?? null;
}

/**
 * "A new version is out — close the app completely and open it again" (his
 * request, 2026-09-26). An installed Home-Screen app can sit in memory for
 * days running the old version, so every new deploy used to need a message
 * on WhatsApp. The running bundle is compared with the live one when the app
 * opens, whenever it comes back to the front, and every 5 minutes. Web only:
 * the native app updates through a new build.
 */
export function UpdateBanner() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const mine = runningBundle();
    if (!mine) return; // a dev server has no hashed bundle
    let stopped = false;
    const check = async () => {
      try {
        const live = await liveBundle();
        if (!stopped && live && live !== mine) setOutdated(true);
      } catch {
        /* offline — try again later */
      }
    };
    check();
    const timer = setInterval(check, 5 * 60000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  if (!outdated) return null;
  return (
    <View
      testID="update-banner"
      style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 8, zIndex: 1000, backgroundColor: c.brand, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}
    >
      <Ionicons name="cloud-download-outline" size={24} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{t('update.title')}</Text>
        <Text style={{ color: '#fff', fontSize: 12, marginTop: 2, lineHeight: 17 }}>{t('update.body')}</Text>
      </View>
      <Pressable
        onPress={() => window.location.reload()}
        accessibilityRole="button"
        style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
      >
        <Text style={{ color: c.brand, fontSize: 12, fontWeight: '800' }}>{t('update.reload')}</Text>
      </Pressable>
    </View>
  );
}
