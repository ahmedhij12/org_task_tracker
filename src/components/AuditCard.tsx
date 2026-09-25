import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { FillChecklistSheet } from '@/components/FillChecklistSheet';
import { CreateChecklistTemplateSheet } from '@/components/CreateChecklistTemplateSheet';
import { ErrorBanner, useThemeColors } from '@/components/ui';
import type { ChecklistTemplate, OrgTask } from '@/types';

/** Templates named "… — Audit" are the audit checklists (the same name rule the old "+" screen used). */
const isAuditTemplateName = (name: string) => name.endsWith(' — Audit');

/**
 * The admin's audit checklists (today: the Daily Hygiene Checklist), always
 * on the dashboard — tap to start an audit, pencil to edit its questions. This
 * replaces the "+" screen. Behind each card is the admin's own reusable audit
 * task over that template: the first tap creates it, every later tap reuses
 * it. Branch, person and shift are chosen inside the checklist, as before.
 */
export function AuditCards() {
  const { templates } = useChecklists();
  const auditTemplates = templates.filter((tpl) => !tpl.archived && isAuditTemplateName(tpl.name));
  return (
    <>
      {auditTemplates.map((tpl) => (
        <AuditCard key={tpl.id} template={tpl} />
      ))}
    </>
  );
}

function AuditCard({ template }: { template: ChecklistTemplate }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const { tasks, teams, createTask } = useOrgData();
  const [openTask, setOpenTask] = useState<OrgTask | null>(null);
  const [editing, setEditing] = useState(false);
  // The task was just created and has not arrived in `tasks` yet.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myTask = tasks.find((tk) => tk.isAudit && tk.assigneeId === profile?.id && tk.templateId === template.id);

  useEffect(() => {
    if (pending && myTask) {
      setPending(false);
      setOpenTask(myTask);
    }
  }, [pending, myTask]);

  const start = async () => {
    setError(null);
    if (myTask) {
      setOpenTask(myTask);
      return;
    }
    const teamId = profile?.teamIds[0] ?? teams[0]?.id;
    if (!teamId || !profile) return;
    setPending(true);
    try {
      await createTask({
        title: template.name.replace(/ — Audit$/, ''),
        due: null,
        priority: 'medium',
        assigneeId: profile.id,
        requiresProof: false,
        teamId,
        templateId: template.id,
        cooldownHours: 0,
        requiresReview: false,
        isAudit: true,
      });
    } catch (e: any) {
      setPending(false);
      setError(e?.message ?? t('dashboard.auditStartFailed'));
    }
  };

  return (
    <>
      <Pressable
        onPress={start}
        disabled={pending}
        accessibilityRole="button"
        testID="start-audit"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="clipboard" size={22} color={c.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{template.name.replace(/ — Audit$/, '')}</Text>
          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t('dashboard.auditCardHint')}</Text>
        </View>
        <Pressable onPress={() => setEditing(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('dashboard.auditEdit')} testID="edit-audit-template">
          <Ionicons name="create-outline" size={22} color={c.textMuted} />
        </Pressable>
        {pending ? <ActivityIndicator color={c.brand} /> : <Ionicons name="add-circle" size={28} color={c.brand} />}
      </Pressable>
      {error ? (
        <View style={{ marginTop: 8 }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      {openTask && organization ? (
        <FillChecklistSheet task={openTask} orgId={organization.id} visible={!!openTask} onClose={() => setOpenTask(null)} />
      ) : null}
      <CreateChecklistTemplateSheet visible={editing} editingTemplateId={editing ? template.id : undefined} onClose={() => setEditing(false)} />
    </>
  );
}
