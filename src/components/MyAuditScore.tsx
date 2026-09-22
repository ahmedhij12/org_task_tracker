import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { Card, useThemeColors } from '@/components/ui';
import { ScoreRing, ScorePill } from '@/components/ScoreRing';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import { formatScore } from '@/lib/score';
import type { ChecklistAnswer, TaskCompletion } from '@/types';

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function summarize(rows: TaskCompletion[]) {
  const scored = rows.filter((r) => r.score != null);
  return {
    count: rows.length,
    avgScore: scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null,
    points: rows.reduce((s, r) => s + (r.pointsAwarded ?? 0), 0),
    iqd: rows.reduce((s, r) => s + Math.abs((r.pointsAwarded ?? 0) * r.iqdPerPoint), 0),
  };
}

/**
 * The supervisor's own view of the audits done on them: this month's score,
 * points and money deducted against last month, what failed last time, and
 * the recent audits. Never shows how much each question weighs — only the
 * totals — so every item gets the same attention.
 */
export function MyAuditScore() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { history, loadCompletionDetail } = useOrgData();
  const [open, setOpen] = useState<TaskCompletion | null>(null);
  const [fixThese, setFixThese] = useState<ChecklistAnswer[] | null>(null);

  const audits = useMemo(
    () =>
      history
        .filter((h) => h.subjectProfileId === profile?.id && h.actorId !== profile?.id && h.pointsAwarded != null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [history, profile?.id]
  );

  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = summarize(audits.filter((a) => monthKey(new Date(a.createdAt)) === monthKey(now)));
  const lastMonth = summarize(audits.filter((a) => monthKey(new Date(a.createdAt)) === monthKey(lastMonthDate)));
  const latest = audits[0];

  useEffect(() => {
    if (!latest) {
      setFixThese([]);
      return;
    }
    let cancelled = false;
    setFixThese(null);
    loadCompletionDetail(latest.id)
      .then(({ answers }) => {
        if (!cancelled) setFixThese(answers.filter((a) => a.answer === false));
      })
      .catch(() => {
        if (!cancelled) setFixThese([]);
      });
    return () => {
      cancelled = true;
    };
  }, [latest?.id, loadCompletionDetail]);

  const delta = thisMonth.avgScore != null && lastMonth.avgScore != null ? thisMonth.avgScore - lastMonth.avgScore : null;
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });

  return (
    <View style={{ marginTop: 20 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('myScore.heading')}
      </Text>

      {audits.length === 0 ? (
        <Card>
          <Text style={{ fontSize: 13, color: c.textMuted }}>{t('myScore.none')}</Text>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {thisMonth.avgScore != null ? (
                <ScoreRing score={thisMonth.avgScore} size={96} />
              ) : (
                <View style={{ width: 96, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: c.textFaint, textAlign: 'center' }}>{t('myScore.noAuditThisMonth')}</Text>
                </View>
              )}
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted }}>{t('myScore.thisMonth')}</Text>
                <View>
                  <Text style={{ fontSize: 11, color: c.textMuted }}>{t('myScore.points')}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: thisMonth.points < 0 ? c.rose : c.text }}>
                    {thisMonth.points}
                  </Text>
                </View>
                <View>
                  <Text style={{ fontSize: 11, color: c.textMuted }}>{t('myScore.deducted')}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: thisMonth.iqd > 0 ? c.rose : c.text }}>
                    {thisMonth.iqd.toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                  </Text>
                </View>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border }}>
              {delta != null ? (
                <>
                  <Ionicons
                    name={delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : 'remove'}
                    size={18}
                    color={delta > 0 ? c.emerald : delta < 0 ? c.rose : c.textMuted}
                  />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: delta > 0 ? c.emerald : delta < 0 ? c.rose : c.textMuted }}>
                    {delta > 0 ? '+' : ''}
                    {formatScore(delta)}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, flex: 1 }}>
                    {t('myScore.vsLastMonth', { score: formatScore(lastMonth.avgScore!) })}
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: 12, color: c.textMuted }}>{t('myScore.noLastMonth')}</Text>
              )}
            </View>
          </Card>

          <Card style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ionicons name="construct" size={16} color={c.amber} />
              <Text style={{ fontSize: 14, fontWeight: '800', color: c.text, flex: 1 }}>{t('myScore.fixThese')}</Text>
              {latest ? <Text style={{ fontSize: 11, color: c.textMuted }}>{t('myScore.fromAudit', { date: dateOf(latest.createdAt) })}</Text> : null}
            </View>
            {fixThese == null ? (
              <ActivityIndicator color={c.indigo} />
            ) : fixThese.length === 0 ? (
              <Text style={{ fontSize: 13, color: c.emerald, fontWeight: '600' }}>{t('myScore.nothingToFix')}</Text>
            ) : (
              fixThese.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                  <Ionicons name="close-circle" size={16} color={c.rose} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, fontSize: 13, color: c.text, textAlign: 'right', writingDirection: 'rtl' }}>{a.question}</Text>
                </View>
              ))
            )}
            {latest ? (
              <Pressable
                onPress={() => setOpen(latest)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  marginTop: 10,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Ionicons name="images-outline" size={16} color={c.indigo} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.indigo }}>{t('myScore.openReport')}</Text>
              </Pressable>
            ) : null}
          </Card>

          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, marginTop: 6, marginBottom: 6 }}>{t('myScore.recent')}</Text>
          {audits.slice(0, 5).map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setOpen(a)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: 12,
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.border,
                marginBottom: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>{dateOf(a.createdAt)}</Text>
                <Text style={{ fontSize: 12, color: (a.pointsAwarded ?? 0) < 0 ? c.rose : c.textMuted, marginTop: 2 }}>
                  {a.pointsAwarded} {t('dashboard.pointsSuffix')} · {Math.abs((a.pointsAwarded ?? 0) * a.iqdPerPoint).toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                </Text>
              </View>
              {a.score != null ? <ScorePill score={a.score} /> : null}
              <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
            </Pressable>
          ))}
        </>
      )}

      {open ? <CompletionDetailSheet completion={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}
