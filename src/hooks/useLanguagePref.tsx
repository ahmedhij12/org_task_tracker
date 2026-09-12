import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { type AppLanguage } from '@/lib/i18n';

const STORAGE_KEY = 'rungs.languagePref';

export type LanguagePref = AppLanguage | 'auto';

interface LanguagePrefContextValue {
  languagePref: LanguagePref;
  setLanguagePref: (pref: LanguagePref) => void;
  /** What 'auto' actually resolved to, or the explicit choice. */
  resolvedLanguage: AppLanguage;
  /**
   * True once a change has been applied to i18n/AsyncStorage but not yet to
   * I18nManager's native RTL flag — that half only takes effect after the
   * app fully restarts (a well-known RN/I18nManager limitation; there's no
   * OTA reload available here — see ROADMAP.md). Text updates immediately
   * regardless; this only governs the mirrored layout direction.
   */
  needsRestartForDirection: boolean;
}

function resolveAuto(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code === 'ar' ? 'ar' : 'en';
}

const LanguagePrefContext = createContext<LanguagePrefContextValue | null>(null);

export function LanguagePrefProvider({ children }: { children: ReactNode }) {
  const [languagePref, setLanguagePrefState] = useState<LanguagePref>('auto');
  const [loaded, setLoaded] = useState(false);

  const resolvedLanguage = languagePref === 'auto' ? resolveAuto() : languagePref;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'en' || stored === 'ar' || stored === 'auto') setLanguagePrefState(stored);
      setLoaded(true);
    });
  }, []);

  // Keeps i18next in sync whenever the resolved language changes — covers
  // both an explicit switch and 'auto' resolving differently after the
  // stored preference loads.
  useEffect(() => {
    if (loaded) i18n.changeLanguage(resolvedLanguage);
  }, [resolvedLanguage, loaded]);

  const setLanguagePref = (pref: LanguagePref) => {
    setLanguagePrefState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref);
    const next = pref === 'auto' ? resolveAuto() : pref;
    // Only actually applies to layout after a restart — see
    // needsRestartForDirection below — but is still the correct call to make
    // now so a fresh launch afterward already has the right direction.
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(next === 'ar');
  };

  const needsRestartForDirection = I18nManager.isRTL !== (resolvedLanguage === 'ar');

  const value = useMemo(
    () => ({ languagePref, setLanguagePref, resolvedLanguage, needsRestartForDirection }),
    [languagePref, resolvedLanguage, needsRestartForDirection]
  );

  // Avoid a flash of the wrong language while the stored preference is
  // still loading, matching ThemePrefProvider's approach.
  if (!loaded) return null;

  return <LanguagePrefContext.Provider value={value}>{children}</LanguagePrefContext.Provider>;
}

export function useLanguagePref(): LanguagePrefContextValue {
  const ctx = useContext(LanguagePrefContext);
  if (!ctx) throw new Error('useLanguagePref must be used within LanguagePrefProvider');
  return ctx;
}
