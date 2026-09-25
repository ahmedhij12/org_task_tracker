import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { FillChecklistSheet } from '@/components/FillChecklistSheet';
import { ErrorBanner, useThemeColors } from '@/components/ui';
import type { OrgTask } from '@/types';

/** Templates named "… — Audit" are the audit checklists (the same name rule the old "+" screen used). */
const isAuditTemplateName = (name: string) => name.endsWith(' — Audit');

/**
 * The admin's way into an audit, now that the "+" screen is gone. An audit is
 * the admin's own reusable task over an audit template: the first tap creates
 * that task, every later tap reuses it. Branch, person and shift are chosen
 * inside the checklist, exactly as before.
 */
export function AuditCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const { tasks, teams, createTask } = useOrgData();
  const { templates } = useChecklists();
  const [openTask, setOpenTask] = useState<OrgTask | null>(null);
  const [picking, setPicking] = useState(false);
  // A template whose task was just created and has not arrived in `tasks` yet.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const auditTemplates = templates.filter((tpl) => !tpl.archived && isAuditTemplateName(tpl.name));
  const taskFor = (templateId: string) =>
    tasks.find((tk) => tk.isAudit && tk.assigneeId === profile?.id && tk.templateId === templateId);

  useEffect(() => {
    if (!pending) return;
    const tk = taskFor(pending);
    if (tk) {
      setPending(null);
      setOpenTask(tk);
    }
  }, [pending, tasks]);

  const start = async (templateId: string) => {
    setPicking(false);
    setError(null);
    const existing = taskFor(templateId);
    if (existing) {
      setOpenTask(existing);
      return;
    }
    const tpl = auditTemplates.find((x) => x.id === templateId);
    const teamId = profile?.teamIds[0] ?? teams[0]?.id;
    if (!tpl || !teamId || !profile) return;
    setPending(templateId);
    try {
      await createTask({
        title: tpl.name.replace(/ — Audit$/, ''),
        due: null,
        priority: 'medium',
        assigneeId: profile.id,
        requiresProof: false,
        teamId,
        templateId,
        cooldownHours: 0,
        requiresReview: false,
        isAudit: true,
      });
    } catch (e: any) {
      setPending(null);
      setError(e?.message ?? t('dashboard.auditStartFailed'));
    }
  };

  const onPress = () => {
    if (auditTemplates.length === 1) start(auditTemplates[0].id);
    else if (auditTemplates.length > 1) setPicking(true);
  };

  if (auditTemplates.length === 0) return null;

  return (
    <>
      <Pressable
        onPress={onPress}
        disabled={!!pending}
        accessibilityRole="button"
        testID="start-audit"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="clipboard" size={22} color={c.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{t('dashboard.auditCardTitle')}</Text>
          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t('dashboard.auditCardHint')}</Text>
        </View>
        {pending ? <ActivityIndicator color={c.brand} /> : <Ionicons name="add-circle" size={28} color={c.brand} />}
      </Pressable>
      {error ? (
        <View style={{ marginTop: 8 }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 }} onPress={() => setPicking(false)}>
          <View style={{ backgroundColor: c.bg, borderRadius: 18, padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 10 }}>{t('dashboard.auditPickTitle')}</Text>
            {auditTemplates.map((tpl) => (
              <Pressable key={tpl.id} onPress={() => start(tpl.id)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Text style={{ fontSize: 15, color: c.text }}>{tpl.name.replace(/ — Audit$/, '')}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {openTask && organization ? (
        <FillChecklistSheet task={openTask} orgId={organization.id} visible={!!openTask} onClose={() => setOpenTask(null)} />
      ) : null}
    </>
  );
}
