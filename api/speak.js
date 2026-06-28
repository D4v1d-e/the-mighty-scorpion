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

    // Use provided voice or default to Guy (male, Jarvis-style)
    const selectedVoice = voice || 'en-US-GuyNeural';

    const tts = new EdgeTTS(clean, selectedVoice);
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(audioBuffer);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
