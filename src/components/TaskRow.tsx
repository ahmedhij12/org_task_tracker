import { useState } from 'react';
import { View, Text, Pressable, Image, ScrollView } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { OrgTask, Profile } from '@/types';
import { formatDue, isOverdue, initials } from '@/lib/taskUtils';
import { PriorityMeta } from '@/theme';
import { useThemeColors } from '@/components/ui';

interface Props {
  task: OrgTask;
  members: Profile[];
  showAssignee: boolean;
  canComplete?: boolean;
  onPressCheckbox?: () => void;
  /** When set, swiping the row left reveals a Delete button. Owner/team_admin only — matches the existing tasks DELETE RLS policy. */
  onDelete?: () => void;
  /** When set, shows a pencil at the end of the row (e.g. edit an audit type's questions and points). */
  onEdit?: () => void;
}

export function TaskRow({ task, members, showAssignee, canComplete, onPressCheckbox, onDelete, onEdit }: Props) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const overdue = isOverdue(task);
  const meta = PriorityMeta[task.priority];
  const priorityColor = c[meta.colorKey] as string;

  const assignee = task.assigneeId ? members.find((m) => m.id === task.assigneeId) : null;
  const assigneeLabel = task.assigneeId ? assignee?.name ?? t('taskRow.someone') : t('taskRow.everyone');
  const completedByProfile = task.completedBy ? members.find((m) => m.id === task.completedBy) : null;

  const photoCount = task.proofPhotoUrls.length;
  const hasProof = task.completed && (!!task.proofNote || photoCount > 0);

  const row = (
    <View style={{ backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, marginBottom: 8, overflow: 'hidden' }}>
      <Pressable
        onPress={() => (hasProof ? setExpanded((e) => !e) : undefined)}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 }}
      >
        {canComplete ? (
          <Pressable
            onPress={onPressCheckbox}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityLabel={t(task.completed ? 'taskRow.markIncomplete' : 'taskRow.markComplete', { title: task.title })}
            accessibilityState={{ checked: task.completed }}
            style={{
              marginTop: 2,
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: task.completed ? c.brand : c.border,
              backgroundColor: task.completed ? c.brand : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {task.completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
          </Pressable>
        ) : (
          <View
            style={{
              marginTop: 2,
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: task.completed ? c.brand : c.border,
              backgroundColor: task.completed ? c.brand : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {task.completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
          </View>
        )}

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: priorityColor }} />
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: task.completed ? c.textFaint : c.text,
                textDecorationLine: task.completed ? 'line-through' : 'none',
                flexShrink: 1,
              }}
            >
              {task.title}
            </Text>
            {task.templateId ? (
              <View style={{ backgroundColor: c.brandSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.brand }}>{t('taskRow.checklist')}</Text>
              </View>
            ) : task.requiresProof ? (
              <View style={{ backgroundColor: c.brandSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.brand }}>{t('taskRow.proof')}</Text>
              </View>
            ) : null}
            {task.requiresReview ? (
              <View style={{ backgroundColor: c.amberSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.amber }}>{t('taskRow.review')}</Text>
              </View>
            ) : null}
          </View>

          {task.due ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Ionicons name="notifications-outline" size={11} color={overdue ? c.rose : c.textFaint} />
              <Text style={{ fontSize: 12, color: overdue ? c.rose : c.textFaint, fontWeight: overdue ? '700' : '400' }}>
                {formatDue(task.due, i18n.language, {
                  today: (time) => t('taskRow.today', { time }),
                  tomorrow: (time) => t('taskRow.tomorrow', { time }),
                })}
              </Text>
            </View>
          ) : null}

          {showAssignee ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Ionicons name={task.assigneeId ? 'person' : 'people'} size={11} color={c.textMuted} />
              <Text style={{ fontSize: 12, color: c.textMuted }}>{assigneeLabel}</Text>
              {task.completed && completedByProfile ? (
                <Text style={{ fontSize: 12, color: c.emerald }}>{t('taskRow.doneBy', { name: completedByProfile.name })}</Text>
              ) : null}
            </View>
          ) : null}

          {hasProof ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              {photoCount > 0 ? <Ionicons name="image-outline" size={11} color={c.textFaint} /> : null}
              {task.proofNote ? <Ionicons name="document-text-outline" size={11} color={c.textFaint} /> : null}
              <Text style={{ fontSize: 11, color: c.textFaint }}>
                {photoCount > 0 ? t('taskRow.viewPhotos', { count: photoCount }) : t('taskRow.viewProof')}
              </Text>
            </View>
          ) : null}
        </View>

        {onEdit ? (
          <Pressable
            onPress={onEdit}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('taskRow.editQuestions')}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: c.bgSubtle,
              borderWidth: 1,
              borderColor: c.border,
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
            }}
          >
            <Ionicons name="pencil" size={15} color={c.text} />
          </Pressable>
        ) : null}
      </Pressable>

      {expanded && hasProof ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, padding: 12 }}>
          {photoCount > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {task.proofPhotoUrls.map((url) => (
                  <Image
                    key={url}
                    source={{ uri: url }}
                    style={{ width: photoCount === 1 ? 260 : 160, height: 160, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                ))}
              </View>
            </ScrollView>
          ) : null}
          {task.proofNote ? <Text style={{ fontSize: 13, color: c.textMuted }}>"{task.proofNote}"</Text> : null}
          {task.completedAt ? (
            <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 6 }}>
              {t('taskRow.completed', {
                date: new Date(task.completedAt).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (!onDelete) return row;

  return (
    <Swipeable
      renderRightActions={() => (
        <Pressable
          onPress={onDelete}
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            width: 76,
            marginBottom: 8,
            marginLeft: 8,
            borderRadius: 16,
            backgroundColor: c.rose,
          }}
        >
          <Ionicons name="trash" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 }}>{t('taskRow.delete')}</Text>
        </Pressable>
      )}
    >
      {row}
    </Swipeable>
  );
}

export function initialsBadge(name: string) {
  return initials(name);
}
