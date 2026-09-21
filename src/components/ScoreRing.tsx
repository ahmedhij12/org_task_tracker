import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useThemeColors } from '@/components/ui';
import { formatScore, gradeColors, gradeOf } from '@/lib/score';

/** A circular "86 / 100" gauge with the grade label under it. */
export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const grade = gradeOf(score);
  const { fg } = gradeColors(grade, c);
  const stroke = Math.max(6, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={fg}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
          />
        </Svg>
        <Text style={{ fontSize: size * 0.3, fontWeight: '800', color: c.text }}>{formatScore(score)}</Text>
        <Text style={{ fontSize: size * 0.11, fontWeight: '600', color: c.textMuted, marginTop: -2 }}>/ 100</Text>
      </View>
      <Text style={{ fontSize: 12, fontWeight: '700', color: fg, marginTop: 6 }}>{t(`score.${grade}`)}</Text>
    </View>
  );
}

/** Compact "86/100 · Good" pill for list rows. */
export function ScorePill({ score, showGrade = true }: { score: number; showGrade?: boolean }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const grade = gradeOf(score);
  const { fg, bg } = gradeColors(grade, c);
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: fg }}>
        {formatScore(score)}/100{showGrade ? ` · ${t(`score.${grade}`)}` : ''}
      </Text>
    </View>
  );
}
