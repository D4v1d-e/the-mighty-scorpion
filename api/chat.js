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

    // ── TAVILY WEB SEARCH ──
    async function tavilySearch(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            query,
            search_depth: 'advanced',
            max_results: 5,
            include_answer: true,
            include_raw_content: false
          })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((r, i) => `[Source ${i + 1}] ${r.title}\n${r.content?.slice(0, 400)}`)
          .join('\n\n');
        return data.answer
          ? `DIRECT ANSWER: ${data.answer}\n\nSOURCE DETAILS:\n${snippets}`
          : `SOURCE DETAILS:\n${snippets}`;
      } catch (e) {
        return null;
      }
    }

    // ── DETECT IF QUESTION NEEDS LIVE DATA ──
    function needsWebSearch(messages) {
      if (!messages?.length) return false;
      const last = messages[messages.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase();
      const triggers = [
        'today', 'yesterday', 'this week', 'this month', 'this year',
        'latest', 'recent', 'current', 'now', 'right now', 'live',
        'news', 'update', 'score', 'result', 'winner', 'price',
        'stock', 'weather', 'trending', 'happened', 'just',
        'who won', 'who is', 'what is the', 'how much is',
        '2024', '2025', '2026', 'breaking', 'announce', 'released',
        'new', 'launch', 'match', 'game', 'election', 'crypto',
        'bitcoin', 'transfer', 'signing', 'died', 'arrested',
        'championship', 'tournament', 'final', 'standings', 'table',
        'market', 'economy', 'inflation', 'rate', 'oil', 'gold',
        'premiere', 'album', 'single', 'chart', 'box office'
      ];
      return triggers.some(t => text.includes(t));
    }

    // ── FORMAT MESSAGES ──
    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // ── WEB SEARCH IF NEEDED ──
    let webContext = '';
    let searchedWeb = false;
    if (mode !== 'greeting' && needsWebSearch(userMessages)) {
      const lastMsg = userMessages[userMessages.length - 1];
      const query = lastMsg?.text || lastMsg?.content || '';
      const results = await tavilySearch(query);
      if (results) {
        webContext = results;
        searchedWeb = true;
      }
    }

    // ── SYSTEM PROMPTS ──
    const webNote = searchedWeb
      ? `\n\nCRITICAL INSTRUCTIONS FOR THIS RESPONSE:
You have been given LIVE WEB DATA fetched right now from the internet.
You MUST follow these rules strictly:

1. Use ONLY the information from the LIVE WEB DATA below to answer
2. NEVER add your own invented details, statistics, scores or prices on top
3. NEVER fabricate names, numbers, dates or events not in the data
4. If the web data does not contain enough info — say exactly: "I only have limited data on that Sir, but here is what I found:"
5. If you truly have no data — say: "I could not find reliable information on that Sir"
6. Keep answers conversational, warm and Jarvis-like but strictly factual
7. Do NOT tell stories or add dramatic details not in the source data

LIVE WEB DATA (use this as your ONLY source of facts):
${webContext}`
      : '';

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
CRITICAL: If you are not 100% certain of a fact — especially dates, prices, scores or recent events — say "I am not certain Sir" rather than inventing an answer. Never fabricate statistics, scores, prices or news.
IMPORTANT: Do NOT mention the current time or date unless the user specifically asks for it.
If asked for the time or date, the current value is: ${timeStr}.${webNote}`;

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
                generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
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
              temperature: 0.4,
              max_tokens: 1024
            })
          });
          const oData = await oRes.json();
          if (oData.error) { lastError = oData.error?.message || JSON.stringify(oData.error); continue; }
          reply = oData?.choices?.[0]?.message?.content;
        }

        if (!reply) { lastError = 'Empty reply from ' + brain.name; continue; }
        return res.status(200).json({
          reply,
          brain: brain.name + (searchedWeb ? ' + WEB' : '')
        });

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
