const HF_URL = 'https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.KOKOROVOICEAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'KOKOROVOICEAI_API_KEY not set' });

  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

    const clean = text
      .replace(/\*\*/g, '').replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '').replace(/`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n+/g, ' ').trim().slice(0, 800);

    const hfRes = await fetch(HF_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: clean,
        parameters: {
          voice: 'am_adam',
          speed: 1.0
        }
      }),
    });

    if (!hfRes.ok) {
      const err = await hfRes.text();
      return res.status(hfRes.status).json({ error: 'HuggingFace: ' + err });
    }

    const contentType = hfRes.headers.get('content-type') || 'audio/flac';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

    const reader = hfRes.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    return res.end();

  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ error: e.message });
    res.end();
  }
}
