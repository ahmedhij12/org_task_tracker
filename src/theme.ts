export interface ThemeColors {
  bg: string;
  bgSubtle: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  indigo: string;
  indigoSoft: string;
  emerald: string;
  emeraldSoft: string;
  amber: string;
  amberSoft: string;
  rose: string;
  roseSoft: string;
  sky: string;
}

export const Colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    bg: '#FFFFFF',
    bgSubtle: '#F9FAFB',
    card: '#FFFFFF',
    border: '#E5E7EB',
    text: '#111827',
    textMuted: '#6B7280',
    textFaint: '#9CA3AF',
    indigo: '#4F46E5',
    indigoSoft: '#EEF2FF',
    emerald: '#10B981',
    emeraldSoft: '#ECFDF5',
    amber: '#F59E0B',
    amberSoft: '#FFFBEB',
    rose: '#F43F5E',
    roseSoft: '#FFF1F2',
    sky: '#0EA5E9',
  },
  dark: {
    bg: '#171717',
    bgSubtle: '#111111',
    card: '#262626',
    border: '#404040',
    text: '#F5F5F5',
    textMuted: '#A3A3A3',
    textFaint: '#737373',
    indigo: '#818CF8',
    indigoSoft: 'rgba(99,102,241,0.15)',
    emerald: '#34D399',
    emeraldSoft: 'rgba(16,185,129,0.12)',
    amber: '#FBBF24',
    amberSoft: 'rgba(245,158,11,0.12)',
    rose: '#FB7185',
    roseSoft: 'rgba(244,63,94,0.12)',
    sky: '#38BDF8',
  },
};

export const PriorityMeta: Record<'low' | 'medium' | 'high', { label: string; colorKey: keyof ThemeColors }> = {
  low: { label: 'Low', colorKey: 'emerald' },
  medium: { label: 'Medium', colorKey: 'amber' },
  high: { label: 'High', colorKey: 'rose' },
};
