import { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { useThemeColors } from '@/components/ui';

/**
 * Web time field: a real <input type="time">, so iPhone Safari shows its wheel
 * picker and the value can never be half-typed. (A plain text box let people
 * leave "15:5" behind, which silently blocked saving.)
 */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = useThemeColors();
  const holderRef = useRef<View>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const holder = holderRef.current as unknown as HTMLElement | null;
    if (!holder) return;
    const input = document.createElement('input');
    input.type = 'time';
    input.value = value;
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'border:1px solid ' + c.border, 'border-radius:12px',
      'padding:12px', 'font-size:17px', 'font-weight:700', 'color:' + c.text,
      'background:transparent', 'font-family:inherit', 'outline:none',
    ].join(';');
    input.addEventListener('input', () => onChangeRef.current(input.value));
    inputRef.current = input;
    holder.replaceChildren(input);
    return () => { inputRef.current = null; };
    // Rebuild only on theme change; value syncing is handled below.
  }, [c.border, c.text]);

  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== value) inputRef.current.value = value;
  }, [value]);

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{label}</Text>
      <View ref={holderRef} style={{ width: '100%' }} />
    </View>
  );
}
