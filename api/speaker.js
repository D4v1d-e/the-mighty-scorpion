import { EdgeTTS } from 'edge-tts-universal';

const VOICE_PROFILES = {
  jarvis: {
    voice: 'en-GB-RyanNeural',
    rate: '-5%',
    pitch: '-8Hz',
    volume: '+10%'
  },
  christopher: {
    voice: 'en-US-ChristopherNeural',
    rate: '-3%',
    pitch: '-4Hz',
    volume: '+8%'
  },
  steffan: {
    voice: 'en-GB-SteffanNeural',
    rate: '-4%',
    pitch: '-6Hz',
    volume: '+8%'
  }
};

function cleanText(text) {
  return text
    // strip markdown
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ', ')
    // strip ALL html/xml tags — this kills any leaked SSML or backend tags
    .replace(/<[^>]+>/g, '')
    // strip backend data labels that AI sometimes leaks into reply
    .replace(/\[HIGH CONFIDENCE\]/gi, '')
    .replace(/\[LOW CONFIDENCE\]/gi, '')
    .replace(/\[STALE\]/gi, '')
    .replace(/\[DATE:[^\]]*\]/gi, '')
    .replace(/INSTRUCTION:[^\n]*/gi, '')
    .replace(/===+[^=\n]*===+/g, '')
    .replace(/LIVE (CRYPTO|METALS|FOREX|WEATHER|SPORTS) DATA/gi, '')
    .replace(/WEB SEARCH[^\n]*/gi, '')
    .replace(/DATA GAP[^\n]*/gi, '')
    // html entities
    .replace(/&amp;/g, 'and')
    .replace(/&lt;/g, '')
    .replace(/&gt;/g, '')
    .replace(/&nbsp;/g, ' ')
    // clean up spacing
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, voiceProfile } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

    const clean = cleanText(text).slice(0, 900);
    const profile = VOICE_PROFILES[voiceProfile] || VOICE_PROFILES.jarvis;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

    // PLAIN TEXT ONLY — no SSML, no XML, no tags
    const tts = new EdgeTTS(clean, profile.voice);
    const result = await tts.synthesize();

    if (result.audio && typeof result.audio.stream === 'function') {
      const stream = result.audio.stream();
      for await (const chunk of stream) res.write(chunk);
      return res.end();
    }
    if (result.audioStream) {
      for await (const chunk of result.audioStream) res.write(chunk);
      return res.end();
    }
    const buf = Buffer.from(await result.audio.arrayBuffer());
    res.write(buf);
    return res.end();

  } catch (e) {
    if (!res.headersSent) {
      try {
        const clean = cleanText(req.body?.text || '').slice(0, 900);
        const tts = new EdgeTTS(clean, 'en-GB-RyanNeural');
        const result = await tts.synthesize();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        const buf = Buffer.from(await result.audio.arrayBuffer());
        res.write(buf);
        return res.end();
      } catch (e2) {
        return res.status(500).json({ error: e2.message });
      }
    }
    res.end();
  }
}
