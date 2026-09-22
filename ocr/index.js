// BD Audit — oil-tester OCR. Takes a photo of a VITO oil tester's LCD and
// returns the TPM % and temperature so the app can pre-fill them. The
// Anthropic key lives only as a Worker secret (ANTHROPIC_API_KEY), never in
// the app. CORS is limited to the app's own origin.
const ALLOWED_ORIGIN = 'https://bdaudit.hijazionline.com';

function cors(origin) {
  const ok = origin === ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return new Response('Not found', { status: 404, headers: cors(origin) });

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, origin); }
    const { image, media_type } = body || {};
    if (!image || typeof image !== 'string') return json({ error: 'no_image' }, 400, origin);
    if (image.length > 8_000_000) return json({ error: 'image_too_large' }, 413, origin);

    const prompt = 'This photo shows a VITO handheld deep-fryer oil tester with an LCD screen. '
      + 'Read the large TPM percentage number and the smaller temperature number (°C) shown on the LCD. '
      + 'Reply with ONLY a JSON object, no prose: {"tpm": <number or null>, "temp_c": <number or null>}. '
      + 'TPM is roughly 0-40. Temperature is roughly 100-200. If a value is not clearly readable, use null.';

    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });
    } catch { return json({ error: 'upstream_unreachable' }, 502, origin); }

    if (!resp.ok) return json({ error: 'ocr_failed', status: resp.status }, 502, origin);
    const data = await resp.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ tpm: null, temp_c: null }, 200, origin);
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch { return json({ tpm: null, temp_c: null }, 200, origin); }
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    return json({ tpm: num(parsed.tpm), temp_c: num(parsed.temp_c) }, 200, origin);
  },
};

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });
}
