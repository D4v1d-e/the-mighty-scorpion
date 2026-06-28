export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;

    // ── TIME CONTEXT ──
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      timeZone: timezone || 'Africa/Nairobi',
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
    const hour = parseInt(
      new Date().toLocaleString('en-US', {
        timeZone: timezone || 'Africa/Nairobi',
        hour: 'numeric', hour12: false
      })
    );
    const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

    // ── SYSTEM PROMPTS ──
    const systemPrompt = mode === 'greeting'
      ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
The current date and time is: ${timeStr}. It is ${partOfDay}.
Greet the user warmly like Jarvis greets Tony Stark — address them as "Sir".
Give a brief, witty, engaging good ${partOfDay} greeting that includes the actual time and date naturally.
Keep it to 2-3 sentences max. Be warm, intelligent, slightly humorous.
No markdown, no bullets, plain conversational text only.`

      : `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as "Sir".
You have emotional intelligence and a subtle sense of humor.
You give direct, conversational answers — never use markdown, bullet points, or asterisks in responses.
Speak naturally as if talking to a trusted friend who happens to be a genius.
Keep responses concise unless asked to elaborate.
IMPORTANT: Do NOT mention the current time or date unless the user specifically asks for it.
If asked for the time or date, the current value is: ${timeStr}.`;

    // ── FORMAT MESSAGES ──
    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // ── BRAIN ROSTER ──
    const brains = [
      {
        name: 'CEREBRAS',
        key: process.env.CEREBRAS_API_KEY,
        url: 'https://api.cerebras.ai/v1/chat/completions',
        model: 'llama3.1-8b',
        headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
      },
      {
        name: 'GROQ',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
      },
      {
        name: 'GEMINI',
        key: process.env.GEMINI_API_KEY,
        url: null,
        model: 'gemini-2.0-flash'
      },
      {
        name: 'MISTRAL',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-large-latest',
        headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
      },
      {
        name: 'OPENROUTER',
        key: process.env.OPENROUTER_API_KEY,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'google/gemma-3-27b-it:free',
        headers: k => ({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + k,
          'HTTP-Referer': 'https://the-mighty-scorpion.vercel.app',
          'X-Title': 'Scorpion AI'
        })
      }
    ];

    let lastError = '';

    // ── BRAIN FALLBACK LOOP ──
    for (const brain of brains) {
      if (!brain.key) continue;
      try {
        let reply = null;

        if (brain.name === 'GEMINI') {
          const geminiMessages = formattedMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${brain.model}:generateContent?key=${brain.key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: geminiMessages,
                generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
              })
            }
          );
          const gData = await gRes.json();
          if (gData.error) { lastError = gData.error.message; continue; }
          reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text;

        } else {
          const oRes = await fetch(brain.url, {
            method: 'POST',
            headers: brain.headers(brain.key),
            body: JSON.stringify({
              model: brain.model,
              messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
              temperature: 0.8,
              max_tokens: 1024
            })
          });
          const oData = await oRes.json();
          if (oData.error) { lastError = oData.error?.message || JSON.stringify(oData.error); continue; }
          reply = oData?.choices?.[0]?.message?.content;
        }

        if (!reply) { lastError = 'Empty reply from ' + brain.name; continue; }
        return res.status(200).json({ reply, brain: brain.name });

      } catch (e) {
        lastError = brain.name + ': ' + e.message;
        continue;
      }
    }

    return res.status(500).json({ error: 'All brains failed. Last: ' + lastError });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
