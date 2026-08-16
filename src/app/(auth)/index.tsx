import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/components/ui';

export default function LandingScreen() {
  const c = useThemeColors();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 48 }}>
        <View style={{ alignItems: 'center', marginBottom: 40 }}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 22,
              backgroundColor: c.indigo,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <Ionicons name="checkbox" size={36} color="#fff" />
          </View>
          <Text style={{ fontSize: 26, fontWeight: '800', color: c.text }}>OrgTasks</Text>
          <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', marginTop: 8, maxWidth: 260, lineHeight: 20 }}>
            Assign and track tasks across your team, split into groups with their own admin.
          </Text>
        </View>

        <ChoiceRow
          icon="business"
          title="Create an organization"
          subtitle="You'll be the owner, create teams, and invite people."
          onPress={() => router.push('/(auth)/create')}
        />
        <View style={{ height: 12 }} />
        <ChoiceRow
          icon="person-add"
          title="Join an organization"
          subtitle="Enter an Organization ID shared with you."
          onPress={() => router.push('/(auth)/join')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ChoiceRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 18,
        padding: 16,
        backgroundColor: pressed ? c.bgSubtle : c.card,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          backgroundColor: c.indigoSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={22} color={c.indigo} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{title}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
    </Pressable>
  );
}
