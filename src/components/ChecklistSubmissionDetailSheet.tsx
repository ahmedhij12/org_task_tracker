import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { SecondaryButton, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
import type { ChecklistAnswer, ChecklistSectionPhoto, ChecklistSubmission } from '@/types';

interface Props {
  submission: ChecklistSubmission | null;
  onClose: () => void;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ChecklistSubmissionDetailSheet({ submission, onClose }: Props) {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { members } = useOrgData();
  const { loadSubmissionDetail, reviewOffDuty } = useChecklists();

  const [answers, setAnswers] = useState<ChecklistAnswer[]>([]);
  const [photos, setPhotos] = useState<ChecklistSectionPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submission || submission.status !== 'completed') {
      setAnswers([]);
      setPhotos([]);
      return;
    }
    setLoading(true);
    loadSubmissionDetail(submission.id)
      .then(({ answers, photos }) => {
        setAnswers(answers);
        setPhotos(photos);
      })
      .catch((e) => setError(e?.message ?? 'Could not load this checklist.'))
      .finally(() => setLoading(false));
  }, [submission?.id]);

  if (!submission) return null;

  const canReview = submission.status === 'off_duty_pending' && profile?.role !== 'employee';
  const actorName = members.find((m) => m.id === submission.actorId)?.name ?? 'Someone';

  const photosBySection = new Map<string, ChecklistSectionPhoto[]>();
  for (const p of photos) {
    const list = photosBySection.get(p.sectionTitle) ?? [];
    list.push(p);
    photosBySection.set(p.sectionTitle, list);
  }

  const handleReview = async (approve: boolean) => {
    setReviewing(true);
    setError(null);
    try {
      await reviewOffDuty(submission.id, approve, reviewNote.trim() || undefined);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save this review.');
    } finally {
      setReviewing(false);
    }
  };

  let lastSection = '';

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '90%' }}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 32,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{submission.templateName}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
              {actorName} • {when(submission.createdAt)}
              {submission.status === 'completed' ? ` • ${submission.yesCount} yes / ${submission.noCount} no` : ''}
            </Text>

            {error ? <ErrorBanner message={error} /> : null}

            {submission.status.startsWith('off_duty') ? (
              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 }}>Off-duty claim</Text>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 12 }}>{submission.offDutyReason}</Text>

                {submission.status === 'off_duty_approved' ? (
                  <Text style={{ fontSize: 12, color: c.emerald, fontWeight: '700', marginBottom: 12 }}>
                    ✓ Confirmed{submission.reviewNote ? ` — ${submission.reviewNote}` : ''}
                  </Text>
                ) : submission.status === 'off_duty_rejected' ? (
                  <Text style={{ fontSize: 12, color: c.rose, fontWeight: '700', marginBottom: 12 }}>
                    ✕ Not confirmed{submission.reviewNote ? ` — ${submission.reviewNote}` : ''} — the checklist is due again.
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: c.amber, fontWeight: '700', marginBottom: 12 }}>Waiting for review</Text>
                )}

                {canReview ? (
                  <>
                    <TextInput
                      value={reviewNote}
                      onChangeText={setReviewNote}
                      placeholder="Note (optional) — e.g. what HR confirmed"
                      placeholderTextColor={c.textFaint}
                      style={{
                        borderWidth: 1,
                        borderColor: c.border,
                        borderRadius: 12,
                        padding: 10,
                        fontSize: 13,
                        color: c.text,
                        marginBottom: 12,
                      }}
                    />
                    {reviewing ? (
                      <ActivityIndicator color={c.indigo} />
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          onPress={() => handleReview(true)}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 12 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Confirm off-duty</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleReview(false)}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: c.rose, borderRadius: 12, paddingVertical: 12 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Not confirmed</Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                ) : null}
              </View>
            ) : loading ? (
              <ActivityIndicator color={c.indigo} style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView>
                {answers.map((a) => {
                  const showHeader = a.sectionTitle && a.sectionTitle !== lastSection;
                  if (showHeader) lastSection = a.sectionTitle;
                  const sectionPhotosForThis = showHeader ? photosBySection.get(a.sectionTitle) : null;
                  return (
                    <View key={a.id}>
                      {showHeader ? (
                        <Text style={{ fontSize: 13, fontWeight: '700', color: c.indigo, marginTop: 10, marginBottom: 6, textAlign: textAlignFor(a.sectionTitle) }}>
                          {a.sectionTitle}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                        <Ionicons
                          name={a.answer ? 'checkmark-circle' : 'close-circle'}
                          size={16}
                          color={a.answer ? c.emerald : c.rose}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, color: c.text, textAlign: textAlignFor(a.question) }}>{a.question}</Text>
                          {a.note ? (
                            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2, textAlign: textAlignFor(a.note) }}>
                              "{a.note}"
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {sectionPhotosForThis && sectionPhotosForThis.length > 0 ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {sectionPhotosForThis.map((p) => (
                              <Image key={p.id} source={{ uri: p.photoUrl }} style={{ width: 100, height: 100, borderRadius: 10 }} resizeMode="cover" />
                            ))}
                          </View>
                        </ScrollView>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <View style={{ height: 10 }} />
            <SecondaryButton title="Close" onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
