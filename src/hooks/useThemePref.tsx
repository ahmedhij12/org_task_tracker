import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemePref } from '../types';

const STORAGE_KEY = 'orgtasks.themePref';

interface ThemePrefContextValue {
  themePref: ThemePref;
  setThemePref: (pref: ThemePref) => void;
  isDark: boolean;
}

const ThemePrefContext = createContext<ThemePrefContextValue | null>(null);

export function ThemePrefProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [themePref, setThemePrefState] = useState<ThemePref>('auto');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'auto') setThemePrefState(stored);
      setLoaded(true);
    });
  }, []);

  const setThemePref = (pref: ThemePref) => {
    setThemePrefState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref);
  };

  const isDark = themePref === 'dark' || (themePref === 'auto' && systemScheme === 'dark');

  const value = useMemo(() => ({ themePref, setThemePref, isDark }), [themePref, isDark]);

  // Avoid a light->dark flash while the stored preference is still loading.
  if (!loaded) return null;

  return <ThemePrefContext.Provider value={value}>{children}</ThemePrefContext.Provider>;
}

export function useThemePref(): ThemePrefContextValue {
  const ctx = useContext(ThemePrefContext);
  if (!ctx) throw new Error('useThemePref must be used within ThemePrefProvider');
  return ctx;
}
