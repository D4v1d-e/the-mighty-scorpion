// ═══════════════════════════════════════════════════════════════════
//  SCORPION AI — SPEAKER.JS  //  Edge TTS Neural Voice Engine
//  Vercel Serverless Function  →  /api/speaker
//  Uses Microsoft Edge TTS (edge-tts-universal) — no API key needed
//  Voice: en-US-GuyNeural (crisp, natural male voice)
// ═══════════════════════════════════════════════════════════════════

import { EdgeTTS } from 'edge-tts-universal';

// ── Voice options (swap VOICE_NAME to change voice) ─────────────────
//  Male   : en-US-GuyNeural | en-US-ChristopherNeural | en-GB-RyanNeural
//  Female : en-US-AriaNeural | en-US-JennyNeural | en-GB-SoniaNeural
// ────────────────────────────────────────────────────────────────────
const VOICE_NAME  = 'en-US-GuyNeural';
const MAX_CHARS   = 1000;           // hard cap to avoid runaway TTS
const RATE        = '+5%';          // speaking rate  (-50% … +100%)
const PITCH       = '-5Hz';         // pitch offset   (-50Hz … +50Hz)
const VOLUME      = '+10%';         // volume boost   (-100% … +100%)

export default async function handler(req, res) {

  // ── CORS headers (needed for browser fetch from any origin) ────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ── Pre-flight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed — use POST' });

  try {
    const { text, voice, rate, pitch, volume } = req.body || {};

    // ── Validate input ─────────────────────────────────────────────────
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    // ── Clean & sanitise text ──────────────────────────────────────────
    const cleanText = text
      .replace(/\*\*/g, '')                          // bold markdown
      .replace(/\*/g,   '')                          // italic markdown
      .replace(/#{1,6}\s/g, '')                      // heading markdown
      .replace(/`{1,3}/g, '')                        // code ticks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')       // links → label only
      .replace(/https?:\/\/\S+/g, '')                // bare URLs
      .replace(/\n{2,}/g, '. ')                      // double newlines → pause
      .replace(/\n/g, ' ')                           // single newlines → space
      .replace(/\s{2,}/g, ' ')                       // collapse whitespace
      .trim()
      .slice(0, MAX_CHARS);                          // hard length cap

    if (!cleanText) {
      return res.status(400).json({ error: 'Text is empty after cleaning' });
    }

    // ── Build SSML with prosody control ───────────────────────────────
    //  edge-tts-universal accepts plain text OR SSML.
    //  Wrapping in <speak>/<prosody> gives us rate/pitch/volume control.
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voice || VOICE_NAME}">
          <prosody rate="${rate || RATE}" pitch="${pitch || PITCH}" volume="${volume || VOLUME}">
            ${escapeXml(cleanText)}
          </prosody>
        </voice>
      </speak>
    `.trim();

    // ── Synthesise ─────────────────────────────────────────────────────
    const tts    = new EdgeTTS(ssml, voice || VOICE_NAME, { ssml: true });
    const result = await tts.synthesize();

    if (!result || !result.audio) {
      throw new Error('EdgeTTS returned no audio');
    }

    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      throw new Error('Audio buffer is empty');
    }

    // ── Stream MP3 back to client ──────────────────────────────────────
    res.setHeader('Content-Type',   'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.setHeader('Cache-Control',  'no-store');          // don't cache TTS
    return res.status(200).send(audioBuffer);

  } catch (err) {

    console.error('[speaker.js] TTS error:', err);

    // ── Structured error so client can decide to fallback ──────────────
    return res.status(500).json({
      error:   err.message || 'TTS synthesis failed',
      fallback: true,    // signals index.html to use browser speechSynthesis
    });
  }
}

// ── Utility: escape text for safe SSML embedding ──────────────────────
function escapeXml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}
