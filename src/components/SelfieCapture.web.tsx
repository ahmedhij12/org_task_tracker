import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

export interface SelfieShot { uri: string; base64: string }

/**
 * Web selfie capture. Browsers ignore expo-image-picker's cameraType and let a
 * person pick any file or the rear camera, so we open the FRONT camera directly
 * with getUserMedia(facingMode:'user'), show a live preview, and capture a still
 * — no gallery, no rear camera. It can only be a live face shot.
 */
export function SelfieCapture({ visible, onCapture, onClose, onError }: {
  visible: boolean;
  onCapture: (shot: SelfieShot) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const holderRef = useRef<View>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setReady(false);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tk) => tk.stop()); return; }
        streamRef.current = stream;
        const holder = holderRef.current as unknown as HTMLElement | null;
        const video = document.createElement('video');
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        video.autoplay = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
        video.srcObject = stream;
        videoRef.current = video;
        if (holder) { holder.replaceChildren(video); }
        await video.play().catch(() => {});
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) { onError('camera'); onClose(); }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tk) => tk.stop());
      streamRef.current = null;
      videoRef.current = null;
    };
  }, [visible]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const size = Math.min(video.videoWidth, video.videoHeight) || 640;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Centre-crop to a square and mirror to match the preview.
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    const base64 = dataUrl.split(',')[1] ?? '';
    streamRef.current?.getTracks().forEach((tk) => tk.stop());
    onCapture({ uri: dataUrl, base64 });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: 50, right: 20, zIndex: 2 }}>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={30} color="#fff" /></Pressable>
        </View>
        <Text style={{ color: '#fff', textAlign: 'center', fontSize: 15, marginBottom: 16, fontWeight: '600' }}>{t('fill.selfieHint')}</Text>
        <View style={{ alignSelf: 'center', width: 280, height: 280, borderRadius: 140, overflow: 'hidden', backgroundColor: '#111', borderWidth: 3, borderColor: '#fff' }}>
          <View ref={holderRef} style={{ width: '100%', height: '100%' }} />
          {!ready ? <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View> : null}
        </View>
        <View style={{ alignItems: 'center', marginTop: 32 }}>
          <Pressable onPress={capture} disabled={!ready}
            style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', opacity: ready ? 1 : 0.5, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="camera" size={32} color="#111" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
