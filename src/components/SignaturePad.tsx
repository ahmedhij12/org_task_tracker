import { useRef, useState } from 'react';
import { View, PanResponder, Text, Pressable, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/components/ui';

interface Props {
  /** Full SVG XML (a white background plus the drawn strokes), or null once cleared/empty. */
  onChange: (svg: string | null) => void;
}

const WIDTH = 320;
const HEIGHT = 160;
const STROKE = '#1f2937';

// Deliberately no signature-pad library: react-native-svg (already a
// dependency) plus core PanResponder draws a path from raw touch points,
// avoiding a new native dependency entirely for something this small. The
// signature is stored as an SVG (not a rasterized PNG) — no view-shot
// capture needed, and it renders identically in-app and in the exported PDF.
export function SignaturePad({ onChange }: Props) {
  const c = useThemeColors();
  const [paths, setPaths] = useState<string[]>([]);
  const [liveDraw, setLiveDraw] = useState('');

  const buildSvg = (allPaths: string[]): string | null => {
    if (allPaths.length === 0) return null;
    const strokes = allPaths
      .map((d) => `<path d="${d}" stroke="${STROKE}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/>${strokes}</svg>`;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        setLiveDraw(`M${locationX.toFixed(1)},${locationY.toFixed(1)}`);
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const { locationX, locationY } = e.nativeEvent;
        setLiveDraw((prev) => `${prev} L${locationX.toFixed(1)},${locationY.toFixed(1)}`);
      },
      onPanResponderRelease: () => {
        setLiveDraw((prev) => {
          if (!prev) return prev;
          setPaths((allPrev) => {
            const next = [...allPrev, prev];
            onChange(buildSvg(next));
            return next;
          });
          return '';
        });
      },
    })
  ).current;

  const clear = () => {
    setPaths([]);
    setLiveDraw('');
    onChange(null);
  };

  return (
    <View>
      <View
        {...panResponder.panHandlers}
        style={{
          width: WIDTH,
          height: HEIGHT,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 12,
          backgroundColor: '#ffffff',
          overflow: 'hidden',
        }}
      >
        <Svg width={WIDTH} height={HEIGHT}>
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke={STROKE} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {liveDraw ? (
            <Path d={liveDraw} stroke={STROKE} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
        </Svg>
      </View>
      {paths.length > 0 ? (
        <Pressable onPress={clear} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' }}>
          <Ionicons name="refresh" size={14} color={c.textMuted} />
          <Text style={{ fontSize: 12, color: c.textMuted }}>Clear signature</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
