import { Pressable, Text, I18nManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemeColors } from '@/components/ui';

/**
 * Inside ONE History section after its branch row was tapped: names the open
 * branch and goes back to all branches. Only that section narrows — tapping
 * Baghdad under marination used to narrow the whole History screen, which
 * landed on a mixed Baghdad page instead of Baghdad's marination.
 */
export function BranchBackRow({ name, onBack }: { name: string; onBack: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onBack}
      hitSlop={6}
      accessibilityRole="button"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 8 }}
    >
      {/* Follows the layout's real direction, which only flips after a restart. */}
      <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={16} color={c.brand} />
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.brand }}>{t('history.allBranches')}</Text>
      <Text style={{ fontSize: 13, color: c.textMuted }}>·</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>{name}</Text>
    </Pressable>
  );
}
