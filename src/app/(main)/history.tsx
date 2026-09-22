import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OilHistory } from '@/components/OilHistory';
import { ChickenHistory } from '@/components/ChickenHistory';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useRefreshAll } from '@/hooks/useRefreshAll';
import { useOrgData } from '@/hooks/useOrgData';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import { AdjustPointsSheet } from '@/components/AdjustPointsSheet';
import { Card, useThemeColors } from '@/components/ui';
import { isFailed, needsReview } from '@/types';
import { ScorePill } from '@/components/ScoreRing';
import type { OrgTask, TaskCompletion } from '@/types';

/** 'all' or a team (branch) id — new branches show up automatically since this just reads the live teams list. */
type Filter = 'all' | string;

function when(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function HistoryScreen() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { history, tasks, allMembers: members, teams, loading, refresh } = useOrgData();
  const refreshAll = useRefreshAll(refresh);
  const [filter, setFilter] = useState<Filter>('all');
  const [openEntry, setOpenEntry] = useState<TaskCompletion | null>(null);
  const [pointsEntry, setPointsEntry] = useState<TaskCompletion | null>(null);

  const isOwner = profile?.role === 'owner';
  const isLeader = profile?.role === 'team_admin';

  // Same ownership rule as adjust_completion_points itself: an owner can
  // adjust any audit, a team_admin only the ones they personally performed.
  const isAuditEntry = (h: TaskCompletion) => h.pointsAwarded != null && h.subjectProfileId !== h.actorId;
  // Money is the admin's alone; everyone else can only look.
  const canEditPoints = (h: TaskCompletion) => isAuditEntry(h) && isOwner;
  const canViewPoints = (h: TaskCompletion) => isAuditEntry(h) && !canEditPoints(h) && h.subjectProfileId === profile?.id;

  // Failed is derived, never stored: still open and past its deadline. Scoped
  // the same way the history rows are, so each role sees a consistent picture.
  const failedTasks = useMemo(() => {
    const visible = tasks.filter((t) => {
      if (isOwner) return true;
      if (isLeader) return !!profile?.teamIds.includes(t.teamId);
      return t.assigneeId === profile?.id || t.assigneeId === null;
    });
    return visible.filter((t) => isFailed(t));
  }, [tasks, isOwner, isLeader, profile?.teamIds, profile?.id]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // The branch a history entry belongs to, for the branch filter below —
  // the SUBJECT's branch (via profile_teams) on an audit, since the audit
  // task's own team_id can differ from who's actually being audited (the
  // same attribution rule get_period_report already uses), and the actor's
  // own team_id for an ordinary completion.
  const branchIdOf = (h: TaskCompletion): string | null => {
    if (h.pointsAwarded != null && h.subjectProfileId !== h.actorId) {
      return memberById.get(h.subjectProfileId)?.teamIds[0] ?? null;
    }
    return h.teamId;
  };

  const missedShown = useMemo(
    () => failedTasks.filter((t) => filter === 'all' || t.teamId === filter),
    [failedTasks, filter]
  );

  const shown = useMemo(
    () => history.filter((h) => filter === 'all' || branchIdOf(h) === filter),
    [history, filter, memberById]
  );

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? t('history.someone');

  // Only the branches this person belongs to (the admin sees all), and no
  // filter row at all when that's a single branch — nothing to choose between.
  const filterTeams = isOwner ? teams : teams.filter((tm) => profile?.teamIds.includes(tm.id));

  const scopeNote = isOwner
    ? t('history.scopeAll')
    : isLeader
      ? t('history.scopeTeam')
      : t('history.scopeMine');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshAll} tintColor={c.brand} />}
      >
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('history.title')}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2, marginBottom: 16 }}>{scopeNote}</Text>

        <OilHistory />
        <ChickenHistory />

        {filterTeams.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
          {(
            [{ key: 'all', label: t('history.filterAll') }, ...filterTeams.map((tm) => ({ key: tm.id, label: tm.name }))] as {
              key: Filter;
              label: string;
            }[]
          ).map((opt) => {
            const active = filter === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setFilter(opt.key)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: active ? c.brand : c.bgSubtle,
                  borderWidth: 1,
                  borderColor: active ? c.brand : c.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        ) : null}

        {missedShown.map((task) => (
          <MissedRow key={task.id} task={task} nameOf={nameOf} />
        ))}

        {shown.length === 0 && missedShown.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textFaint }}>{t('history.nothingYet')}</Text>
        ) : (
          shown.map((h) => (
            <HistoryRow
              key={h.id}
              entry={h}
              task={taskById.get(h.taskId)}
              actorName={nameOf(h.actorId)}
              onPress={() => setOpenEntry(h)}
              pointsAccess={canEditPoints(h) ? 'edit' : canViewPoints(h) ? 'view' : null}
              onPointsPress={() => setPointsEntry(h)}
            />
          ))
        )}
      </ScrollView>

      <CompletionDetailSheet completion={openEntry} onClose={() => setOpenEntry(null)} />
      <AdjustPointsSheet
        completion={pointsEntry}
        canEdit={pointsEntry ? canEditPoints(pointsEntry) : false}
        onClose={() => setPointsEntry(null)}
      />
    </SafeAreaView>
  );
}

