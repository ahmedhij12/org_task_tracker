import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { resizeImage } from '@/lib/resizeImage';
import { useAuth } from '@/hooks/useAuth';
import { ScoreRing } from '@/components/ScoreRing';
import { computeScore } from '@/lib/score';
import { useChecklists } from '@/hooks/useChecklists';
import { useOrgData } from '@/hooks/useOrgData';
import { SignaturePad } from '@/components/SignaturePad';
import { SelfieCapture } from '@/components/SelfieCapture';
import { SigningLocation, type SignedLocation } from '@/components/SigningLocation';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OrgTask } from '@/types';

interface Props {
  task: OrgTask;
  orgId: string;
  visible: boolean;
  onClose: () => void;
}

interface Shot {
  uri: string;
  base64: string;
}

const MAX_PHOTOS_PER_SECTION = 4;

// Same sentinel as branchSummary.ts's brandKey, for the same concept: a
// deliberate "no brand" bucket, distinct from auditBrandId === null (which
// means "no brand chosen yet / this branch has no brand step at all").
const UNASSIGNED_BRAND_ID = '__unassigned__';

export function FillChecklistSheet({ task, orgId, visible, onClose }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const { templates, templateItems } = useChecklists();
  const { teams, members, brands, branchBrandIds, setTaskCompletion, declareTaskOffDuty } = useOrgData();

  const template = templates.find((t) => t.id === task.templateId);
  const items = useMemo(() => templateItems.filter((it) => it.templateId === task.templateId), [templateItems, task.templateId]);

  const [mode, setMode] = useState<'fill' | 'off_duty'>('fill');
  const [answers, setAnswers] = useState<Record<string, { answer: boolean | 'na' | null; note: string }>>({});
  const [sectionPhotos, setSectionPhotos] = useState<Record<string, Shot[]>>({});
  const [offDutyReason, setOffDutyReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Left to answer" filter: the question ids that were still open when it
  // was turned on. A snapshot, not live — otherwise a question would vanish
  // the moment it's answered No, before its note can be typed.
  const [leftOnly, setLeftOnly] = useState<Set<string> | null>(null);
  const listRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  // Audit-only: the branch, subject and shift are chosen fresh each time,
  // right here — never fixed when the audit task itself was created.
  const [auditStep, setAuditStep] = useState<'branch' | 'brand' | 'subject' | 'shift' | 'fill'>('branch');
  const [auditBranchId, setAuditBranchId] = useState<string | null>(null);
  const [auditBrandId, setAuditBrandId] = useState<string | null>(null);
  const [auditSubjectId, setAuditSubjectId] = useState<string | null>(null);
  const [auditShift, setAuditShift] = useState<'morning' | 'evening' | null>(null);
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [signedLocation, setSignedLocation] = useState<SignedLocation | null>(null);
  const [selfie, setSelfie] = useState<{ uri: string; base64: string } | null>(null);
  const [selfieOpen, setSelfieOpen] = useState(false);
  const handleLocation = useCallback((loc: SignedLocation | null) => setSignedLocation(loc), []);

  const branchMembers = members.filter(
    (m) =>
      m.id !== profile?.id &&
      m.role !== 'owner' &&
      auditBranchId != null &&
      m.teamIds.includes(auditBranchId) &&
      (auditBrandId == null
        ? true
        : auditBrandId === UNASSIGNED_BRAND_ID
          ? m.teamBrandIds[auditBranchId] == null
          : m.teamBrandIds[auditBranchId] === auditBrandId)
  );
  const auditBrand =
    auditBrandId === UNASSIGNED_BRAND_ID
      ? { id: UNASSIGNED_BRAND_ID, name: 'Unassigned' }
      : brands.find((b) => b.id === auditBrandId);
  const auditSubject = members.find((m) => m.id === auditSubjectId);

  const sections = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const it of items) {
      const list = map.get(it.sectionTitle) ?? [];
      list.push(it);
      map.set(it.sectionTitle, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const reset = () => {
    setMode('fill');
    setAnswers({});
    setLeftOnly(null);
    setSectionPhotos({});
    setOffDutyReason('');
    setError(null);
    setAuditStep('branch');
    setAuditBranchId(null);
    setAuditBrandId(null);
    setAuditSubjectId(null);
    setAuditShift(null);
    setSignatureSvg(null);
    setSelfie(null);
  };

  const handleClose = () => {
    // Closing mid-submit would unmount the sheet while the upload keeps going,
    // and a reopen-and-resubmit would save the checklist twice.
    if (submitting) return;
    reset();
    onClose();
  };

  const setAnswer = (itemId: string, value: boolean | 'na') => {
    setAnswers((prev) => ({ ...prev, [itemId]: { answer: value, note: prev[itemId]?.note ?? '' } }));
  };

  const setNote = (itemId: string, note: string) => {
    setAnswers((prev) => ({ ...prev, [itemId]: { answer: prev[itemId]?.answer ?? null, note } }));
  };

  const takePhoto = async (sectionTitle: string) => {
    setError(null);
    const current = sectionPhotos[sectionTitle] ?? [];
    if (current.length >= MAX_PHOTOS_PER_SECTION) {
      setError(t('fill.maxPhotos', { count: MAX_PHOTOS_PER_SECTION }));
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t('fill.cameraNeeded'));
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, base64: true });
      if (!result.canceled && result.assets[0]?.base64) {
        const small = await resizeImage(result.assets[0].base64);
        setSectionPhotos((prev) => ({
          ...prev,
          [sectionTitle]: [...(prev[sectionTitle] ?? []), { uri: result.assets[0].uri, base64: small }],
        }));
      }
    } catch (e: any) {
      setError(e?.message ?? t('fill.cameraFailed'));
    }
  };

  const removePhoto = (sectionTitle: string, index: number) => {
    setSectionPhotos((prev) => ({
      ...prev,
      [sectionTitle]: (prev[sectionTitle] ?? []).filter((_, i) => i !== index),
    }));
  };

  const unanswered = items.filter((it) => answers[it.id]?.answer == null);
  const missingNotes = template?.requiresNoteOnNo
    ? items.filter((it) => answers[it.id]?.answer === false && !answers[it.id]?.note.trim())
    : [];
  const leftCount = unanswered.length + missingNotes.length;
  const showLeftOnly = () => {
    setLeftOnly(new Set([...unanswered, ...missingNotes].map((it) => it.id)));
    listRef.current?.scrollTo({ y: 0, animated: false });
  };
  const showAll = () => {
    setLeftOnly(null);
    listRef.current?.scrollTo({ y: 0, animated: false });
  };
  // A preview only — the real total that gets stored is always computed
  // server-side in set_task_completion, from the same answers.
  const totalPoints = items.reduce(
    (sum, it) => (answers[it.id]?.answer === false ? sum - it.pointWeight : sum),
    0
  );
  const totalIqd = Math.abs(totalPoints) * (organization?.iqdPerPoint ?? 25000);
  const previewScore = computeScore(
    items.map((it) => {
      const a = answers[it.id]?.answer;
      return { answer: a === true ? true : a === false ? false : null, weight: it.pointWeight };
    })
  );
  // The supervisors' daily checklist carries proof they were really there.
  const needsProof = !task.isAudit && !!template?.assignToRole;
  const canSubmit =
    unanswered.length === 0 &&
    missingNotes.length === 0 &&
    !submitting &&
    !!template &&
    (!task.isAudit || (!!signatureSvg && !!signedLocation)) &&
    (!needsProof || (!!selfie && !!signedLocation && !!signatureSvg));

  // Opens the front-camera capture (SelfieCapture forces the front camera and a
  // live shot on web, where the OS picker otherwise allows any file/rear camera).
  const takeSelfie = () => { setError(null); setSelfieOpen(true); };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const uploadedPhotos: { sectionTitle: string; photoUrl: string }[] = [];
      for (const [sectionTitle, shots] of Object.entries(sectionPhotos)) {
        for (let i = 0; i < shots.length; i += 1) {
          const safeSection = sectionTitle.replace(/[^a-zA-Z0-9]/g, '') || 'section';
          const path = `${orgId}/checklist-${task.id}-${Date.now()}-${safeSection}-${i}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('task-proofs')
            .upload(path, decode(shots[i].base64), { contentType: 'image/jpeg' });
          if (uploadError) throw uploadError;
          const { data: publicUrl } = supabase.storage.from('task-proofs').getPublicUrl(path);
          uploadedPhotos.push({ sectionTitle, photoUrl: publicUrl.publicUrl });
        }
      }

      let signatureUrl: string | undefined;
      if ((task.isAudit || needsProof) && signatureSvg) {
        const path = `${orgId}/signature-${task.id}-${Date.now()}.svg`;
        const { error: sigError } = await supabase.storage
          .from('task-proofs')
          .upload(path, signatureSvg, { contentType: 'image/svg+xml' });
        if (sigError) throw sigError;
        signatureUrl = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      }

      let selfieUrl: string | undefined;
      if (needsProof && selfie) {
        const path = `${orgId}/selfie-${task.id}-${Date.now()}.jpg`;
        const { error: selfieError } = await supabase.storage
          .from('task-proofs')
          .upload(path, decode(selfie.base64), { contentType: 'image/jpeg' });
        if (selfieError) throw selfieError;
        selfieUrl = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      }

      const payload = items.map((it, i) => {
        const a = answers[it.id]!.answer;
        return {
          sectionTitle: it.sectionTitle,
          question: it.question,
          sortOrder: i,
          answer: a === 'na' ? null : a,
          // The note box only shows on a "No" — a reason typed and then
          // switched to Yes is hidden, so it must not be saved either.
          note: a === false ? answers[it.id]!.note.trim() || undefined : undefined,
        };
      });

      await setTaskCompletion(
        task.id,
        true,
        undefined,
        [],
        payload,
        uploadedPhotos,
        task.isAudit && auditSubjectId && auditShift
          ? { subjectProfileId: auditSubjectId, shift: auditShift, signatureUrl, location: signedLocation ?? undefined }
          : undefined,
        needsProof && selfieUrl && signedLocation ? { selfieUrl, signatureUrl, location: signedLocation } : undefined
      );
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? t('fill.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclareOffDuty = async () => {
    if (!offDutyReason.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await declareTaskOffDuty(task.id, offDutyReason.trim());
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? t('fill.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!template) return null;

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ maxHeight: '92%', flexShrink: 1 }}
        >
          {/* flexShrink + minHeight: 0 all the way down is what lets the question
              ScrollView actually shrink to fit inside the card instead of growing
              to its full content height — without it, a 79-question checklist has
              nothing scrollable, it's just clipped at the modal's edge. */}
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: Math.max(32, insets.bottom + 16),
              flexShrink: 1,
              minHeight: 0,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{task.title}</Text>
              <Pressable onPress={handleClose} hitSlop={8}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>

            {task.isAudit && auditStep !== 'fill' ? (
              <View style={{ paddingBottom: 8 }}>
                {auditStep === 'branch' ? (
                  <>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 10 }}>Which branch?</Text>
                    {teams.map((t) => (
                      <Pressable
                        key={t.id}
                        onPress={() => {
                          setAuditBranchId(t.id);
                          setAuditBrandId(null);
                          setAuditStep((branchBrandIds[t.id] ?? []).length > 0 ? 'brand' : 'subject');
                        }}
                        style={{
                          paddingVertical: 14,
                          paddingHorizontal: 14,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: c.border,
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{t.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : auditStep === 'brand' ? (
                  <>
                    <Pressable onPress={() => setAuditStep('branch')} style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, color: c.brand, fontWeight: '600' }}>{'< Back to branch'}</Text>
                    </Pressable>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 10 }}>Which brand?</Text>
                    {(branchBrandIds[auditBranchId ?? ''] ?? []).map((bid) => {
                      const brand = brands.find((b) => b.id === bid);
                      if (!brand) return null;
                      return (
                        <Pressable
                          key={bid}
                          onPress={() => {
                            setAuditBrandId(bid);
                            setAuditStep('subject');
                          }}
                          style={{
                            paddingVertical: 14,
                            paddingHorizontal: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: c.border,
                            marginBottom: 8,
                          }}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{brand.name}</Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      key={UNASSIGNED_BRAND_ID}
                      onPress={() => {
                        setAuditBrandId(UNASSIGNED_BRAND_ID);
                        setAuditStep('subject');
                      }}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 14,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: c.border,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>Unassigned</Text>
                    </Pressable>
                  </>
                ) : auditStep === 'subject' ? (
                  <>
                    <Pressable
                      onPress={() => setAuditStep((branchBrandIds[auditBranchId ?? ''] ?? []).length > 0 ? 'brand' : 'branch')}
                      style={{ marginBottom: 10 }}
                    >
                      <Text style={{ fontSize: 12, color: c.brand, fontWeight: '600' }}>{'< Back'}</Text>
                    </Pressable>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 10 }}>Who are you auditing?</Text>
                    {branchMembers.length === 0 ? (
                      <Text style={{ fontSize: 13, color: c.textFaint }}>Nobody on this branch yet.</Text>
                    ) : null}
                    {branchMembers.map((m) => (
                      <Pressable
                        key={m.id}
                        onPress={() => {
                          setAuditSubjectId(m.id);
                          setAuditStep('shift');
                        }}
                        style={{
                          paddingVertical: 14,
                          paddingHorizontal: 14,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: c.border,
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{m.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : (
                  <>
                    <Pressable onPress={() => setAuditStep('subject')} style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, color: c.brand, fontWeight: '600' }}>{'< Back to who'}</Text>
                    </Pressable>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 10 }}>Which shift?</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(
                        [
                          { key: 'morning', label: 'AM' },
                          { key: 'evening', label: 'PM' },
                        ] as { key: 'morning' | 'evening'; label: string }[]
                      ).map((opt) => (
                        <Pressable
                          key={opt.key}
                          onPress={() => {
                            setAuditShift(opt.key);
                            setAuditStep('fill');
                          }}
                          style={{
                            flex: 1,
                            alignItems: 'center',
                            paddingVertical: 16,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: c.border,
                          }}
                        >
                          <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{opt.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
              </View>
            ) : mode === 'fill' ? (
              <>
                {task.isAudit ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, color: c.textMuted }}>
                      {teams.find((t) => t.id === auditBranchId)?.name}
                      {auditBrand ? ` • ${auditBrand.name}` : ''} • {auditSubject?.name} • {auditShift === 'morning' ? 'AM' : 'PM'}
                    </Text>
                    <Pressable onPress={() => setAuditStep('branch')}>
                      <Text style={{ fontSize: 12, color: c.brand, fontWeight: '600' }}>Change</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setMode('off_duty')} style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, color: c.brand, fontWeight: '600' }}>{t('fill.notOnDuty')}</Text>
                  </Pressable>
                )}

                {error ? <ErrorBanner message={error} /> : null}

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {[
                    { key: 'all', label: t('fill.filterAll', { count: items.length }), active: !leftOnly, onPress: showAll },
                    { key: 'left', label: t('fill.filterLeft', { count: leftCount }), active: !!leftOnly, onPress: showLeftOnly },
                  ].map((opt) => (
                    <Pressable
                      key={opt.key}
                      onPress={opt.onPress}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 999,
                        backgroundColor: opt.active ? c.brand : c.bgSubtle,
                        borderWidth: 1,
                        borderColor: opt.active ? c.brand : c.border,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: opt.active ? '#fff' : c.text }}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <ScrollView ref={listRef} keyboardShouldPersistTaps="handled" style={{ marginBottom: 14, flexShrink: 1, minHeight: 0 }}>
                  {leftOnly && leftCount === 0 ? (
                    <Text style={{ fontSize: 13, color: c.emerald, fontWeight: '600', paddingVertical: 12 }}>
                      {t('fill.allAnswered')}
                    </Text>
                  ) : null}
                  {sections.map(([sectionTitle, allSectionItems]) => {
                    const sectionItems = leftOnly ? allSectionItems.filter((it) => leftOnly.has(it.id)) : allSectionItems;
                    if (sectionItems.length === 0) return null;
                    return (
                    <View key={sectionTitle || '_'} style={{ marginBottom: 18 }}>
                      {sectionTitle ? (
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '700',
                            color: c.brand,
                            marginBottom: 8,
                            textAlign: textAlignFor(sectionTitle),
                          }}
                        >
                          {sectionTitle}
                        </Text>
                      ) : null}

                      {sectionItems.map((it) => {
                        const state = answers[it.id];
                        const showNoteWarning =
                          template.requiresNoteOnNo && state?.answer === false && !state?.note.trim();
                        return (
                          <View key={it.id} style={{ marginBottom: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                              <Text
                                style={{ fontSize: 14, color: c.text, marginBottom: 6, flex: 1, textAlign: textAlignFor(it.question) }}
                              >
                                {it.question}
                              </Text>
                              {task.isAudit ? (
                                <Text style={{ fontSize: 11, color: c.textFaint }}>{it.pointWeight} pts</Text>
                              ) : null}
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              <Pressable
                                onPress={() => setAnswer(it.id, true)}
                                style={{
                                  flex: 1,
                                  alignItems: 'center',
                                  paddingVertical: 9,
                                  borderRadius: 10,
                                  backgroundColor: state?.answer === true ? c.emerald : c.bgSubtle,
                                  borderWidth: 1,
                                  borderColor: state?.answer === true ? c.emerald : c.border,
                                }}
                              >
                                <Text style={{ fontSize: 13, fontWeight: '700', color: state?.answer === true ? '#fff' : c.text }}>
                                  {t('fill.yes')}
                                </Text>
                              </Pressable>
                              <Pressable
                                onPress={() => setAnswer(it.id, false)}
                                style={{
                                  flex: 1,
                                  alignItems: 'center',
                                  paddingVertical: 9,
                                  borderRadius: 10,
                                  backgroundColor: state?.answer === false ? c.rose : c.bgSubtle,
                                  borderWidth: 1,
                                  borderColor: state?.answer === false ? c.rose : c.border,
                                }}
                              >
                                <Text style={{ fontSize: 13, fontWeight: '700', color: state?.answer === false ? '#fff' : c.text }}>
                                  {t('fill.no')}
                                </Text>
                              </Pressable>
                              {/* N/A is the auditor's alone (a question may not apply at a brand); supervisors answer Yes or No. */}
                              {task.isAudit ? (
                              <Pressable
                                onPress={() => setAnswer(it.id, 'na')}
                                style={{
                                  flex: 1,
                                  alignItems: 'center',
                                  paddingVertical: 9,
                                  borderRadius: 10,
                                  backgroundColor: state?.answer === 'na' ? c.textMuted : c.bgSubtle,
                                  borderWidth: 1,
                                  borderColor: state?.answer === 'na' ? c.textMuted : c.border,
                                }}
                              >
                                <Text style={{ fontSize: 13, fontWeight: '700', color: state?.answer === 'na' ? '#fff' : c.text }}>
                                  {t('fill.na')}
                                </Text>
                              </Pressable>
                              ) : null}
                            </View>
                            {state?.answer === false ? (
                              <TextInput
                                value={state.note}
                                onChangeText={(t) => setNote(it.id, t)}
                                placeholder={template.requiresNoteOnNo ? t('fill.whyRequired') : t('fill.noteOptional')}
                                placeholderTextColor={c.textFaint}
                                style={{
                                  marginTop: 6,
                                  borderWidth: 1,
                                  borderColor: showNoteWarning ? c.rose : c.border,
                                  borderRadius: 10,
                                  padding: 10,
                                  fontSize: 13,
                                  color: c.text,
                                  textAlign: textAlignFor(state.note || it.question),
                                }}
                              />
                            ) : null}
                          </View>
                        );
                      })}

                      {leftOnly ? null : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        {(sectionPhotos[sectionTitle] ?? []).map((s, i) => (
                          <View key={s.uri + i} style={{ position: 'relative' }}>
                            <Image source={{ uri: s.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} resizeMode="cover" />
                            <Pressable
                              onPress={() => removePhoto(sectionTitle, i)}
                              hitSlop={6}
                              style={{
                                position: 'absolute',
                                top: -6,
                                right: -6,
                                backgroundColor: c.rose,
                                borderRadius: 999,
                                width: 20,
                                height: 20,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons name="close" size={12} color="#fff" />
                            </Pressable>
                          </View>
                        ))}
                        {(sectionPhotos[sectionTitle] ?? []).length < MAX_PHOTOS_PER_SECTION ? (
                          <Pressable
                            onPress={() => takePhoto(sectionTitle)}
                            style={{
                              width: 72,
                              height: 72,
                              borderRadius: 10,
                              borderWidth: 1,
                              borderStyle: 'dashed',
                              borderColor: c.border,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Ionicons name="camera" size={20} color={c.textMuted} />
                          </Pressable>
                        ) : null}
                      </View>
                      )}
                    </View>
                    );
                  })}
                  {/* The proof (signature, selfie, location) scrolls with the questions:
                      pinned below the list it outgrew the sheet and pushed Submit off-screen. */}
                  {task.isAudit && unanswered.length === 0 ? (
                    <View style={{ marginBottom: 14 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 16,
                          backgroundColor: c.bgSubtle,
                          borderRadius: 16,
                          padding: 14,
                          marginBottom: 12,
                        }}
                      >
                        {previewScore != null ? <ScoreRing score={previewScore} size={84} /> : null}
                        <View style={{ flex: 1, gap: 8 }}>
                          <View>
                            <Text style={{ fontSize: 11, color: c.textMuted }}>{t('fill.penalty')}</Text>
                            <Text style={{ fontSize: 15, fontWeight: '700', color: totalPoints < 0 ? c.rose : c.text }}>
                              {totalPoints} pts
                            </Text>
                          </View>
                          <View>
                            <Text style={{ fontSize: 11, color: c.textMuted }}>{t('fill.amount')}</Text>
                            <Text style={{ fontSize: 15, fontWeight: '700', color: totalPoints < 0 ? c.rose : c.text }}>
                              {totalIqd.toLocaleString()} IQD
                            </Text>
                          </View>
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('fill.signToConfirm')}</Text>
                      <SignaturePad onChange={setSignatureSvg} />
                      <SigningLocation onChange={handleLocation} />
                    </View>
                  ) : null}

                  {needsProof && unanswered.length === 0 ? (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('fill.confirmHere')}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.bgSubtle, borderRadius: 14, padding: 12 }}>
                        {selfie ? (
                          <Image source={{ uri: selfie.uri }} style={{ width: 72, height: 72, borderRadius: 36 }} />
                        ) : (
                          <View
                            style={{
                              width: 72,
                              height: 72,
                              borderRadius: 36,
                              borderWidth: 2,
                              borderStyle: 'dashed',
                              borderColor: c.border,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Ionicons name="person" size={30} color={c.textFaint} />
                          </View>
                        )}
                        <View style={{ flex: 1, gap: 6 }}>
                          <Text style={{ fontSize: 12, color: c.textMuted }}>
                            {selfie ? t('fill.selfieTaken') : t('fill.selfieHint')}
                          </Text>
                          <Pressable
                            onPress={takeSelfie}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 6,
                              alignSelf: 'flex-start',
                              backgroundColor: selfie ? c.card : c.brand,
                              borderWidth: 1,
                              borderColor: selfie ? c.border : c.brand,
                              borderRadius: 999,
                              paddingHorizontal: 14,
                              paddingVertical: 8,
                            }}
                          >
                            <Ionicons name="camera" size={15} color={selfie ? c.text : '#fff'} />
                            <Text style={{ fontSize: 13, fontWeight: '700', color: selfie ? c.text : '#fff' }}>
                              {selfie ? t('fill.retake') : t('fill.takeSelfie')}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginTop: 14, marginBottom: 8 }}>
                        {t('fill.signToConfirm')}
                      </Text>
                      <SignaturePad onChange={setSignatureSvg} />
                      <SigningLocation onChange={handleLocation} />
                    </View>
                  ) : null}
                </ScrollView>


                <Text
                  onPress={leftCount > 0 ? showLeftOnly : undefined}
                  style={{ fontSize: 12, color: leftCount > 0 ? c.brand : c.textMuted, marginBottom: 10 }}
                >
                  {unanswered.length > 0
                    ? t('fill.left', { count: unanswered.length })
                    : missingNotes.length > 0
                      ? t('fill.needNote', { count: missingNotes.length })
                      : task.isAudit && !signatureSvg
                        ? t('fill.signAbove')
                        : task.isAudit && !signedLocation
                          ? t('fill.waitingLocation')
                          : needsProof && !selfie
                            ? t('fill.selfieToSubmit')
                            : needsProof && !signatureSvg
                              ? t('fill.signAbove')
                            : needsProof && !signedLocation
                              ? t('fill.waitingLocation')
                              : t('fill.ready')}
                </Text>

                {submitting ? (
                  <View style={{ paddingVertical: 14, alignItems: 'center' }}>
                    <ActivityIndicator color={c.brand} />
                  </View>
                ) : (
                  <>
                    <PrimaryButton title={t('fill.submit')} onPress={handleSubmit} disabled={!canSubmit} />
                    <View style={{ height: 10 }} />
                    <SecondaryButton title={t('fill.cancel')} onPress={handleClose} />
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 14 }}>
                  {t('fill.offDutyExplain')}
                </Text>

                {error ? <ErrorBanner message={error} /> : null}

                <TextInput
                  value={offDutyReason}
                  onChangeText={setOffDutyReason}
                  placeholder={t('fill.offDutyReason')}
                  placeholderTextColor={c.textFaint}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 14,
                    padding: 12,
                    minHeight: 80,
                    fontSize: 14,
                    color: c.text,
                    textAlignVertical: 'top',
                    marginBottom: 14,
                  }}
                />

                {submitting ? (
                  <View style={{ paddingVertical: 14, alignItems: 'center' }}>
                    <ActivityIndicator color={c.brand} />
                  </View>
                ) : (
                  <>
                    <PrimaryButton title={t('fill.send')} onPress={handleDeclareOffDuty} disabled={!offDutyReason.trim()} />
                    <View style={{ height: 10 }} />
                    <SecondaryButton title={t('fill.back')} onPress={() => setMode('fill')} />
                  </>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    <SelfieCapture
      visible={selfieOpen}
      onCapture={(shot) => setSelfie(shot)}
      onClose={() => setSelfieOpen(false)}
      onError={() => setError(t('fill.selfieCameraNeeded'))}
    />
    </>
  );
}
