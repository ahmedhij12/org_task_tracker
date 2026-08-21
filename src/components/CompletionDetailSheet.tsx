import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { SecondaryButton, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
import { needsReview } from '@/types';
import type { ChecklistAnswer, ChecklistSectionPhoto, TaskCompletion } from '@/types';

interface Props {
  completion: TaskCompletion | null;
  onClose: () => void;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function CompletionDetailSheet({ completion, onClose }: Props) {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { members, tasks, loadCompletionDetail, reviewOffDuty, reviewTaskCompletion } = useOrgData();

  const [answers, setAnswers] = useState<ChecklistAnswer[]>([]);
  const [photos, setPhotos] = useState<ChecklistSectionPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChecklistCompletion = completion?.action === 'completed' && completion.yesCount != null;

  useEffect(() => {
    if (!completion || !isChecklistCompletion) {
      setAnswers([]);
      setPhotos([]);
      return;
    }
    setLoading(true);
    loadCompletionDetail(completion.id)
      .then(({ answers, photos }) => {
        setAnswers(answers);
        setPhotos(photos);
      })
      .catch((e) => setError(e?.message ?? 'Could not load this checklist.'))
      .finally(() => setLoading(false));
  }, [completion?.id]);

  if (!completion) return null;

  const task = tasks.find((t) => t.id === completion.taskId);
  const isManager = profile?.role === 'owner' || profile?.role === 'team_admin';
  const canReview = isManager && needsReview(completion, task ?? { requiresReview: false });
  const actorName = members.find((m) => m.id === completion.actorId)?.name ?? 'Someone';

  const photosBySection = new Map<string, ChecklistSectionPhoto[]>();
  for (const p of photos) {
    const list = photosBySection.get(p.sectionTitle) ?? [];
    list.push(p);
    photosBySection.set(p.sectionTitle, list);
  }

  const handleReviewOffDuty = async (approve: boolean) => {
    setReviewing(true);
    setError(null);
    try {
      await reviewOffDuty(completion.id, approve, reviewNote.trim() || undefined);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save this review.');
    } finally {
      setReviewing(false);
    }
  };

  const handleAcknowledge = async () => {
    setReviewing(true);
    setError(null);
    try {
      await reviewTaskCompletion(completion.id, reviewNote.trim() || undefined);
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ maxHeight: '90%', flexShrink: 1 }}
        >
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
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{completion.taskTitle}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
              {actorName} • {when(completion.createdAt)}
              {isChecklistCompletion ? ` • ${completion.yesCount} yes / ${completion.noCount} no` : ''}
              {completion.reviewedBy ? ' • reviewed' : ''}
            </Text>

            {error ? <ErrorBanner message={error} /> : null}

            {completion.action === 'off_duty' ? (
              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 }}>Off-duty claim</Text>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 12 }}>{completion.offDutyReason}</Text>

                {completion.status === 'off_duty_approved' ? (
                  <Text style={{ fontSize: 12, color: c.emerald, fontWeight: '700', marginBottom: 12 }}>
                    ✓ Confirmed{completion.reviewNote ? ` — ${completion.reviewNote}` : ''}
                  </Text>
                ) : completion.status === 'off_duty_rejected' ? (
                  <Text style={{ fontSize: 12, color: c.rose, fontWeight: '700', marginBottom: 12 }}>
                    ✕ Not confirmed{completion.reviewNote ? ` — ${completion.reviewNote}` : ''} — the checklist is due again.
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
                          onPress={() => handleReviewOffDuty(true)}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 12 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Confirm off-duty</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleReviewOffDuty(false)}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: c.rose, borderRadius: 12, paddingVertical: 12 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Not confirmed</Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                ) : null}
              </View>
            ) : (
              <>
                {loading ? (
                  <ActivityIndicator color={c.indigo} style={{ marginVertical: 20 }} />
                ) : isChecklistCompletion ? (
                  <ScrollView style={{ flexShrink: 1, minHeight: 0 }}>
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
                ) : (
                  <ScrollView style={{ flexShrink: 1, minHeight: 0 }}>
                    {completion.action === 'reopened' ? (
                      <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 12 }}>This task was reopened.</Text>
                    ) : (
                      <>
                        {completion.wasLate ? (
                          <Text style={{ fontSize: 12, color: c.rose, fontWeight: '700', marginBottom: 8 }}>
                            Late — deadline was {completion.dueAt ? when(completion.dueAt) : 'earlier'}
                          </Text>
                        ) : null}
                        {completion.photoUrls.length > 0 ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              {completion.photoUrls.map((url) => (
                                <Image key={url} source={{ uri: url }} style={{ width: 140, height: 140, borderRadius: 12 }} resizeMode="cover" />
                              ))}
                            </View>
                          </ScrollView>
                        ) : null}
                        {completion.note ? <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 8 }}>"{completion.note}"</Text> : null}
                        {!completion.note && completion.photoUrls.length === 0 ? (
                          <Text style={{ fontSize: 13, color: c.textFaint, marginBottom: 8 }}>No note or photos were attached.</Text>
                        ) : null}
                      </>
                    )}
                  </ScrollView>
                )}

                {canReview ? (
                  <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, marginTop: 12 }}>
                    <Text style={{ fontSize: 12, color: c.amber, fontWeight: '700', marginBottom: 8 }}>Needs your review</Text>
                    <TextInput
                      value={reviewNote}
                      onChangeText={setReviewNote}
                      placeholder="Note (optional)"
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
                      <PrimaryButton title="Mark reviewed" onPress={handleAcknowledge} />
                    )}
                  </View>
                ) : null}
              </>
            )}

            <View style={{ height: 10 }} />
            <SecondaryButton title="Close" onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
