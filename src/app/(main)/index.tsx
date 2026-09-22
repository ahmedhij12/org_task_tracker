import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useReports } from '@/hooks/useReports';
import { Card, useThemeColors } from '@/components/ui';
import { ON_ACCENT } from '@/theme';
import { TaskRow } from '@/components/TaskRow';
import { Section } from '@/components/Section';
import { CompleteTaskSheet } from '@/components/CompleteTaskSheet';
import { FillChecklistSheet } from '@/components/FillChecklistSheet';
import { bucketTasks, effectiveTaskCompleted, latestCompletionForTask } from '@/lib/taskUtils';
import { groupBranchSummary, type BranchGroup } from '@/lib/branchSummary';
import { ScorePill } from '@/components/ScoreRing';
import { formatScore, gradeColors, gradeOf } from '@/lib/score';
import { CreateChecklistTemplateSheet } from '@/components/CreateChecklistTemplateSheet';
import { MyAuditScore } from '@/components/MyAuditScore';
import { TodayChecklistCard } from '@/components/TodayChecklistCard';
import { OilTestCard } from '@/components/OilTestCard';
import { OilAlert } from '@/components/OilAlert';
import { BranchAudits } from '@/components/BranchAudits';
import type { BranchSummaryRow, OrgTask } from '@/types';

export default function MainIndex() {
  const { profile } = useAuth();
  if (profile?.role === 'employee') return <EmployeeHome />;
  if (profile?.role === 'owner') return <OwnerDashboard />;
  return <TeamAdminDashboard />;
}

