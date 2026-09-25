import { useMemo, useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { Card, useThemeColors } from '@/components/ui';
import { ScorePill } from '@/components/ScoreRing';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import type { TaskCompletion } from '@/types';

/**
 * A branch manager's view of the admin's audits on their own staff: this
 * month per supervisor (score, points, IQD) and the recent audit reports to
 * open. Read-only — only the admin changes points.
 */
export function BranchAudits() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { history, allMembers } = useOrgData();
  const [open, setOpen] = useState<TaskCompletion | null>(null);

  const staff = useMemo(
    () =>
      allMembers.filter(
        (m) => m.id !== profile?.id && m.role === 'employee' && m.teamIds.some((id) => profile?.teamIds.includes(id))
      ),
    [allMembers, profile?.id, profile?.teamIds]
  );
  const staffIds = useMemo(() => new Set(staff.map((m) => m.id)), [staff]);

  const audits = useMemo(
    () =>
      history
        .filter((h) => h.pointsAwarded != null && h.subjectProfileId !== h.actorId && staffIds.has(h.subjectProfileId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [history, staffIds]
  );

  const now = new Date();
  const thisMonth = audits.filter((a) => {
    const d = new Date(a.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const perSupervisor = staff
    .map((m) => {
      const rows = thisMonth.filter((a) => a.subjectProfileId === m.id);
      const scored = rows.filter((r) => r.score != null);
      return {
        member: m,
        count: rows.length,
        avg: scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null,
        points: rows.reduce((s, r) => s + (r.pointsAwarded ?? 0), 0),
        iqd: rows.reduce((s, r) => s + Math.abs((r.pointsAwarded ?? 0) * r.iqdPerPoint), 0),
      };
    })
    .sort((a, b) => (a.avg ?? 101) - (b.avg ?? 101));

  // The branch's own number this month: every scored audit of its staff, averaged.
  const scoredThisMonth = thisMonth.filter((a) => a.score != null);
  const branchScore = scoredThisMonth.length ? scoredThisMonth.reduce((s, a) => s + (a.score ?? 0), 0) / scoredThisMonth.length : null;

  const nameOf = (id: string) => allMembers.find((m) => m.id === id)?.name ?? '—';
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });

  return (
    <View style={{ marginTop: 22 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('branchAudits.heading')}
      </Text>

      <Card style={{ marginBottom: 10 }}>
        {branchScore != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{t('branchAudits.branchScore')}</Text>
            <ScorePill score={branchScore} />
          </View>
        ) : null}
        {perSupervisor.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textMuted }}>{t('branchAudits.noStaff')}</Text>
        ) : (
          perSupervisor.map((s, i) => (
            <View
              key={s.member.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.border,
              }}
            >
              {s.member.avatarUrl ? (
                <Image source={{ uri: s.member.avatarUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} />
              ) : (
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: c.brand }}>{s.member.name[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{s.member.name}</Text>
                <Text style={{ fontSize: 12, color: s.points < 0 ? c.rose : c.textMuted }}>
                  {s.count === 0
                    ? t('branchAudits.noAuditThisMonth')
                    : `${t('branchAudits.audits', { count: s.count })} · ${s.points} ${t('dashboard.pointsSuffix')} · ${s.iqd.toLocaleString(i18n.language)} ${t('dashboard.iqdSuffix')}`}
                </Text>
              </View>
              {s.avg != null ? <ScorePill score={s.avg} showGrade={false} /> : null}
            </View>
          ))
        )}
      </Card>

      {audits.length > 0 ? (
        <>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, marginTop: 6, marginBottom: 6 }}>
            {t('branchAudits.recent')}
          </Text>
          {audits.slice(0, 10).map((a) => (
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
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>
                  {nameOf(a.subjectProfileId)} · {dateOf(a.createdAt)}
                </Text>
                <Text style={{ fontSize: 12, color: (a.pointsAwarded ?? 0) < 0 ? c.rose : c.textMuted, marginTop: 2 }}>
                  {a.pointsAwarded} {t('dashboard.pointsSuffix')} · {Math.abs((a.pointsAwarded ?? 0) * a.iqdPerPoint).toLocaleString(i18n.language)} {t('dashboard.iqdSuffix')}
                </Text>
              </View>
              {a.score != null ? <ScorePill score={a.score} /> : null}
              <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
            </Pressable>
          ))}
        </>
      ) : null}

      {open ? <CompletionDetailSheet completion={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}
