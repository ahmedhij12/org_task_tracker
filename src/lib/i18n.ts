import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/i18n/en';
import ar from '@/i18n/ar';

// Initialized once at import time with a hardcoded starting language; the
// real, persisted choice is applied by LanguagePrefProvider a moment later
// via i18n.changeLanguage(). Kept here rather than in the provider so any
// code that imports 'i18next' directly (not through useTranslation) still
// gets a configured instance immediately.
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes.
});

export default i18n;
export type AppLanguage = 'en' | 'ar';
