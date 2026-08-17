import { createElement, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FieldLabel, useThemeColors } from '@/components/ui';

interface Props {
  value: Date | null;
  onChange: (next: Date | null) => void;
}

/** Formats a Date for an <input type="datetime-local">, which wants local time, not UTC. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Due date entry that works on every platform.
 *
 * @react-native-community/datetimepicker is native-only — on web it renders
 * nothing at all and the field silently does nothing, so web falls back to a
 * real <input type="datetime-local">. react-native-web is React DOM
 * underneath, so createElement with a string tag gives us the browser control.
 */
export function DueDateField({ value, onChange }: Props) {
  const c = useThemeColors();
  const [showPicker, setShowPicker] = useState(false);

  const label = value
    ? value.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No due date';

  if (Platform.OS === 'web') {
    return (
      <View style={{ marginBottom: 14 }}>
        <FieldLabel>Due date &amp; time (optional)</FieldLabel>
        {createElement('input', {
          type: 'datetime-local',
          value: value ? toLocalInputValue(value) : '',
          onChange: (e: any) => {
            const raw = e.target.value;
            onChange(raw ? new Date(raw) : null);
          },
          style: {
            border: `1px solid ${c.border}`,
            borderRadius: 14,
            padding: 12,
            fontSize: 14,
            color: c.text,
            backgroundColor: c.card,
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          },
        })}
        {value ? (
          <Pressable onPress={() => onChange(null)} style={{ marginTop: 6 }}>
            <Text style={{ fontSize: 12, color: c.textMuted }}>Clear due date</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel>Due date &amp; time (optional)</FieldLabel>
      <Pressable
        onPress={() => setShowPicker(true)}
        style={{ borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, backgroundColor: c.card }}
      >
        <Text style={{ fontSize: 14, color: value ? c.text : c.textFaint }}>{label}</Text>
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange(null)} style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 12, color: c.textMuted }}>Clear due date</Text>
        </Pressable>
      ) : null}
      {showPicker ? (
        <DateTimePicker
          value={value ?? new Date()}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, selected) => {
            setShowPicker(Platform.OS === 'ios');
            if (selected) onChange(selected);
          }}
        />
      ) : null}
    </View>
  );
}
