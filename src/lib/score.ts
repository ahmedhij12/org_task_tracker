import type { ThemeColors } from '@/theme';

export type ScoreGrade = 'excellent' | 'good' | 'needsWork' | 'critical';

/** The bands every score view shares — Dashboard, History, the audit sheet and the PDF. */
export function gradeOf(score: number): ScoreGrade {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'needsWork';
  return 'critical';
}

export function gradeColors(grade: ScoreGrade, c: ThemeColors): { fg: string; bg: string } {
  switch (grade) {
    case 'excellent':
      return { fg: c.emerald, bg: c.emeraldSoft };
    case 'good':
      return { fg: c.sky, bg: c.brandSoft };
    case 'needsWork':
      return { fg: c.amber, bg: c.amberSoft };
    case 'critical':
      return { fg: c.rose, bg: c.roseSoft };
  }
}

/** Fixed hex values for the PDF, which has no theme. */
export const GRADE_HEX: Record<ScoreGrade, string> = {
  excellent: '#059669',
  good: '#0284c7',
  needsWork: '#d97706',
  critical: '#dc2626',
};

/**
 * Preview only — mirrors set_task_completion's server-side score exactly:
 * the share of answered (Yes/No, never N/A) weight that passed, falling back
 * to a plain count if every answered item weighs 0. Null when nothing was
 * answered Yes or No.
 */
export function computeScore(items: { answer: boolean | null; weight: number }[]): number | null {
  const answered = items.filter((it) => it.answer !== null);
  if (answered.length === 0) return null;
  const totalWeight = answered.reduce((s, it) => s + it.weight, 0);
  if (totalWeight > 0) {
    const passed = answered.reduce((s, it) => (it.answer ? s + it.weight : s), 0);
    return Math.round((1000 * passed) / totalWeight) / 10;
  }
  return Math.round((1000 * answered.filter((it) => it.answer).length) / answered.length) / 10;
}

export function formatScore(score: number): string {
  return String(Math.round(score));
}
