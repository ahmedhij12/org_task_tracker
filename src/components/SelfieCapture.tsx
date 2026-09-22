import { useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';

export interface SelfieShot { uri: string; base64: string }

/**
 * Native selfie capture. The OS camera enforces the front camera and a live
 * shot, so this just launches it. The web build uses SelfieCapture.web.tsx,
 * which forces the front camera in the browser (where cameraType is ignored).
 */
export function SelfieCapture({ visible, onCapture, onClose, onError }: {
  visible: boolean;
  onCapture: (shot: SelfieShot) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { onError('camera'); onClose(); return; }
      try {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          cameraType: ImagePicker.CameraType.front,
          quality: 0.5,
          base64: true,
        });
        if (cancelled) return;
        if (!result.canceled && result.assets[0]?.base64) {
          onCapture({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
        }
      } catch {
        if (!cancelled) onError('camera');
      } finally {
        if (!cancelled) onClose();
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  return null;
}
