import { useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
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

  const hasProof = task.completed && (task.proofNote || task.proofPhotoUrl);

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
            {task.requiresProof ? (
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: c.indigo }}>PROOF</Text>
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
              {task.proofPhotoUrl ? <Ionicons name="image-outline" size={11} color={c.textFaint} /> : null}
              {task.proofNote ? <Ionicons name="document-text-outline" size={11} color={c.textFaint} /> : null}
              <Text style={{ fontSize: 11, color: c.textFaint }}>Tap to view proof</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {expanded && hasProof ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, padding: 12 }}>
          {task.proofPhotoUrl ? (
            <Image source={{ uri: task.proofPhotoUrl }} style={{ width: '100%', height: 160, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />
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
