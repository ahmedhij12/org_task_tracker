import { useEffect, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useThemeColors } from '@/components/ui';

/**
 * One number in a control-panel card: label, current value, unit. The card
 * collects the drafts and saves them together, so this only reports text.
 */
export function SettingRow({
  label,
  hint,
  value,
  unit,
  decimal,
  onChange,
  testID,
}: {
  label: string;
  hint?: string | null;
  value: number;
  unit: string;
  decimal?: boolean;
  onChange: (text: string) => void;
  testID?: string;
}) {
  const c = useThemeColors();
  const [text, setText] = useState(String(value));
  // A save elsewhere (or a refresh) brings a new value in.
  useEffect(() => setText(String(value)), [value]);
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          onChange(v);
        }}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        maxLength={decimal ? 5 : 9}
        style={{ width: 90, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, fontSize: 15, color: c.text, textAlign: 'center' }}
      />
      <Text style={{ width: 36, fontSize: 12, color: c.textMuted }}>{unit}</Text>
    </View>
  );
}

/** A whole number (or one decimal place when allowed) inside [min, max], or null. */
export function parseSetting(text: string, min: number, max: number, decimal = false): number | null {
  const n = Number(text.replace(/,/g, '').trim());
  if (!text.trim() || !Number.isFinite(n) || n < min || n > max) return null;
  if (!decimal && !Number.isInteger(n)) return null;
  return decimal ? Math.round(n * 100) / 100 : n;
}
