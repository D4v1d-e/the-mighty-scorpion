const HF_URL = 'https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.KOKOROVOICEAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'KOKOROVOICEAI_API_KEY not set' });

  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  // Clean text — strip markdown, collapse whitespace, hard cap at 800 chars
  const clean = text
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '').replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ')
    .trim().slice(0, 800);

  if (!clean) return res.status(400).json({ error: 'Text was empty after cleaning' });

  const body = JSON.stringify({
    inputs: clean,
    parameters: {
      voice: 'am_adam',
      speed: 1.0
    }
  });

  const headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'Accept': 'audio/flac, audio/wav, audio/mpeg, */*'
  };

  // HuggingFace cold-starts Kokoro-82M — first call may return 503 "loading"
  // Retry up to 3 times with 4-second wait between attempts
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 4000;

  async function callKokoro(attempt) {
    const hfRes = await fetch(HF_URL, { method: 'POST', headers, body });

    // 503 means model is warming up — retry
    if (hfRes.status === 503) {
      const errText = await hfRes.text();
      const isLoading =
        errText.toLowerCase().includes('loading') ||
        errText.toLowerCase().includes('estimated_time');

      if (isLoading && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return callKokoro(attempt + 1);
      }

      // Retries exhausted — hard fail, no browser fallback
      return res.status(503).json({
        error: `Kokoro-82M unavailable after ${attempt} attempt(s). Try again shortly.`,
        kokoro_error: errText.slice(0, 300)
      });
    }

    // Any other non-OK response from HuggingFace
    if (!hfRes.ok) {
      const errText = await hfRes.text();
      return res.status(hfRes.status).json({
        error: `Kokoro-82M error (HTTP ${hfRes.status})`,
        kokoro_error: errText.slice(0, 300)
      });
    }

    // Success — stream audio back to client
    const contentType = hfRes.headers.get('content-type') || 'audio/flac';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Engine', 'Kokoro-82M');
    res.setHeader('X-Voice-Model', 'am_adam');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      const reader = hfRes.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return res.end();
    } catch (streamErr) {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Stream error: ' + streamErr.message });
      }
      return res.end();
    }
  }

  try {
    return await callKokoro(1);
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    return res.end();
  }
}
