import { EdgeTTS } from 'edge-tts-universal';

// Best human-sounding voices ranked by naturalness
const VOICE_PROFILES = {
  // Primary: Brian (UK) — deepest, most natural, Jarvis-like
  jarvis: {
    voice: 'en-GB-RyanNeural',
    rate: '-5%',
    pitch: '-8Hz',
    volume: '+10%'
  },
  // Backup 1: Christopher — warm US male, very natural
  christopher: {
    voice: 'en-US-ChristopherNeural',
    rate: '-3%',
    pitch: '-4Hz',
    volume: '+8%'
  },
  // Backup 2: Steffan (UK) — smooth, professional
  steffan: {
    voice: 'en-GB-ThomasNeural',
    rate: '-4%',
    pitch: '-6Hz',
    volume: '+8%'
  }
};

function buildSSML(text, profile) {
  const { voice, rate, pitch, volume } = profile;

  // Smart sentence splitting — adds micro-pauses at punctuation
  const ssmlText = text
    // Commas → brief pause
    .replace(/,\s+/g, ', <break time="120ms"/> ')
    // Periods / exclamation → medium pause
    .replace(/\.\s+/g, '. <break time="200ms"/> ')
    // Colons / semicolons → slight pause
    .replace(/[:;]\s+/g, ': <break time="150ms"/> ')
    // Dashes (em dash) → conversational pause
    .replace(/\s*—\s*/g, ' <break time="180ms"/> ')
    // Numbers: add slight emphasis for clarity
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<emphasis level="moderate">$1</emphasis>')
    // "Sir" → slight emphasis, very natural
    .replace(/\bSir\b/g, '<emphasis level="moderate">Sir</emphasis>');

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

function cleanText(text) {
  return text
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '').replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
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

    const clean = cleanText(text);
    const profile = VOICE_PROFILES[voiceProfile] || VOICE_PROFILES.jarvis;
    const ssml = buildSSML(clean, profile);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Try SSML synthesis first (most human-sounding)
    let tts;
    try {
      tts = new EdgeTTS(ssml, profile.voice, { ssml: true });
    } catch {
      // edge-tts-universal older versions: pass plain text
      tts = new EdgeTTS(clean, profile.voice);
    }

    const result = await tts.synthesize();

    // Stream path 1: .stream() method (v2+)
    if (result.audio && typeof result.audio.stream === 'function') {
      const stream = result.audio.stream();
      for await (const chunk of stream) res.write(chunk);
      return res.end();
    }

    // Stream path 2: .audioStream property
    if (result.audioStream) {
      for await (const chunk of result.audioStream) res.write(chunk);
      return res.end();
    }

    // Fallback: buffer
    const buf = Buffer.from(await result.audio.arrayBuffer());
    res.write(buf);
    return res.end();

  } catch (e) {
    // If SSML failed, retry with plain text + best voice
    if (!res.headersSent) {
      try {
        const clean = cleanText(req.body.text || '');
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
