import { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useChecklists } from '@/hooks/useChecklists';
import { useOrgData } from '@/hooks/useOrgData';
import { SignaturePad } from '@/components/SignaturePad';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
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

export function FillChecklistSheet({ task, orgId, visible, onClose }: Props) {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { templates, templateItems } = useChecklists();
  const { teams, members, setTaskCompletion, declareTaskOffDuty } = useOrgData();

  const template = templates.find((t) => t.id === task.templateId);
  const items = useMemo(() => templateItems.filter((it) => it.templateId === task.templateId), [templateItems, task.templateId]);

  const [mode, setMode] = useState<'fill' | 'off_duty'>('fill');
  const [answers, setAnswers] = useState<Record<string, { answer: boolean | null; note: string }>>({});
  const [sectionPhotos, setSectionPhotos] = useState<Record<string, Shot[]>>({});
  const [offDutyReason, setOffDutyReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audit-only: the branch, subject and shift are chosen fresh each time,
  // right here — never fixed when the audit task itself was created.
  const [auditStep, setAuditStep] = useState<'branch' | 'subject' | 'shift' | 'fill'>('branch');
  const [auditBranchId, setAuditBranchId] = useState<string | null>(null);
  const [auditSubjectId, setAuditSubjectId] = useState<string | null>(null);
  const [auditShift, setAuditShift] = useState<'morning' | 'evening' | null>(null);
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);

  const branchMembers = members.filter(
    (m) => m.id !== profile?.id && m.role !== 'owner' && auditBranchId != null && m.teamIds.includes(auditBranchId)
  );
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
    setSectionPhotos({});
    setOffDutyReason('');
    setError(null);
    setAuditStep('branch');
    setAuditBranchId(null);
    setAuditSubjectId(null);
    setAuditShift(null);
    setSignatureSvg(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const setAnswer = (itemId: string, value: boolean) => {
    setAnswers((prev) => ({ ...prev, [itemId]: { answer: value, note: prev[itemId]?.note ?? '' } }));
  };

  const setNote = (itemId: string, note: string) => {
    setAnswers((prev) => ({ ...prev, [itemId]: { answer: prev[itemId]?.answer ?? null, note } }));
  };

  const takePhoto = async (sectionTitle: string) => {
    setError(null);
    const current = sectionPhotos[sectionTitle] ?? [];
    if (current.length >= MAX_PHOTOS_PER_SECTION) {
      setError(`You can attach up to ${MAX_PHOTOS_PER_SECTION} photos per section.`);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is needed to take photos. Enable it for Rungs in your device settings.');
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, base64: true });
      if (!result.canceled && result.assets[0]?.base64) {
        setSectionPhotos((prev) => ({
          ...prev,
          [sectionTitle]: [...(prev[sectionTitle] ?? []), { uri: result.assets[0].uri, base64: result.assets[0].base64! }],
        }));
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the camera on this device.');
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
  // A preview only — the real total that gets stored is always computed
  // server-side in set_task_completion, from the same answers.
  const totalPoints = items.reduce(
    (sum, it) => (answers[it.id]?.answer === false ? sum - it.pointWeight : sum),
    0
  );
  const totalIqd = Math.abs(totalPoints) * 25000;
  const canSubmit =
    unanswered.length === 0 &&
    missingNotes.length === 0 &&
    !submitting &&
    !!template &&
    (!task.isAudit || !!signatureSvg);

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
      if (task.isAudit && signatureSvg) {
        const path = `${orgId}/signature-${task.id}-${Date.now()}.svg`;
        const { error: sigError } = await supabase.storage
          .from('task-proofs')
          .upload(path, signatureSvg, { contentType: 'image/svg+xml' });
        if (sigError) throw sigError;
        signatureUrl = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      }

      const payload = items.map((it, i) => ({
        sectionTitle: it.sectionTitle,
        question: it.question,
        sortOrder: i,
        answer: answers[it.id]!.answer!,
        note: answers[it.id]!.note.trim() || undefined,
      }));

      await setTaskCompletion(
        task.id,
        true,
        undefined,
        [],
        payload,
        uploadedPhotos,
        task.isAudit && auditSubjectId && auditShift
          ? { subjectProfileId: auditSubjectId, shift: auditShift, signatureUrl }
          : undefined
      );
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not submit this checklist. Please try again.');
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
      setError(e?.message ?? 'Could not send this. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!template) return null;

  return (
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
              paddingBottom: 32,
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
                        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{t.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : auditStep === 'subject' ? (
                  <>
                    <Pressable onPress={() => setAuditStep('branch')} style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, color: c.indigo, fontWeight: '600' }}>{'< Back to branch'}</Text>
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
                      <Text style={{ fontSize: 12, color: c.indigo, fontWeight: '600' }}>{'< Back to who'}</Text>
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
                      {teams.find((t) => t.id === auditBranchId)?.name} • {auditSubject?.name} • {auditShift === 'morning' ? 'AM' : 'PM'}
                    </Text>
                    <Pressable onPress={() => setAuditStep('branch')}>
                      <Text style={{ fontSize: 12, color: c.indigo, fontWeight: '600' }}>Change</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setMode('off_duty')} style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, color: c.indigo, fontWeight: '600' }}>Not on duty today?</Text>
                  </Pressable>
                )}

                {error ? <ErrorBanner message={error} /> : null}

                <ScrollView keyboardShouldPersistTaps="handled" style={{ marginBottom: 14, flexShrink: 1, minHeight: 0 }}>
                  {sections.map(([sectionTitle, sectionItems]) => (
                    <View key={sectionTitle || '_'} style={{ marginBottom: 18 }}>
                      {sectionTitle ? (
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '700',
                            color: c.indigo,
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
                                  Yes
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
                                  No
                                </Text>
                              </Pressable>
                            </View>
                            {state?.answer === false ? (
                              <TextInput
                                value={state.note}
                                onChangeText={(t) => setNote(it.id, t)}
                                placeholder={template.requiresNoteOnNo ? 'Explain why (required)' : 'Note (optional)'}
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
                    </View>
                  ))}
                </ScrollView>

                {task.isAudit && unanswered.length === 0 && missingNotes.length === 0 ? (
                  <View style={{ marginBottom: 14 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        backgroundColor: c.bgSubtle,
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 12,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>Total</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: totalPoints < 0 ? c.rose : c.text }}>
                        {totalPoints} pts · {totalIqd.toLocaleString()} IQD
                      </Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>Sign to confirm</Text>
                    <SignaturePad onChange={setSignatureSvg} />
                  </View>
                ) : null}

                <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>
                  {unanswered.length > 0
                    ? `${unanswered.length} question${unanswered.length === 1 ? '' : 's'} left to answer`
                    : missingNotes.length > 0
                      ? `${missingNotes.length} "No" answer${missingNotes.length === 1 ? '' : 's'} need${missingNotes.length === 1 ? 's' : ''} a note`
                      : task.isAudit && !signatureSvg
                        ? 'Sign above to submit'
                        : 'Ready to submit'}
                </Text>

                {submitting ? (
                  <View style={{ paddingVertical: 14, alignItems: 'center' }}>
                    <ActivityIndicator color={c.indigo} />
                  </View>
                ) : (
                  <>
                    <PrimaryButton title="Submit" onPress={handleSubmit} disabled={!canSubmit} />
                    <View style={{ height: 10 }} />
                    <SecondaryButton title="Cancel" onPress={handleClose} />
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 14 }}>
                  This tells your admin and team leader you're not on duty. They'll check and confirm — it doesn't clear
                  this checklist on its own, and if it's not confirmed you'll still need to do it.
                </Text>

                {error ? <ErrorBanner message={error} /> : null}

                <TextInput
                  value={offDutyReason}
                  onChangeText={setOffDutyReason}
                  placeholder="Why aren't you on duty today?"
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
                    <ActivityIndicator color={c.indigo} />
                  </View>
                ) : (
                  <>
                    <PrimaryButton title="Send" onPress={handleDeclareOffDuty} disabled={!offDutyReason.trim()} />
                    <View style={{ height: 10 }} />
                    <SecondaryButton title="Back to checklist" onPress={() => setMode('fill')} />
                  </>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
