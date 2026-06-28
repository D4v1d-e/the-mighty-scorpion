import { EdgeTTS } from 'edge-tts-universal';

// Best human-sounding voices ranked by naturalness
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
    voice: 'en-GB-ThomasNeural',
    rate: '-4%',
    pitch: '-6Hz',
    volume: '+8%'
  }
};

// Clean all markdown, symbols, and non-speech characters FIRST
function cleanText(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // strip markdown links, keep label
    .replace(/\|/g, ', ')                        // table pipes to pauses
    .replace(/<[^>]+>/g, '')                     // strip any stray HTML tags
    .replace(/&amp;/g, 'and')
    .replace(/&lt;/g, '')
    .replace(/&gt;/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Build SIMPLE, safe SSML — no emphasis tags on numbers (they break flow)
function buildSSML(text, profile) {
  const { voice, rate, pitch, volume } = profile;

  // Only safe SSML — pauses at punctuation only
  const ssmlText = text
    .replace(/&/g, '&amp;')                      // escape XML entities FIRST
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/,\s+/g, ', <break time="100ms"/> ')
    .replace(/\.\s+/g, '. <break time="180ms"/> ')
    .replace(/[:;]\s+/g, ': <break time="130ms"/> ')
    .replace(/\s*—\s*/g, ' <break time="160ms"/> ')
    .replace(/\?\s+/g, '? <break time="200ms"/> ')
    .replace(/!\s+/g, '! <break time="180ms"/> ');

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
    xmlns:mstts="https://www.w3.org/2001/mstts"
    xml:lang="en-GB">
    <voice name="${voice}">
      <mstts:express-as style="default" styledegree="1">
        <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
          ${ssmlText}
        </prosody>
      </mstts:express-as>
    </voice>
  </speak>`;
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

    // Clean FIRST, then slice — never slice mid-word or mid-tag
    const clean = cleanText(text).slice(0, 900);
    const profile = VOICE_PROFILES[voiceProfile] || VOICE_PROFILES.jarvis;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Try SSML first
    try {
      const ssml = buildSSML(clean, profile);
      let tts;
      try {
        tts = new EdgeTTS(ssml, profile.voice, { ssml: true });
      } catch {
        tts = new EdgeTTS(clean, profile.voice);
      }

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

    } catch (ssmlErr) {
      // SSML failed — fall back to plain text, no SSML at all
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
    }

  } catch (e) {
    if (!res.headersSent) {
      // Last resort — plain text, default voice
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