function TeamAdminDashboard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const { tasks, teams, members, history, loading, refresh, setTaskCompletion } = useOrgData();
  const [checklistTask, setChecklistTask] = useState<OrgTask | null>(null);
  const [proofTask, setProofTask] = useState<OrgTask | null>(null);

  const handlePressCheckbox = (task: OrgTask) => {
    if (task.completed) return;
    if (task.templateId) setChecklistTask(task);
    else if (task.requiresProof) setProofTask(task);
    else setTaskCompletion(task.id, true).catch((e) => console.warn(e));
  };

  // A branch manager only does the work the admin gives them (their daily
  // checklist, any one-off task) and watches their branch — they don't
  // create, edit or delete anything.
  const myTasks = tasks
    .filter(
      (tsk) =>
        !tsk.isAudit &&
        (tsk.assigneeId === profile?.id || (tsk.assigneeId === null && !!profile?.teamIds.includes(tsk.teamId)))
    )
    .map((tsk) => ({ ...tsk, completed: effectiveTaskCompleted(tsk, history) }))
    .filter((tsk) => !tsk.completed);
  const myBranches = teams.filter((tm) => profile?.teamIds.includes(tm.id)).map((tm) => tm.name).join(', ');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.brand} />}
      >
        <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>{organization?.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <View style={{ backgroundColor: c.brandSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: c.brand }}>{t('dashboard.teamAdminBadge')}</Text>
          </View>
          {myBranches ? <Text style={{ fontSize: 12, color: c.textMuted }}>{myBranches}</Text> : null}
        </View>

        <OilAlert />
        <TodayChecklistCard />
        <OilTestCard />

        {myTasks.length > 0 ? (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 }}>
              {t('dashboard.sectionToday')}
            </Text>
            {myTasks.map((tsk) => (
              <TaskRow
                key={tsk.id}
                task={tsk}
                members={members}
                showAssignee={false}
                canComplete
                onPressCheckbox={() => handlePressCheckbox(tsk)}
              />
            ))}
          </>
        ) : null}

        <BranchAudits />

        <MyAuditScore />
      </ScrollView>

      {proofTask ? (
        <CompleteTaskSheet
          task={proofTask}
          orgId={organization!.id}
          visible={!!proofTask}
          onCancel={() => setProofTask(null)}
          onSubmit={async (note, photoUrls) => {
            await setTaskCompletion(proofTask.id, true, note || undefined, photoUrls);
            setProofTask(null);
          }}
        />
      ) : null}
      {checklistTask ? (
        <FillChecklistSheet
          task={checklistTask}
          orgId={organization!.id}
          visible={!!checklistTask}
          onClose={() => setChecklistTask(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function OwnerDashboard() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile, organization } = useAuth();
  const { currentSummary, loading, refresh, loadSupervisorStreaks } = useReports();
  const { tasks, history, setTaskCompletion } = useOrgData();
  const [copied, setCopied] = useState(false);
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);
  const [proofTask, setProofTask] = useState<OrgTask | null>(null);
  const [streaks, setStreaks] = useState<Map<string, number>>(new Map());
  const [checklistTask, setChecklistTask] = useState<OrgTask | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  // The owner is never assigned an ordinary task by anyone else (assignment
  // only flows downward) — in practice this is their own audit tasks, but
  // written generally in case that ever changes.
  const myTasks = tasks
    .filter((tsk) => tsk.assigneeId === profile?.id)
    .map((tsk) => ({ ...tsk, completed: effectiveTaskCompleted(tsk, history) }))
    .filter((tsk) => {
      if (!tsk.completed) return true;
      if (!tsk.requiresReview) return false;
      return !latestCompletionForTask(tsk.id, history)?.reviewedBy;
    });

  const handlePressCheckbox = (tsk: OrgTask) => {
    if (tsk.templateId) {
      if (!tsk.completed) setChecklistTask(tsk);
      return;
    }
    if (!tsk.completed && tsk.requiresProof) {
      setProofTask(tsk);
      return;
    }
    setTaskCompletion(tsk.id, !tsk.completed).catch((e) => console.warn(e));
  };

  const handleCopy = async () => {
    if (!organization) return;
    await Clipboard.setStringAsync(organization.orgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Worst-to-best, both at the branch level and the supervisor level within
  // each branch — this is the "who needs attention right now" view, not a
  // directory, so the branches/supervisors most in the red lead.
  const branches = useMemo(() => {
    const groups = groupBranchSummary(currentSummary);
    return [...groups]
      .sort((a, b) => a.totalPoints - b.totalPoints)
      .map((branch) => ({
        ...branch,
        brandGroups: branch.brandGroups.map((bg) => ({
          ...bg,
          rows: [...bg.rows].sort((a, b) => a.totalPoints - b.totalPoints),
        })),
      }));
  }, [currentSummary]);

  useEffect(() => {
    let cancelled = false;
    loadSupervisorStreaks()
      .then((m) => {
        if (!cancelled) setStreaks(m);
      })
      .catch((e) => console.warn(e));
    return () => {
      cancelled = true;
    };
  }, [loadSupervisorStreaks, currentSummary]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.brand} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>{organization?.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ backgroundColor: c.brandSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.brand }}>{t('dashboard.ownerBadge')}</Text>
              </View>
              <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{organization?.orgCode}</Text>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={c.textMuted} />
              </Pressable>
            </View>
          </View>
        </View>

        <OilAlert />
        <OilTestCard isAudit />

        {myTasks.length > 0 ? (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
              {t('dashboard.auditTypesHeading')}
            </Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: -4, marginBottom: 8 }}>{t('dashboard.auditTypesHint')}</Text>
            {/* No swipe-to-delete here: with no "+" on the admin dashboard, deleting an audit type would leave no way to start that audit. */}
            {myTasks.map((tsk) => (
              <TaskRow
                key={tsk.id}
                task={tsk}
                members={[]}
                showAssignee={false}
                canComplete
                onPressCheckbox={() => handlePressCheckbox(tsk)}
                onEdit={tsk.templateId ? () => setEditingTemplateId(tsk.templateId) : undefined}
              />
            ))}
          </>
        ) : null}

        <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
          {t('dashboard.branchesHeading')}
        </Text>

        <BranchScoreboard branches={branches} />

        {branches.length === 0 ? (
          <EmptyState text={t('dashboard.noBranchActivity')} />
        ) : (
          branches.map((branch) => {
            const expanded = expandedBranchId === branch.branchId;
            return (
              <Card key={branch.branchId} style={{ marginBottom: 10 }}>
                <Pressable
                  onPress={() => setExpandedBranchId(expanded ? null : branch.branchId)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{branch.branchName}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
                </Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {branch.avgScore != null ? <ScorePill score={branch.avgScore} showGrade={false} /> : null}
                  <View
                    style={{
                      backgroundColor: branch.totalPoints < 0 ? c.roseSoft : c.emeraldSoft,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: branch.totalPoints < 0 ? c.rose : c.emerald }}>
                      {branch.totalPoints} {t('dashboard.pointsSuffix')}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: c.brandSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.brand }}>
                      {branch.iqdAmount.toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                    </Text>
                  </View>
                </View>
                {expanded ? (
                  <View style={{ marginTop: 10, gap: 12 }}>
                    {branch.brandGroups.length === 1 && branch.brandGroups[0].brandKey === '__unassigned__' ? (
                      <View style={{ gap: 6 }}>
                        {branch.brandGroups[0].rows.map((s) => (
                          <SupervisorSummaryRow key={s.subjectProfileId} row={s} locale={i18n.language} streak={streaks.get(s.subjectProfileId) ?? 0} />
                        ))}
                      </View>
                    ) : (
                      branch.brandGroups.map((bg) => (
                        <View key={bg.brandKey}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                            {bg.brandName ?? t('common.unassignedBrand')}
                          </Text>
                          <View style={{ gap: 6 }}>
                            {bg.rows.map((s) => (
                              <SupervisorSummaryRow key={s.subjectProfileId} row={s} locale={i18n.language} streak={streaks.get(s.subjectProfileId) ?? 0} />
                            ))}
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      {proofTask ? (
        <CompleteTaskSheet
          task={proofTask}
          orgId={organization!.id}
          visible={!!proofTask}
          onCancel={() => setProofTask(null)}
          onSubmit={async (note, photoUrls) => {
            await setTaskCompletion(proofTask.id, true, note || undefined, photoUrls);
            setProofTask(null);
          }}
        />
      ) : null}
      {checklistTask ? (
        <FillChecklistSheet
          task={checklistTask}
          orgId={organization!.id}
          visible={!!checklistTask}
          onClose={() => setChecklistTask(null)}
        />
      ) : null}
      <CreateChecklistTemplateSheet
        visible={!!editingTemplateId}
        editingTemplateId={editingTemplateId ?? undefined}
        onClose={() => setEditingTemplateId(null)}
      />

      <Pressable
        onPress={() => router.push('/(main)/create-task')}
        accessibilityRole="button"
        accessibilityLabel={t('dashboard.addTask')}
        style={{
          position: 'absolute',
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: c.accent,
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <Ionicons name="add" size={28} color={ON_ACCENT} />
      </Pressable>
    </SafeAreaView>
  );
}

function EmployeeHome() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile, organization } = useAuth();
  const { tasks, members, history, loading, refresh, setTaskCompletion } = useOrgData();
  const [proofTask, setProofTask] = useState<OrgTask | null>(null);
  const [checklistTask, setChecklistTask] = useState<OrgTask | null>(null);

  const myTasks = tasks
    .filter((t) => t.assigneeId === profile?.id || t.assigneeId === null)
    .map((t) => ({ ...t, completed: effectiveTaskCompleted(t, history) }));
  const { overdue, today, upcoming, completed } = bucketTasks(myTasks);


  const handlePressCheckbox = (task: OrgTask) => {
    if (task.templateId) {
      // A checklist can't be unchecked by hand — it only comes due again via
      // its cooldown or a rejected off-duty claim.
      if (!task.completed) setChecklistTask(task);
      return;
    }
    if (!task.completed && task.requiresProof) {
      setProofTask(task);
      return;
    }
    setTaskCompletion(task.id, !task.completed).catch((e) => console.warn(e));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.brand} />}
      >
        <Text style={{ fontSize: 13, color: c.textFaint }}>
          {new Date().toLocaleDateString(i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginTop: 2 }}>{t('dashboard.myTasksTitle')}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{organization?.name}</Text>

        <TodayChecklistCard />
        <OilTestCard />

        {myTasks.length === 0 ? null : (
          <View style={{ marginTop: 16 }}>
            <Section title={t('dashboard.sectionOverdue')} count={overdue.length} iconColor={c.rose}>
              {overdue.map((task) => (
                <TaskRow key={task.id} task={task} members={members} showAssignee={task.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(task)} />
              ))}
            </Section>
            <Section title={t('dashboard.sectionToday')} count={today.length} iconColor={c.brand}>
              {today.map((task) => (
                <TaskRow key={task.id} task={task} members={members} showAssignee={task.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(task)} />
              ))}
            </Section>
          </View>
        )}

        <MyAuditScore />

      </ScrollView>

      {proofTask ? (
        <CompleteTaskSheet
          task={proofTask}
          orgId={organization!.id}
          visible={!!proofTask}
          onCancel={() => setProofTask(null)}
          onSubmit={async (note, photoUrls) => {
            await setTaskCompletion(proofTask.id, true, note || undefined, photoUrls);
            setProofTask(null);
          }}
        />
      ) : null}
      {checklistTask ? (
        <FillChecklistSheet
          task={checklistTask}
          orgId={organization!.id}
          visible={!!checklistTask}
          onClose={() => setChecklistTask(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function StatChip({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', gap: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 12, color }}>{label}</Text>
    </View>
  );
}

function TeamChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? c.brand : c.bgSubtle,
        borderWidth: 1,
        borderColor: active ? c.brand : c.border,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );
}

function SupervisorSummaryRow({ row, locale, streak }: { row: BranchSummaryRow; locale: string; streak: number }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
        <Text style={{ fontSize: 13, color: c.text }} numberOfLines={1}>
          {row.subjectName}
        </Text>
        {streak >= 2 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.roseSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Ionicons name="warning" size={10} color={c.rose} />
            <Text style={{ fontSize: 10, fontWeight: '700', color: c.rose }}>{t('dashboard.needsAttention', { count: streak })}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {row.scoreCount ? <ScorePill score={(row.scoreSum ?? 0) / row.scoreCount} showGrade={false} /> : null}
        <Text style={{ fontSize: 13, fontWeight: '600', color: row.totalPoints < 0 ? c.rose : c.emerald }}>
          {row.totalPoints} · {row.iqdAmount.toLocaleString(locale)} {t('dashboard.iqdSuffix')}
        </Text>
      </View>
    </View>
  );
}

/** Best-to-worst by average audit score this month — the "which branch is doing well" view. */
function BranchScoreboard({ branches }: { branches: BranchGroup[] }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const scored = branches.filter((b) => b.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore!);
  if (scored.length === 0) return null;
  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.text, marginBottom: 12 }}>{t('score.branchScores')}</Text>
      <View style={{ gap: 12 }}>
        {scored.map((b, i) => {
          const grade = gradeOf(b.avgScore!);
          const { fg } = gradeColors(grade, c);
          return (
            <View key={b.branchId}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                <Text style={{ width: 22, fontSize: 13, fontWeight: '800', color: i === 0 ? c.accent : c.textFaint }}>{i + 1}</Text>
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: c.text }} numberOfLines={1}>
                  {b.branchName}
                </Text>
                <Text style={{ fontSize: 11, color: c.textMuted, marginRight: 8 }}>
                  {t('score.auditsCount', { count: b.scoreCount })}
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '800', color: fg }}>{formatScore(b.avgScore!)}</Text>
                <Text style={{ fontSize: 11, color: c.textMuted }}>/100</Text>
              </View>
              <View style={{ marginLeft: 22, height: 8, borderRadius: 4, backgroundColor: c.bgSubtle, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, b.avgScore!)}%`, height: '100%', borderRadius: 4, backgroundColor: fg }} />
              </View>
              <Text style={{ marginLeft: 22, marginTop: 3, fontSize: 11, fontWeight: '700', color: fg }}>{t(`score.${grade}`)}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  const c = useThemeColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Ionicons name="checkbox-outline" size={28} color={c.brand} />
      </View>
      <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 }}>{text}</Text>
    </View>
  );
}
