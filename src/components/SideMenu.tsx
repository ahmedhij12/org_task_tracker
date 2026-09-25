import { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, View, Text, Pressable, I18nManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useUnverifiedChecklistCount } from '@/hooks/useSupervisorChecklists';
import { useThemeColors } from '@/components/ui';

/**
 * The admins' side menu. Seven tabs were too many for the bottom bar, so an
 * admin keeps the screens they open all day there and reaches the rest from
 * here (see _layout.tsx for which is which). Supervisors and branch managers
 * have no menu — their tab bars did not change.
 */
type Item = { route: Href; label: string; icon: keyof typeof Ionicons.glyphMap; badge?: number };

const SideMenuContext = createContext<{ open: () => void }>({ open: () => {} });

export function SideMenuProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <SideMenuContext.Provider value={{ open: () => setVisible(true) }}>
      {children}
      <SideMenuPanel visible={visible} onClose={() => setVisible(false)} />
    </SideMenuContext.Provider>
  );
}

/** The ☰ next to a screen's title. Renders nothing for anyone who is not an admin. */
export function MenuButton() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { open } = useContext(SideMenuContext);
  const unverified = useUnverifiedChecklistCount();
  if (profile?.role !== 'owner') return null;
  return (
    <Pressable onPress={open} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('menu.open')} testID="open-side-menu">
      <Ionicons name="menu" size={26} color={c.text} />
      {/* Checklists moved into the menu, so its waiting count shows here. */}
      {unverified > 0 ? (
        <View style={{ position: 'absolute', top: -2, right: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: c.rose }} />
      ) : null}
    </Pressable>
  );
}

function SideMenuPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const unverified = useUnverifiedChecklistCount();
  const isSuperAdmin = !!profile?.isSuperAdmin;

  // Everything an admin can open that is NOT in their bottom bar.
  const items: Item[] = [
    { route: '/(main)/checklists', label: t('mainTabs.checklists'), icon: 'clipboard', badge: unverified },
    { route: '/(main)/report', label: t('mainTabs.report'), icon: 'bar-chart' },
    ...(isSuperAdmin ? [] : [{ route: '/(main)/people' as Href, label: t('mainTabs.people'), icon: 'person-add' as const }]),
    { route: '/(main)/control-panel', label: t('control.title'), icon: 'options' },
    // The super admin's alone — no admin ever sees this row.
    ...(isSuperAdmin ? [{ route: '/(main)/activity' as Href, label: t('activity.title'), icon: 'footsteps' as const }] : []),
  ];

  const go = (route: Href) => {
    onClose();
    router.push(route);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* The panel sits on the side the layout reads from: left in English, right in Arabic. */}
        <View
          style={{
            width: 280,
            maxWidth: '82%',
            backgroundColor: c.bg,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 16,
            borderRightWidth: I18nManager.isRTL ? 0 : 1,
            borderLeftWidth: I18nManager.isRTL ? 1 : 0,
            borderColor: c.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: c.text }}>{t('menu.title')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('menu.close')}>
              <Ionicons name="close" size={24} color={c.textMuted} />
            </Pressable>
          </View>
          {items.map((item) => (
            <Pressable
              key={String(item.route)}
              onPress={() => go(item.route)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 14,
                paddingHorizontal: 10,
                borderRadius: 12,
                backgroundColor: pressed ? c.bgSubtle : 'transparent',
              })}
            >
              <Ionicons name={item.icon} size={22} color={c.brand} />
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: c.text }}>{item.label}</Text>
              {item.badge ? (
                <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.rose, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{item.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} accessibilityLabel={t('menu.close')} />
      </View>
    </Modal>
  );
}
