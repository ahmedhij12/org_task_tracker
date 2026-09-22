import { View, Text, TextInput } from 'react-native';
import { useThemeColors } from '@/components/ui';

/**
 * Native time field. The web build uses TimeField.web.tsx (a real time picker);
 * here a plain HH:MM box is fine because the native app is admin-only for now.
 */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = useThemeColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
        placeholder="HH:MM"
        placeholderTextColor={c.textFaint}
        style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 17, fontWeight: '700', color: c.text }}
      />
    </View>
  );
}
