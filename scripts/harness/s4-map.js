// Branches → pin a branch: satellite photos at the opening zoom, then My location.
const { open } = require('./harness');
const OUT = require('path').join(__dirname, '..', '..', '.dev-session', 'harness');
(async () => {
  const s = await open('hijazi12');
  const { page, errors } = s;
  await page.getByText('Branches', { exact: true }).last().click();
  await page.waitForTimeout(2000);
  await page.getByText(/Location set|No location set/).first().click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/s4-a-map.png` });
  const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('img.leaflet-tile')).map((i) => i.src.match(/tile\/(\d+)\//)?.[1] ?? i.src.slice(0, 40)));
  console.log('tile zooms requested:', [...new Set(tiles)].join(','), `(${tiles.length} tiles)`);
  await page.getByTestId('branch-loc-gps').click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/s4-b-mylocation.png` });
  console.log('gps note:', await page.getByText(/Moved to your location|Location is blocked|Could not get your location/).first().innerText().catch(() => 'none'));
  console.log('errors:', errors.filter((e) => !e.includes('user gesture')).slice(0, 4));
  await s.browser.close();
})();
