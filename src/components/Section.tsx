import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/components/ui';

export function Section({
  title,
  count,
  iconColor,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  iconColor: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <View style={{ marginBottom: 8 }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: iconColor }} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 12, color: c.textFaint }}>{count}</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textFaint} />
      </Pressable>
      {open ? <View>{children}</View> : null}
    </View>
  );
}
