import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useThemeColors } from '@/components/ui';

/**
 * Today's daily checklist (the one carrying a selfie) and whether it's been
 * checked yet — "Waiting for admin check" or "Verified by … · time", with
 * the reviewer's note. Shared by supervisors and branch managers.
 */
export function TodayChecklistCard() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { history, allMembers: members } = useOrgData();

  // A branch manager can fill two today — his own and, when his supervisor
  // cannot, the supervisors' — so every one of today's gets its own card.
  const todays = history.filter(
    (h) =>
      h.actorId === profile?.id &&
      h.action === 'completed' &&
      !!h.selfieUrl &&
      new Date(h.createdAt).toDateString() === new Date().toDateString()
  );
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <>
      {todays.map((todaysChecklist) => {
        const reviewer = todaysChecklist.reviewedBy ? members.find((m) => m.id === todaysChecklist.reviewedBy) : null;
        return (
          <View key={todaysChecklist.id}>
        {todaysChecklist ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              marginTop: 16,
              padding: 14,
              borderRadius: 16,
              backgroundColor: todaysChecklist.reviewedBy ? c.emeraldSoft : c.amberSoft,
            }}
          >
            <Ionicons
              name={todaysChecklist.reviewedBy ? 'checkmark-circle' : 'time'}
              size={26}
              color={todaysChecklist.reviewedBy ? c.emerald : c.amber}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: todaysChecklist.reviewedBy ? c.emerald : c.amber }}>
                {todaysChecklist.reviewedBy
                  ? t('checklists.verifiedBy', { name: reviewer?.name ?? 'Admin', time: timeOf(todaysChecklist.reviewedAt ?? todaysChecklist.createdAt) })
                  : t('checklists.waiting')}
              </Text>
              <Text style={{ fontSize: 12, color: c.text, marginTop: 2 }}>
                {todays.length > 1 ? `${todaysChecklist.taskTitle} · ` : ''}
                {t('checklists.submittedAt', { time: timeOf(todaysChecklist.createdAt) })}
              </Text>
              {todaysChecklist.reviewNote ? (
                <Text style={{ fontSize: 12, color: c.text, marginTop: 4 }}>"{todaysChecklist.reviewNote}"</Text>
              ) : null}
            </View>
          </View>
        ) : null}
          </View>
        );
      })}
    </>
  );
}
