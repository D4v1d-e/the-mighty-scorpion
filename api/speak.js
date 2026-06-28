import { EdgeTTS } from 'edge-tts-universal';

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const tts = new EdgeTTS(text.slice(0, 1000), 'en-US-GuyNeural');
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.status(200).send(audioBuffer);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
