export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

    const SYSTEM = 'You are Scorpion, a powerful personal AI assistant for Johnson. Sharp, direct, intelligent. Keep responses concise — max 2 sentences unless asked for more. Never use bullet points or markdown.';

    async function tryBrain(fetchFn, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fetchFn(controller.signal);
        clearTimeout(timer);
        return result;
      } catch(e) {
        clearTimeout(timer);
        return null;
      }
    }

    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (cerebrasKey) {
      const reply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cerebrasKey },
          body: JSON.stringify({
            model: 'llama-4-scout-17b-16e-instruct',
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
            max_tokens: 300
          })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 4000);
      if (reply) return res.status(200).json({ reply, brain: 'CEREBRAS' });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      const reply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
            max_tokens: 300
          })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 5000);
      if (reply) return res.status(200).json({ reply, brain: 'GROQ' });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const reply = await tryBrain(async (signal) => {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 300 }
            })
          }
        );
        const d = await r.json();
        return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }, 6000);
      if (reply) return res.status(200).json({ reply, brain: 'GEMINI' });
    }

    const mistralKey = process.env.MISTRAL_API_KEY;
    if (mistralKey) {
      const reply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mistralKey },
          body: JSON.stringify({
            model: 'mistral-small-latest',
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
            max_tokens: 300
          })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 7000);
      if (reply) return res.status(200).json({ reply, brain: 'MISTRAL' });
    }

    return res.status(500).json({ error: 'All brains timed out or failed. Check API keys in Vercel.' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
