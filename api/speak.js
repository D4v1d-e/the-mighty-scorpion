const HF_URL = 'https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M';

// CRITICAL — tells Vercel to allow up to 60s instead of default 10s
export const config = {
  maxDuration: 60,
};

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
    parameters: { voice: 'am_adam', speed: 1.0 }
  });

  const headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'Accept': 'audio/flac, audio/wav, audio/mpeg, */*'
  };

  const MAX_ATTEMPTS = 3;
  const DEFAULT_RETRY_MS = 4000;
  const PER_ATTEMPT_TIMEOUT_MS = 12000; // 12s per attempt — safe within 60s budget

  async function callKokoro(attempt) {
    // AbortController kills hung HF requests instead of waiting forever
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);

    let hfRes;
    try {
      hfRes = await fetch(HF_URL, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timeout);
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        // HF hung — retry if attempts remain
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 1000));
          return callKokoro(attempt + 1);
        }
        return res.status(503).json({ error: `Kokoro-82M timed out after ${attempt} attempt(s). Model may be cold — try again shortly.` });
      }
      throw e;
    }

    // 503 = model still warming up — use estimated_time from HF response if available
    if (hfRes.status === 503) {
      const errText = await hfRes.text();
      const isLoading =
        errText.toLowerCase().includes('loading') ||
        errText.toLowerCase().includes('estimated_time');

      if (isLoading && attempt < MAX_ATTEMPTS) {
        // Use HF's own estimated_time if present, capped at 8s
        let waitMs = DEFAULT_RETRY_MS;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.estimated_time) waitMs = Math.min(parsed.estimated_time * 1000 + 500, 8000);
        } catch (_) {}

        await new Promise(r => setTimeout(r, waitMs));
        return callKokoro(attempt + 1);
      }

      return res.status(503).json({
        error: `Kokoro-82M unavailable after ${attempt} attempt(s). Try again shortly.`,
        kokoro_error: errText.slice(0, 300)
      });
    }

    // Any other non-OK from HuggingFace
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
      if (!res.headersSent) return res.status(500).json({ error: 'Stream error: ' + streamErr.message });
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
