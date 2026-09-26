import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/components/ui";
import { LocationMap } from "@/components/LocationMap";
import { resolveAddress } from "@/lib/placeName";

export interface SignedLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  address: string | null;
}

type Status = "locating" | "ready" | "denied" | "failed";

/**
 * Captures the auditor's live position next to the signature, so an audit
 * carries evidence of where it was signed. Starts locating as soon as it
 * mounts (i.e. once the signature step appears); the parent keeps the value.
 */
export function SigningLocation({
  onChange,
}: {
  onChange: (loc: SignedLocation | null) => void;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("locating");
  const [loc, setLoc] = useState<SignedLocation | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setStatus("locating");
    setAddress(null);
    onChange(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setStatus("denied");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const next: SignedLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        address: null,
      };
      setLoc(next);
      setStatus("ready");
      onChange(next);
      // Street name is saved alongside the pin. Browsers have no reverse
      // geocoder, so the web app asks OpenStreetMap's public one instead.
      resolveAddress(next.lat, next.lng)
        .then((label) => {
          if (!label) return;
          setAddress(label);
          onChange({ ...next, address: label });
        })
        .catch(() => {});
    } catch {
      setStatus("failed");
    }
  }, [onChange]);

  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone =
    status === "ready"
      ? { fg: c.emerald, bg: c.emeraldSoft, icon: "location" as const }
      : status === "locating"
        ? { fg: c.textMuted, bg: c.bgSubtle, icon: "locate" as const }
        : { fg: c.rose, bg: c.roseSoft, icon: "location-outline" as const };

  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      {status === "ready" && loc ? (
        <LocationMap lat={loc.lat} lng={loc.lng} height={140} />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: tone.bg,
          borderRadius: 12,
          padding: 12,
        }}
      >
        {status === "locating" ? (
          <ActivityIndicator size="small" color={tone.fg} />
        ) : (
          <Ionicons name={tone.icon} size={18} color={tone.fg} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: tone.fg }}>
            {status === "ready"
              ? t('loc.confirmed')
              : status === "locating"
                ? t('loc.getting')
                : status === "denied"
                  ? t('loc.permission')
                  : t('loc.failed')}
          </Text>
          <Text
            style={{ fontSize: 11, color: c.textMuted, marginTop: 1 }}
            numberOfLines={2}
          >
            {status === "ready" && loc
              ? `${address ? `${address} · ` : ""}±${Math.round(loc.accuracy ?? 0)} m`
              : status === "denied"
                ? t('loc.permissionHint')
                : status === "failed"
                  ? t('loc.failedHint')
                  : t('loc.hint')}
          </Text>
        </View>
        {status === "denied" || status === "failed" || status === "ready" ? (
          <Pressable onPress={locate} hitSlop={8}>
            <Ionicons name="refresh" size={18} color={tone.fg} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
