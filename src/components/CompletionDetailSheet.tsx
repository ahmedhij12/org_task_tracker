import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { SecondaryButton, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
import { buildWebReportFile, exportAuditReport } from '@/lib/exportAuditReport';
import { shareOrDownloadFile } from '@/lib/webPdf';
import { checkInFor } from '@/lib/checkIn';
import { logActivity } from '@/lib/activityLog';
import { needsReview } from '@/types';
import { ScoreRing } from '@/components/ScoreRing';
import { LocationMap } from '@/components/LocationMap';
import { PhotoViewer } from '@/components/PhotoViewer';
import { SvgUri } from 'react-native-svg';
import type { ChecklistAnswer, ChecklistSectionPhoto, TaskCompletion } from '@/types';

interface Props {
  completion: TaskCompletion | null;
  onClose: () => void;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export function CompletionDetailSheet({ completion, onClose }: Props) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { allMembers: members, teams, tasks, loadCompletionDetail, reviewOffDuty, reviewTaskCompletion } = useOrgData();

  const [answers, setAnswers] = useState<ChecklistAnswer[]>([]);
  const [photos, setPhotos] = useState<ChecklistSectionPhoto[]>([]);
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Web: the finished PDF, waiting for a second tap to open the share sheet.
  const [webPdf, setWebPdf] = useState<globalThis.File | null>(null);

  const isChecklistCompletion = completion?.action === 'completed' && completion.yesCount != null;

  useEffect(() => {
    setWebPdf(null);
    if (completion) logActivity(profile, 'view', 'record', { completion_id: completion.id, title: completion.taskTitle });
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
      .catch((e) => setError(e?.message ?? t('detail.loadFailed')))
      .finally(() => setLoading(false));
  }, [completion?.id]);

  if (!completion) return null;

  const task = tasks.find((t) => t.id === completion.taskId);
  const openViewer = (urls: string[], index: number) => setViewer({ urls, index });
  // Verifying is the admin's job (and the hygiene auditor's, once that role
  // exists) — no longer the branch manager's (spec 2026-09-24, section 1).
  // He still sees and exports his branch's checklists.
  const canReview =
    (profile?.role === 'owner' || (profile?.role as string) === 'hygiene_auditor') &&
    (needsReview(completion, task ?? { requiresReview: false }) ||
      (completion.action === 'completed' && !!completion.selfieUrl && !completion.reviewedBy));
  const reviewerName = members.find((m) => m.id === completion.reviewedBy)?.name ?? t('detail.admin');
  const isSupervisorProof = !!completion.selfieUrl;
  const actorName = members.find((m) => m.id === completion.actorId)?.name ?? 'Someone';

  const photosBySection = new Map<string, ChecklistSectionPhoto[]>();
  for (const p of photos) {
    const list = photosBySection.get(p.sectionTitle) ?? [];
    list.push(p);
    photosBySection.set(p.sectionTitle, list);
  }

  // Any completion with points_awarded set is an audit — see set_task_completion.
  const isAudit = completion.pointsAwarded != null;
  const subjectProfile = members.find((m) => m.id === completion.subjectProfileId);
  // The subject's own branch (via profile_teams), not the completion's own
  // team_id (the audit task's team, which can differ) — same attribution
  // gotcha already documented on task_completions and handled in the
  // reporting RPCs.
  const subjectBranch = teams.find((t) => t.id === subjectProfile?.teamIds[0]);
  const actorBranch =
    teams.find((t) => t.id === completion.teamId) ??
    teams.find((t) => t.id === members.find((m) => m.id === completion.actorId)?.teamIds[0]);
  const subjectBranchName = subjectBranch?.name ?? '—';
  const actorBranchName = actorBranch?.name ?? '—';
  // Measured against the branch the record is ABOUT — the same choice the
  // export makes for branchName below.
  const checkIn = checkInFor(
    { lat: completion.signedLat, lng: completion.signedLng, accuracyM: completion.signedAccuracyM },
    isAudit ? subjectBranch : actorBranch,
  );
  const checkInColor = checkIn?.status === 'out' ? c.rose : checkIn?.status === 'unclear' ? c.amber : c.emerald;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    logActivity(profile, 'export', 'record_pdf', { completion_id: completion.id, title: completion.taskTitle });
    try {
      const report = {
        kind: isAudit ? 'audit' : 'checklist',
        completion,
        // A checklist is about the person who filled it, at their own branch.
        branchName: isAudit ? subjectBranchName : actorBranchName,
        checkIn,
        subjectName: isAudit ? subjectProfile?.name ?? 'Someone' : actorName,
        auditorName: actorName,
        verifiedByName: completion.reviewedBy ? reviewerName : null,
        answers,
        photos,
        locale: i18n.language,
      } as const;
      if (Platform.OS === 'web') setWebPdf(await buildWebReportFile(report));
      else await exportAuditReport(report);
    } catch (e: any) {
      setError(e?.message ?? t('detail.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleSendWebPdf = async () => {
    if (!webPdf) return;
    setError(null);
    try {
      await shareOrDownloadFile(webPdf);
    } catch (e: any) {
      setError(e?.message ?? t('detail.exportFailed'));
    }
  };

  const handleReviewOffDuty = async (approve: boolean) => {
    setReviewing(true);
    setError(null);
    try {
      await reviewOffDuty(completion.id, approve, reviewNote.trim() || undefined);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t('detail.reviewFailed'));
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
      setError(e?.message ?? t('detail.reviewFailed'));
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
              {isChecklistCompletion ? ` • ${t('detail.yesNo', { yes: completion.yesCount, no: completion.noCount })}` : ''}
            </Text>

            {completion.reviewedBy && completion.action === 'completed' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.emeraldSoft, borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <Ionicons name="checkmark-circle" size={18} color={c.emerald} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: c.emerald }}>
                    {t('detail.verifiedBy', { name: reviewerName, time: completion.reviewedAt ? when(completion.reviewedAt) : '' })}
                  </Text>
                  {completion.reviewNote ? (
                    <Text style={{ fontSize: 12, color: c.text, marginTop: 2 }}>"{completion.reviewNote}"</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {error ? <ErrorBanner message={error} /> : null}

            {completion.action === 'off_duty' ? (
              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 }}>{t('detail.offDutyClaim')}</Text>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 12 }}>{completion.offDutyReason}</Text>

                {completion.status === 'off_duty_approved' ? (
                  <Text style={{ fontSize: 12, color: c.emerald, fontWeight: '700', marginBottom: 12 }}>
                    ✓ {t('detail.confirmed')}{completion.reviewNote ? ` — ${completion.reviewNote}` : ''}
                  </Text>
                ) : completion.status === 'off_duty_rejected' ? (
                  <Text style={{ fontSize: 12, color: c.rose, fontWeight: '700', marginBottom: 12 }}>
                    ✕ {t('detail.notConfirmed')}{completion.reviewNote ? ` — ${completion.reviewNote}` : ''} — {t('detail.dueAgain')}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: c.amber, fontWeight: '700', marginBottom: 12 }}>{t('detail.waitingReview')}</Text>
                )}

                {canReview ? (
                  <>
                    <TextInput
                      value={reviewNote}
                      onChangeText={setReviewNote}
                      placeholder={t('detail.hrNote')}
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
                      <ActivityIndicator color={c.brand} />
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          onPress={() => handleReviewOffDuty(true)}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 12 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('detail.confirmOffDuty')}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleReviewOffDuty(false)}
                          style={{ flex: 1, alignItems: 'center', backgroundColor: c.rose, borderRadius: 12, paddingVertical: 12 }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('detail.notConfirmed')}</Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                ) : null}
              </View>
            ) : (
              <>
                {loading ? (
                  <ActivityIndicator color={c.brand} style={{ marginVertical: 20 }} />
                ) : isChecklistCompletion ? (
                  <ScrollView style={{ flexShrink: 1, minHeight: 0 }}>
                    {completion.score != null ? (
                      <View style={{ alignItems: 'center', marginBottom: 16 }}>
                        <ScoreRing score={completion.score} size={104} />
                      </View>
                    ) : null}

                    {completion.selfieUrl || (completion.signedLat != null && completion.signedLng != null) ? (
                      <View style={{ backgroundColor: c.bgSubtle, borderRadius: 14, padding: 10, marginBottom: 14, gap: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          {completion.selfieUrl ? (
                            <Pressable onPress={() => openViewer([completion.selfieUrl!], 0)}>
                              <Image source={{ uri: completion.selfieUrl }} style={{ width: 120, height: 150, borderRadius: 12 }} resizeMode="cover" />
                            </Pressable>
                          ) : null}
                          {completion.signedLat != null && completion.signedLng != null ? (
                            <View style={{ flex: 1 }}>
                              <LocationMap lat={completion.signedLat} lng={completion.signedLng} height={150} />
                            </View>
                          ) : null}
                        </View>
                        {completion.signedLat != null ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
                            <Ionicons name="location" size={16} color={checkIn ? checkInColor : c.emerald} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>
                                {isSupervisorProof ? t('detail.submittedHere') : t('detail.signedHere')} · {when(completion.createdAt)}
                              </Text>
                              <Text style={{ fontSize: 11, color: c.textMuted }} numberOfLines={2}>
                                {completion.signedAddress ?? t('detail.tapMap')}
                                {completion.signedAccuracyM != null ? ` · ±${Math.round(completion.signedAccuracyM)} m` : ''}
                              </Text>
                              {checkIn ? (
                                <Text style={{ fontSize: 12, fontWeight: '700', color: checkInColor, marginTop: 2 }} testID="check-in-line">
                                  {checkIn.status === 'out'
                                    ? t('detail.notInKitchen', { m: checkIn.meters, r: checkIn.radiusM })
                                    : checkIn.status === 'unclear'
                                      ? t('detail.locationUnclear', { m: checkIn.meters, acc: checkIn.accuracyM ?? '?' })
                                      : t('detail.inKitchen', { m: checkIn.meters })}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {completion.signatureUrl ? (
                      <View style={{ marginBottom: 14 }}>
                        <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('detail.signature')}</Text>
                        <View style={{ backgroundColor: '#fff', borderRadius: 12, height: 120, overflow: 'hidden' }}>
                          <SvgUri uri={completion.signatureUrl} width="100%" height="100%" />
                        </View>
                      </View>
                    ) : null}

                    {answers.map((a) => {
                      const showHeader = a.sectionTitle && a.sectionTitle !== lastSection;
                      if (showHeader) lastSection = a.sectionTitle;
                      const sectionPhotosForThis = showHeader ? photosBySection.get(a.sectionTitle) : null;
                      return (
                        <View key={a.id}>
                          {showHeader ? (
                            <Text style={{ fontSize: 13, fontWeight: '700', color: c.brand, marginTop: 10, marginBottom: 6, textAlign: textAlignFor(a.sectionTitle) }}>
                              {a.sectionTitle}
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                            <Ionicons
                              name={a.answer == null ? 'remove-circle' : a.answer ? 'checkmark-circle' : 'close-circle'}
                              size={16}
                              color={a.answer == null ? c.textFaint : a.answer ? c.emerald : c.rose}
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
                                {sectionPhotosForThis.map((p, i) => (
                                  <Pressable key={p.id} onPress={() => openViewer(sectionPhotosForThis.map((x) => x.photoUrl), i)}>
                                    <Image source={{ uri: p.photoUrl }} style={{ width: 100, height: 100, borderRadius: 10 }} resizeMode="cover" />
                                  </Pressable>
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
                      <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 12 }}>{t('detail.reopened')}</Text>
                    ) : (
                      <>
                        {completion.wasLate ? (
                          <Text style={{ fontSize: 12, color: c.rose, fontWeight: '700', marginBottom: 8 }}>
                            {t('detail.late', { time: completion.dueAt ? when(completion.dueAt) : '' })}
                          </Text>
                        ) : null}
                        {completion.photoUrls.length > 0 ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              {completion.photoUrls.map((url, i) => (
                                <Pressable key={url} onPress={() => openViewer(completion.photoUrls, i)}>
                                  <Image source={{ uri: url }} style={{ width: 140, height: 140, borderRadius: 12 }} resizeMode="cover" />
                                </Pressable>
                              ))}
                            </View>
                          </ScrollView>
                        ) : null}
                        {completion.note ? <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 8 }}>"{completion.note}"</Text> : null}
                        {!completion.note && completion.photoUrls.length === 0 ? (
                          <Text style={{ fontSize: 13, color: c.textFaint, marginBottom: 8 }}>{t('detail.noProof')}</Text>
                        ) : null}
                      </>
                    )}
                  </ScrollView>
                )}

                {canReview ? (
                  <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, marginTop: 12 }}>
                    <Text style={{ fontSize: 12, color: c.amber, fontWeight: '700', marginBottom: 8 }}>
                      {isSupervisorProof ? t('detail.checkThenVerify') : t('detail.needsReview')}
                    </Text>
                    <TextInput
                      value={reviewNote}
                      onChangeText={setReviewNote}
                      placeholder={t('detail.noteOptional')}
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
                      <ActivityIndicator color={c.brand} />
                    ) : (
                      <PrimaryButton title={isSupervisorProof ? t('detail.verify') : t('detail.markReviewed')} onPress={handleAcknowledge} />
                    )}
                  </View>
                ) : null}
              </>
            )}

            {(isAudit || isChecklistCompletion) && !loading ? (
              <>
                <View style={{ height: 10 }} />
                {exporting ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
                    <ActivityIndicator color={c.brand} />
                    <Text style={{ color: c.textMuted, fontSize: 13 }}>{t('detail.preparingPdf')}</Text>
                  </View>
                ) : webPdf ? (
                  <Pressable
                    onPress={handleSendWebPdf}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      backgroundColor: c.emerald,
                      borderRadius: 14,
                      paddingVertical: 14,
                    }}
                  >
                    <Ionicons name="share-outline" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{t('detail.sendPdf')}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={handleExport}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 14,
                      paddingVertical: 14,
                    }}
                  >
                    <Ionicons name="document-text-outline" size={18} color={c.text} />
                    <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{t('detail.export')}</Text>
                  </Pressable>
                )}
              </>
            ) : null}

            <View style={{ height: 10 }} />
            <SecondaryButton title={t('detail.close')} onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </View>
      <PhotoViewer urls={viewer?.urls ?? []} index={viewer ? viewer.index : null} onClose={() => setViewer(null)} />
    </Modal>
  );
}
