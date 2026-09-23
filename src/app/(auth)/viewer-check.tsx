// Dev harness for scripts/dev/verify-viewer.js: the photo viewer on two flat
// images, with no login and no data, so its gestures can be measured in a
// headless browser. Signed-out route; it shows nothing real.
import { useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { PhotoViewer } from '@/components/PhotoViewer';

const img = (bg: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${bg}"/><text x="300" y="470" font-size="240" fill="#fff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`
  )}`;

export default function ViewerCheck() {
  const [index, setIndex] = useState<number | null>(0);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable onPress={() => setIndex(0)}><Text>open</Text></Pressable>
      <PhotoViewer urls={[img('#B3261E', 'A'), img('#1E4FB3', 'B')]} index={index} onClose={() => setIndex(null)} />
    </View>
  );
}
