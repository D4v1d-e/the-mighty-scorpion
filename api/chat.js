export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

    const SYSTEM = 'You are Scorpion, a powerful personal AI assistant for Johnson. Sharp, direct, intelligent. Keep responses concise and clear — max 3 sentences unless asked for more.';

    // ── BRAIN 1: CEREBRAS (fastest) ──────────────────────
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (cerebrasKey) {
      try {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + cerebrasKey
          },
          body: JSON.stringify({
            model: 'llama-4-scout-17b-16e-instruct',
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: prompt }
            ],
            max_tokens: 500
          })
        });
        const d = await r.json();
        if (d.choices?.[0]?.message?.content) {
          return res.status(200).json({ reply: d.choices[0].message.content, brain: 'CEREBRAS' });
        }
      } catch(e) {}
    }

    // ── BRAIN 2: GROQ (fast backup) ──────────────────────
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + groqKey
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: prompt }
            ],
            max_tokens: 500
          })
        });
        const d = await r.json();
        if (d.choices?.[0]?.message?.content) {
          return res.status(200).json({ reply: d.choices[0].message.content, brain: 'GROQ' });
        }
      } catch(e) {}
    }

    // ── BRAIN 3: GEMINI (volume) ──────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }]
            })
          }
        );
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return res.status(200).json({ reply: text, brain: 'GEMINI' });
        }
      } catch(e) {}
    }

    // ── BRAIN 4: MISTRAL (smart fallback) ────────────────
    const mistralKey = process.env.MISTRAL_API_KEY;
    if (mistralKey) {
      try {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + mistralKey
          },
          body: JSON.stringify({
            model: 'mistral-small-latest',
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: prompt }
            ],
            max_tokens: 500
          })
        });
        const d = await r.json();
        if (d.choices?.[0]?.message?.content) {
          return res.status(200).json({ reply: d.choices[0].message.content, brain: 'MISTRAL' });
        }
      } catch(e) {}
    }

    return res.status(500).json({ error: 'All 4 brains failed. Check your API keys in Vercel.' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
