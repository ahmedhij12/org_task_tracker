import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { Colors, type ThemeColors } from '@/theme';
import { sanitizeUsername } from '@/lib/username';
import { useThemePref } from '@/hooks/useThemePref';

export function useThemeColors(): ThemeColors {
  const { isDark } = useThemePref();
  return isDark ? Colors.dark : Colors.light;
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  const c = useThemeColors();
  return <Text style={{ fontSize: 26, fontWeight: '800', color: c.text }}>{children}</Text>;
}

export function ScreenSubtitle({ children }: { children: ReactNode }) {
  const c = useThemeColors();
  return <Text style={{ fontSize: 14, color: c.textMuted, marginTop: 4, lineHeight: 20 }}>{children}</Text>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  const c = useThemeColors();
  return <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 6 }}>{children}</Text>;
}

export function FieldInput(props: React.ComponentProps<typeof TextInput> & { label?: string }) {
  const c = useThemeColors();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        placeholderTextColor={c.textFaint}
        style={[
          {
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            color: c.text,
            backgroundColor: c.card,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

export function UsernameInput({
  label = 'Username',
  value,
  onChangeText,
  placeholder = 'e.g. ahmed_h',
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const c = useThemeColors();
  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel>{label}</FieldLabel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 14,
          backgroundColor: c.card,
          paddingLeft: 14,
        }}
      >
        <Text style={{ fontSize: 15, color: c.textFaint, fontWeight: '600' }}>@</Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChangeText(sanitizeUsername(t))}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 12, fontSize: 15, color: c.text }}
        />
      </View>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = useThemeColors();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: c.indigo,
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          backgroundColor: pressed ? c.bgSubtle : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  const c = useThemeColors();
  return (
    <View style={{ backgroundColor: c.roseSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: c.rose, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: any }) {
  const c = useThemeColors();
  return (
    <View
      style={[
        { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export const sharedStyles = StyleSheet.create({
  flex1: { flex: 1 },
});
