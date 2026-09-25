import { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { useThemeColors } from '@/components/ui';

// The app's own type, spelled out: an <input> does not inherit React Native
// Web's font, and iPhone Safari then draws the time in Times New Roman.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// iPhone Safari sizes a time input by its own rules (a minimum width, its own
// inner box), so width:100% alone overflowed the card and cut the right border
// off (his screenshot, 2026-09-25). These rules make it an ordinary box.
function ensureTimeInputCss() {
  if (document.getElementById('bd-time-input-css')) return;
  const style = document.createElement('style');
  style.id = 'bd-time-input-css';
  style.textContent = `
    input.bd-time { -webkit-appearance: none; appearance: none; display: block; min-width: 0; }
    input.bd-time::-webkit-date-and-time-value { text-align: left; margin: 0; }
    input.bd-time::-webkit-datetime-edit { padding: 0; }
  `;
  document.head.appendChild(style);
}

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
    ensureTimeInputCss();
    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'bd-time';
    input.value = value;
    input.style.cssText = [
      'width:100%', 'max-width:100%', 'box-sizing:border-box', 'border:1px solid ' + c.border, 'border-radius:12px',
      'height:50px', 'padding:0 12px', 'font-size:17px', 'font-weight:700', 'line-height:48px', 'color:' + c.text,
      'background:transparent', 'font-family:' + FONT, 'outline:none', 'margin:0',
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
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{label}</Text>
      <View ref={holderRef} style={{ width: '100%', overflow: 'hidden' }} />
    </View>
  );
}
