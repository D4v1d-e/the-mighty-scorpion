export const config = { maxDuration: 60 };

const GEMINI_TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  // Clean text — strip markdown, collapse whitespace, cap at 800 chars
  const clean = text
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '').replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ')
    .trim().slice(0, 800);

  if (!clean) return res.status(400).json({ error: 'Text was empty after cleaning' });

  // Voice style prompt — makes Gemini TTS sound like Jarvis
  const voicePrompt = `You are a sophisticated AI assistant named Scorpion with a deep, calm, confident British male voice. 
Speak with measured authority and subtle warmth — like a trusted advisor addressing someone important. 
Pace yourself naturally, with slight pauses before key information. 
Sound human, intelligent, and composed. Never robotic or flat.`;

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: voicePrompt + '\n\nNow speak this:\n' + clean }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Charon'
          }
        }
      }
    }
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const geminiRes = await fetch(`${GEMINI_TTS_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      if (geminiRes.status === 400) {
        return tryFallbackVoice(apiKey, clean, voicePrompt, res);
      }
      return res.status(geminiRes.status).json({
        error: `Gemini TTS error (HTTP ${geminiRes.status})`,
        details: errText.slice(0, 300)
      });
    }

    const data = await geminiRes.json();
    const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    const mimeType = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'audio/wav';

    if (!audioData) {
      return res.status(500).json({ error: 'No audio data in Gemini response' });
    }

    const audioBuffer = Buffer.from(audioData, 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Engine', 'Gemini-TTS');
    res.setHeader('X-Voice-Model', 'gemini-2.5-flash-preview-tts');
    res.setHeader('X-Voice-Name', 'Charon');
    res.send(audioBuffer);

  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(503).json({ error: 'Gemini TTS timed out — try again shortly.' });
    }
    if (!res.headersSent) return res.status(500).json({ error: e.message });
  }
}

async function tryFallbackVoice(apiKey, clean, voicePrompt, res) {
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: voicePrompt + '\n\nNow speak this:\n' + clean }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Fenrir'
          }
        }
      }
    }
  });

  try {
    const geminiRes = await fetch(`${GEMINI_TTS_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(geminiRes.status).json({
        error: `Gemini TTS fallback error (HTTP ${geminiRes.status})`,
        details: errText.slice(0, 300)
      });
    }

    const data = await geminiRes.json();
    const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    const mimeType = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'audio/wav';

    if (!audioData) {
      return res.status(500).json({ error: 'No audio data in Gemini fallback response' });
    }

    const audioBuffer = Buffer.from(audioData, 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Engine', 'Gemini-TTS');
    res.setHeader('X-Voice-Name', 'Fenrir');
    res.send(audioBuffer);

  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ error: 'Fallback voice error: ' + e.message });
  }
}
