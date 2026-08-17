import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { FillChecklistSheet } from '@/components/FillChecklistSheet';
import { CreateChecklistTemplateSheet } from '@/components/CreateChecklistTemplateSheet';
import { AssignChecklistSheet } from '@/components/AssignChecklistSheet';
import { ChecklistSubmissionDetailSheet } from '@/components/ChecklistSubmissionDetailSheet';
import { Card, useThemeColors } from '@/components/ui';
import { isChecklistDue } from '@/types';
import type { ChecklistAssignment, ChecklistSubmission, ChecklistTemplate } from '@/types';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function hoursUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

export default function ChecklistsScreen() {
  const c = useThemeColors();
  const { profile, organization } = useAuth();
  const { members, refresh: refreshOrgData, loading: orgLoading } = useOrgData();
  const { templates, templateItems, assignments, submissions, loading, refresh } = useChecklists();

  const [filling, setFilling] = useState<ChecklistAssignment | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [assigningTemplate, setAssigningTemplate] = useState<ChecklistTemplate | null>(null);
  const [viewingSubmission, setViewingSubmission] = useState<ChecklistSubmission | null>(null);

  const isManager = profile?.role === 'owner' || profile?.role === 'team_admin';

  const myAssignments = useMemo(
    () => assignments.filter((a) => a.assigneeId === profile?.id),
    [assignments, profile?.id]
  );

  const latestSubmissionFor = (assignmentId: string) =>
    submissions.find((s) => s.assignmentId === assignmentId) ?? null; // submissions is already newest-first

  const dueNow = myAssignments.filter((a) => {
    const template = templates.find((t) => t.id === a.templateId);
    if (!template) return false;
    return isChecklistDue(latestSubmissionFor(a.id), template.cooldownHours);
  });
  const notDueYet = myAssignments.filter((a) => !dueNow.includes(a));

  const myRecentSubmissions = submissions.filter((s) => s.actorId === profile?.id).slice(0, 15);

  const pendingReview = isManager ? submissions.filter((s) => s.status === 'off_duty_pending') : [];
  const teamActivity = isManager ? submissions.filter((s) => s.status !== 'off_duty_pending').slice(0, 30) : [];

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';

  const onRefresh = async () => {
    await Promise.all([refresh(), refreshOrgData()]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading || orgLoading} onRefresh={onRefresh} tintColor={c.indigo} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>Checklists</Text>
          {isManager ? (
            <Pressable
              onPress={() => setCreatingTemplate(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.indigo, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Template</Text>
            </Pressable>
          ) : null}
        </View>

        {dueNow.length > 0 ? (
          <SectionHeader label="Due now" count={dueNow.length} color={c.indigo} />
        ) : null}
        {dueNow.map((a) => {
          const template = templates.find((t) => t.id === a.templateId)!;
          return (
            <Pressable key={a.id} onPress={() => setFilling(a)}>
              <Card style={{ marginBottom: 8, borderColor: c.indigo }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="checkbox" size={18} color={c.indigo} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{template.name}</Text>
                    <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>Tap to fill it out</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </View>
              </Card>
            </Pressable>
          );
        })}

        {notDueYet.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            <SectionHeader label="Not due yet" count={notDueYet.length} color={c.textMuted} />
            {notDueYet.map((a) => {
              const template = templates.find((t) => t.id === a.templateId);
              const last = latestSubmissionFor(a.id);
              const readyAt = last
                ? new Date(new Date(last.createdAt).getTime() + (template?.cooldownHours ?? 7) * 3_600_000).toISOString()
                : null;
              return (
                <Card key={a.id} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>{template?.name}</Text>
                  <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>
                    {last?.status === 'off_duty_pending'
                      ? 'Waiting for your admin to review your off-duty note'
                      : readyAt
                        ? `Due again in about ${hoursUntil(readyAt)}h`
                        : 'Not due yet'}
                  </Text>
                </Card>
              );
            })}
          </View>
        ) : null}

        {myAssignments.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textFaint, marginBottom: 16 }}>
            No checklists assigned to you yet.
          </Text>
        ) : null}

        {myRecentSubmissions.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            <SectionHeader label="Your recent submissions" count={myRecentSubmissions.length} color={c.textMuted} />
            {myRecentSubmissions.map((s) => (
              <SubmissionRow key={s.id} submission={s} actorName={nameOf(s.actorId)} onPress={() => setViewingSubmission(s)} />
            ))}
          </View>
        ) : null}

        {isManager ? (
          <>
            <View style={{ marginTop: 22 }}>
              <SectionHeader label="Templates" count={templates.length} color={c.indigo} />
              {templates.length === 0 ? (
                <Text style={{ fontSize: 13, color: c.textFaint }}>No templates yet. Create one to start assigning.</Text>
              ) : null}
              {templates.map((t) => {
                const itemCount = templateItems.filter((it) => it.templateId === t.id).length;
                const assignedCount = assignments.filter((a) => a.templateId === t.id).length;
                return (
                  <Card key={t.id} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{t.name}</Text>
                        <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>
                          {itemCount} questions • every {t.cooldownHours}h • {assignedCount} assigned
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => setAssigningTemplate(t)}
                        style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: c.indigo }}>Assign</Text>
                      </Pressable>
                    </View>
                  </Card>
                );
              })}
            </View>

            {pendingReview.length > 0 ? (
              <View style={{ marginTop: 22 }}>
                <SectionHeader label="Needs review" count={pendingReview.length} color={c.amber} />
                {pendingReview.map((s) => (
                  <Pressable key={s.id} onPress={() => setViewingSubmission(s)}>
                    <Card style={{ marginBottom: 8, borderColor: c.amber }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="alert-circle" size={18} color={c.amber} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>
                            {nameOf(s.actorId)} says off duty
                          </Text>
                          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }} numberOfLines={1}>
                            {s.templateName} — "{s.offDutyReason}"
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {teamActivity.length > 0 ? (
              <View style={{ marginTop: 22 }}>
                <SectionHeader label={profile?.role === 'owner' ? 'Organization activity' : 'Team activity'} count={teamActivity.length} color={c.textMuted} />
                {teamActivity.map((s) => (
                  <SubmissionRow key={s.id} submission={s} actorName={nameOf(s.actorId)} onPress={() => setViewingSubmission(s)} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {filling ? (
        <FillChecklistSheet
          assignment={filling}
          template={templates.find((t) => t.id === filling.templateId)!}
          items={templateItems.filter((it) => it.templateId === filling.templateId)}
          orgId={organization!.id}
          visible={!!filling}
          onClose={() => setFilling(null)}
        />
      ) : null}
      <CreateChecklistTemplateSheet visible={creatingTemplate} onClose={() => setCreatingTemplate(false)} />
      <AssignChecklistSheet template={assigningTemplate} onClose={() => setAssigningTemplate(null)} />
      <ChecklistSubmissionDetailSheet submission={viewingSubmission} onClose={() => setViewingSubmission(null)} />
    </SafeAreaView>
  );
}

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  const c = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 12, color: c.textFaint }}>{count}</Text>
    </View>
  );
}

function SubmissionRow({
  submission,
  actorName,
  onPress,
}: {
  submission: ChecklistSubmission;
  actorName: string;
  onPress: () => void;
}) {
  const c = useThemeColors();
  const isOffDuty = submission.status.startsWith('off_duty');
  const icon = isOffDuty
    ? submission.status === 'off_duty_approved'
      ? 'checkmark-circle'
      : submission.status === 'off_duty_rejected'
        ? 'close-circle'
        : 'time'
    : submission.noCount > 0
      ? 'alert-circle'
      : 'checkmark-circle';
  const iconColor = isOffDuty
    ? submission.status === 'off_duty_approved'
      ? c.emerald
      : submission.status === 'off_duty_rejected'
        ? c.rose
        : c.amber
    : submission.noCount > 0
      ? c.amber
      : c.emerald;

  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name={icon as any} size={16} color={iconColor} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>{submission.templateName}</Text>
            <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>
              {actorName} • {when(submission.createdAt)}
              {!isOffDuty ? ` • ${submission.yesCount} yes / ${submission.noCount} no` : ' • off duty'}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
