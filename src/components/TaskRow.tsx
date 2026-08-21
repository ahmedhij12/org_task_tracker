import { useState } from 'react';
import { View, Text, Pressable, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
}

export function TaskRow({ task, members, showAssignee, canComplete, onPressCheckbox }: Props) {
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const overdue = isOverdue(task);
  const meta = PriorityMeta[task.priority];
  const priorityColor = c[meta.colorKey] as string;

  const assignee = task.assigneeId ? members.find((m) => m.id === task.assigneeId) : null;
  const assigneeLabel = task.assigneeId ? assignee?.name ?? 'Someone' : 'Everyone';
  const completedByProfile = task.completedBy ? members.find((m) => m.id === task.completedBy) : null;

  const photoCount = task.proofPhotoUrls.length;
  const hasProof = task.completed && (!!task.proofNote || photoCount > 0);

  return (
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
            accessibilityLabel={`Mark "${task.title}" ${task.completed ? 'incomplete' : 'complete'}`}
            accessibilityState={{ checked: task.completed }}
            style={{
              marginTop: 2,
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: task.completed ? c.indigo : c.border,
              backgroundColor: task.completed ? c.indigo : 'transparent',
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
              borderColor: task.completed ? c.indigo : c.border,
              backgroundColor: task.completed ? c.indigo : 'transparent',
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
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.indigo }}>CHECKLIST</Text>
              </View>
            ) : task.requiresProof ? (
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.indigo }}>PROOF</Text>
              </View>
            ) : null}
            {task.requiresReview ? (
              <View style={{ backgroundColor: c.amberSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.amber }}>REVIEW</Text>
              </View>
            ) : null}
          </View>

          {task.due ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Ionicons name="notifications-outline" size={11} color={overdue ? c.rose : c.textFaint} />
              <Text style={{ fontSize: 12, color: overdue ? c.rose : c.textFaint, fontWeight: overdue ? '700' : '400' }}>
                {formatDue(task.due)}
              </Text>
            </View>
          ) : null}

          {showAssignee ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Ionicons name={task.assigneeId ? 'person' : 'people'} size={11} color={c.textMuted} />
              <Text style={{ fontSize: 12, color: c.textMuted }}>{assigneeLabel}</Text>
              {task.completed && completedByProfile ? (
                <Text style={{ fontSize: 12, color: c.emerald }}> • done by {completedByProfile.name}</Text>
              ) : null}
            </View>
          ) : null}

          {hasProof ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              {photoCount > 0 ? <Ionicons name="image-outline" size={11} color={c.textFaint} /> : null}
              {task.proofNote ? <Ionicons name="document-text-outline" size={11} color={c.textFaint} /> : null}
              <Text style={{ fontSize: 11, color: c.textFaint }}>
                {photoCount > 0 ? `Tap to view ${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'Tap to view proof'}
              </Text>
            </View>
          ) : null}
        </View>
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
              Completed {new Date(task.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function initialsBadge(name: string) {
  return initials(name);
}
