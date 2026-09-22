export interface ThemeColors {
  bg: string;
  bgSubtle: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Basra Delight navy (the smile in the logo): links, selected chips, active icons. Lighter in dark mode so it stays readable on the dark background. */
  brand: string;
  brandSoft: string;
  emerald: string;
  emeraldSoft: string;
  amber: string;
  amberSoft: string;
  rose: string;
  roseSoft: string;
  sky: string;
  /** Basra Delight red (the red in the logo): primary CTAs (PrimaryButton, "+Add" pills, the dashboard FAB) and the active tab — never body text; icons stay brand/neutral. */
  accent: string;
  accentSoft: string;
}

/** Text and icons sitting on the accent (red) background — white in both themes. */
export const ON_ACCENT = '#FFFFFF';

export const Colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    bg: '#FFFFFF',
    bgSubtle: '#F9FAFB',
    card: '#FFFFFF',
    border: '#E5E7EB',
    text: '#111827',
    textMuted: '#6B7280',
    textFaint: '#9CA3AF',
    brand: '#00304E',
    brandSoft: '#E6EEF3',
    emerald: '#10B981',
    emeraldSoft: '#ECFDF5',
    amber: '#F59E0B',
    amberSoft: '#FFFBEB',
    rose: '#F43F5E',
    roseSoft: '#FFF1F2',
    sky: '#0EA5E9',
    accent: '#E8141A',
    accentSoft: '#FDE8E9',
  },
  dark: {
    bg: '#171717',
    bgSubtle: '#111111',
    card: '#262626',
    border: '#404040',
    text: '#F5F5F5',
    textMuted: '#A3A3A3',
    textFaint: '#737373',
    brand: '#4180AE',
    brandSoft: 'rgba(65,128,174,0.18)',
    emerald: '#34D399',
    emeraldSoft: 'rgba(16,185,129,0.12)',
    amber: '#FBBF24',
    amberSoft: 'rgba(245,158,11,0.12)',
    rose: '#FB7185',
    roseSoft: 'rgba(244,63,94,0.12)',
    sky: '#38BDF8',
    accent: '#EE2B31',
    accentSoft: 'rgba(232,20,26,0.16)',
  },
};

export const PriorityMeta: Record<'low' | 'medium' | 'high', { label: string; colorKey: keyof ThemeColors }> = {
  low: { label: 'Low', colorKey: 'emerald' },
  medium: { label: 'Medium', colorKey: 'amber' },
  high: { label: 'High', colorKey: 'rose' },
};
