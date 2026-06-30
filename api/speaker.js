// ============================================================
// SPEAKER API — EDGE TTS VOICE ENGINE
// ============================================================
// Description : Converts text to speech using Microsoft Edge TTS.
//               Returns raw MP3 audio stream to the client.
//
// Voice       : en-GB-RyanNeural (JARVIS profile, default)
//               en-US-ChristopherNeural
//               en-GB-SteffanNeural
//
// Method      : POST
// Body        : { text: string, voiceProfile?: string }
// Response    : audio/mpeg stream
//
// v2.2.0 Fix: removed the hard .slice(0, 900) truncation that was
// silently cutting off replies mid-sentence. The frontend now sends
// pre-chunked text (see chunkForSpeech in index.html), and this
// endpoint accepts a much higher ceiling purely as a safety cap, not
// as a normal-operation truncation point.
//
// Author      : Dr. Davie Mwangi
// Version     : 2.2.0
// ============================================================

import { EdgeTTS } from 'edge-tts-universal';

// ── VOICE PROFILES ──────────────────────────────────────────
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

// ── STATUS PHRASES (used by index.html before AI fetch) ─────
export const STATUS_PHRASES = {
  thinking: [
    'Accessing the neural matrix, Sir.',
    'Processing your query now.',
    'Calculating the optimal response.',
    'One moment while I analyse that.',
    'Running deep search protocols.'
  ],
  searching: [
    'Initiating web scan, Sir.',
    'Querying live data feeds.',
    'Pulling results from the network.',
    'Searching across all nodes.'
  ],
  weather: [
    'Connecting to atmospheric sensors.',
    'Pulling weather telemetry now.',
    'Fetching the latest forecast data.'
  ],
  youtube: [
    'Scanning YouTube for your track, Sir.',
    'Searching the media archive.',
    'Locking onto audio stream.'
  ],
  image: [
    'Generating diagram, Sir.',
    'Rendering visual now.',
    'Compiling the illustration.'
  ],
  resolving: [
    'Let me confirm the exact track, Sir.',
    'Verifying the precise song before I play it.',
    'One moment, checking the details.',
    'Cross-checking the correct title now.'
  ],
  continue: [
    'Shall I continue, Sir?'
  ]
};

// ── TEXT CLEANER ─────────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[HIGH CONFIDENCE\]/gi, '')
    .replace(/\[LOW CONFIDENCE\]/gi, '')
    .replace(/\[STALE\]/gi, '')
    .replace(/\[DATE:[^\]]*\]/gi, '')
    .replace(/INSTRUCTION:[^\n]*/gi, '')
    .replace(/===+[^=\n]*===+/g, '')
    .replace(/LIVE (CRYPTO|METALS|FOREX|WEATHER|SPORTS) DATA/gi, '')
    .replace(/WEB SEARCH[^\n]*/gi, '')
    .replace(/DATA GAP[^\n]*/gi, '')
    .replace(/&amp;/g, 'and')
    .replace(/&lt;/g, '')
    .replace(/&gt;/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── HANDLER ──────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, voiceProfile } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

    // FIX: raised from a hard 900-char truncation to a generous 6000-char
    // safety ceiling. The frontend already chunks long replies into
    // ~550-char pieces before calling this endpoint (see chunkForSpeech
    // in index.html), so in normal operation this never actually cuts
    // anything off — it only protects against a single pathological chunk.
    const clean = cleanText(text).slice(0, 6000);
    const profile = VOICE_PROFILES[voiceProfile] || VOICE_PROFILES.jarvis;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

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
        const clean = cleanText(req.body?.text || '').slice(0, 6000);
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