function MissedRow({ task, nameOf }: { task: OrgTask; nameOf: (id: string) => string }) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  return (
    <Card style={{ marginBottom: 8, borderColor: c.roseSoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="alert-circle" size={18} color={c.rose} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{task.title}</Text>
          <Text style={{ fontSize: 12, color: c.rose, marginTop: 2 }}>
            {t('history.missedDue', { time: when(task.due!, i18n.language) })}
          </Text>
          <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 2 }}>
            {task.assigneeId ? nameOf(task.assigneeId) : t('history.anyoneOnTeam')}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function HistoryRow({
  entry,
  task,
  actorName,
  onPress,
  pointsAccess,
  onPointsPress,
}: {
  entry: TaskCompletion;
  task: OrgTask | undefined;
  actorName: string;
  onPress: () => void;
  pointsAccess: 'edit' | 'view' | null;
  onPointsPress: () => void;
}) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const isOffDuty = entry.action === 'off_duty';
  const reopened = entry.action === 'reopened';
  const isChecklist = entry.yesCount != null;
  const pendingReview = needsReview(entry, task ?? { requiresReview: false });

  const icon = isOffDuty
    ? entry.status === 'off_duty_approved'
      ? 'checkmark-circle'
      : entry.status === 'off_duty_rejected'
        ? 'close-circle'
        : 'time'
    : reopened
      ? 'refresh-circle'
      : entry.wasLate
        ? 'time'
        : 'checkmark-circle';
  const iconColor = isOffDuty
    ? entry.status === 'off_duty_approved'
      ? c.emerald
      : entry.status === 'off_duty_rejected'
        ? c.rose
        : c.amber
    : reopened
      ? c.textMuted
      : entry.wasLate
        ? c.amber
        : c.emerald;

  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: 8, borderColor: pendingReview ? c.amberSoft : c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Ionicons name={icon as any} size={18} color={iconColor} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{entry.taskTitle}</Text>
              {entry.selfieUrl && entry.action === 'completed' ? (
                // A supervisor's daily checklist: show the admin's check either way.
                <View
                  style={{
                    backgroundColor: entry.reviewedBy ? c.emeraldSoft : c.amberSoft,
                    borderRadius: 999,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ fontSize: 9, fontWeight: '700', color: entry.reviewedBy ? c.emerald : c.amber }}>
                    {entry.reviewedBy ? `✓ ${t('checklists.verified').toUpperCase()}` : t('checklists.waiting').toUpperCase()}
                  </Text>
                </View>
              ) : pendingReview ? (
                <View style={{ backgroundColor: c.amberSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: c.amber }}>{t('history.needsReviewBadge')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
              {t('history.byLine', {
                action: isOffDuty ? t('history.actionOffDuty') : reopened ? t('history.actionReopened') : t('history.actionDone'),
                name: actorName,
                time: when(entry.createdAt, i18n.language),
              })}
              {isChecklist ? t('history.checklistSuffix', { yes: entry.yesCount, no: entry.noCount }) : ''}
            </Text>
            {entry.wasLate && entry.action === 'completed' ? (
              <Text style={{ fontSize: 11, color: c.rose, marginTop: 2 }}>
                {t('history.lateDeadline', { time: entry.dueAt ? when(entry.dueAt, i18n.language) : t('history.earlier') })}
              </Text>
            ) : null}
            {isOffDuty ? (
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }} numberOfLines={1}>
                "{entry.offDutyReason}"
              </Text>
            ) : null}
            {entry.pointsAwarded != null ? (
              <Text style={{ fontSize: 12, fontWeight: '700', color: entry.pointsAwarded < 0 ? c.rose : c.emerald, marginTop: 2 }}>
                {t('history.auditPoints', {
                  points: entry.pointsAwarded,
                  iqd: Math.abs(entry.pointsAwarded * entry.iqdPerPoint).toLocaleString(i18n.language),
                  shift: entry.shift === 'morning' ? t('history.shiftMorning') : entry.shift === 'evening' ? t('history.shiftEvening') : '',
                })}
              </Text>
            ) : null}
            {entry.score != null ? (
              <View style={{ marginTop: 4 }}>
                <ScorePill score={entry.score} />
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
            {pointsAccess ? (
              <Pressable onPress={onPointsPress} hitSlop={8}>
                <Ionicons
                  name={pointsAccess === 'edit' ? 'pencil' : 'information-circle-outline'}
                  size={16}
                  color={c.textMuted}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
