import { EdgeTTS } from 'edge-tts-universal';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, voice } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

    // Clean text: strip markdown, symbols, excess whitespace
    const clean = text
      .replace(/\*\*/g, '').replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '').replace(/`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n+/g, ' ').trim()
      .slice(0, 1000);

    const selectedVoice = voice || 'en-US-GuyNeural';

    // Stream headers — no Content-Length so browser starts playing immediately
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

    const tts = new EdgeTTS(clean, selectedVoice);
    const result = await tts.synthesize();

    // Try streaming first (edge-tts-universal v2+)
    if (result.audio && typeof result.audio.stream === 'function') {
      const stream = result.audio.stream();
      for await (const chunk of stream) {
        res.write(chunk);
      }
      return res.end();
    }

    // Fallback: audioStream property
    if (result.audioStream) {
      for await (const chunk of result.audioStream) {
        res.write(chunk);
      }
      return res.end();
    }

    // Last resort: buffer (old behavior, still faster than before due to chunked header)
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
    res.write(audioBuffer);
    return res.end();

  } catch (e) {
    if (!res.headersSent) {
      return res.status(500).json({ error: e.message });
    }
    res.end();
  }
}
