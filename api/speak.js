const HF_URL = 'https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.KOKOROVOICEAI_API_KEY;

  // Step 1 — check key exists
  if (!apiKey) {
    return res.status(200).json({ step: 'KEY_CHECK', result: 'MISSING — KOKOROVOICEAI_API_KEY not set in Vercel env' });
  }

  const keyPreview = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);

  // Step 2 — ping HF with minimal payload
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const hfRes = await fetch(HF_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/flac, audio/wav, audio/mpeg, */*'
      },
      body: JSON.stringify({
        inputs: 'Hello, this is a test.',
        parameters: { voice: 'am_adam', speed: 1.0 }
      })
    });

    clearTimeout(timeout);

    const status = hfRes.status;
    const contentType = hfRes.headers.get('content-type') || 'none';
    const allHeaders = Object.fromEntries(hfRes.headers.entries());

    // Read body as text regardless of status
    let bodyText = '';
    try {
      const buf = await hfRes.arrayBuffer();
      // If audio came back, just note the size
      if (contentType.includes('audio') || contentType.includes('flac')) {
        bodyText = `[AUDIO BYTES: ${buf.byteLength}]`;
      } else {
        bodyText = new TextDecoder().decode(buf).slice(0, 500);
      }
    } catch (e) {
      bodyText = 'Could not read body: ' + e.message;
    }

    return res.status(200).json({
      step: 'HF_PING',
      key_preview: keyPreview,
      hf_status: status,
      hf_content_type: contentType,
      hf_headers: allHeaders,
      hf_body: bodyText,
      verdict:
        status === 200 ? '✅ KOKORO OK — audio returned'
        : status === 503 ? '⏳ MODEL LOADING — cold start, retry needed'
        : status === 401 ? '❌ AUTH FAILED — bad API key'
        : status === 403 ? '❌ FORBIDDEN — key lacks Inference API access'
        : status === 404 ? '❌ MODEL NOT FOUND — check HF_URL'
        : `⚠ UNEXPECTED STATUS ${status}`
    });

  } catch (e) {
    return res.status(200).json({
      step: 'HF_PING',
      key_preview: keyPreview,
      error: e.message,
      error_name: e.name,
      verdict: e.name === 'AbortError' ? '⏱ TIMEOUT — HF took >15s' : '💥 FETCH FAILED — ' + e.message
    });
  }
}
