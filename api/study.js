export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'No topic provided' });

    const SYSTEM = `You are Scorpion, a super intelligent study assistant.
When given a topic, respond ONLY with a valid JSON object in this exact format with no extra text or markdown:
{
  "title": "topic title",
  "explanation": "clear 3-4 sentence explanation a student can understand",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "imagePrompts": ["detailed image prompt 1", "detailed image prompt 2", "detailed image prompt 3"],
  "funFact": "one amazing fun fact about this topic",
  "youtubeSearch": "best youtube search query for learning this topic"
}`;

    const openaiMessages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Study topic: ' + topic }
    ];

    const geminiContents = [
      { role: 'user', parts: [{ text: 'Study topic: ' + topic }] }
    ];

    async function tryBrain(fetchFn, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fetchFn(controller.signal);
        clearTimeout(timer);
        return result;
      } catch (e) {
        clearTimeout(timer);
        return null;
      }
    }

    function parseStudyContent(raw) {
      if (!raw) return null;
      try {
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        // find first { to last }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (e) {
        return null;
      }
    }

    let rawReply = null;
    let brainUsed = null;

    // ── CEREBRAS
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (!rawReply && cerebrasKey) {
      rawReply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cerebrasKey },
          body: JSON.stringify({ model: 'llama-4-scout-17b-16e-instruct', messages: openaiMessages, max_tokens: 800 })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 6000);
      if (rawReply) brainUsed = 'CEREBRAS';
    }

    // ── GROQ
    const groqKey = process.env.GROQ_API_KEY;
    if (!rawReply && groqKey) {
      rawReply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: openaiMessages, max_tokens: 800 })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 7000);
      if (rawReply) brainUsed = 'GROQ';
    }

    // ── GEMINI
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!rawReply && geminiKey) {
      rawReply = await tryBrain(async (signal) => {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM }] },
              contents: geminiContents,
              generationConfig: { maxOutputTokens: 800 }
            })
          }
        );
        const d = await r.json();
        return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }, 8000);
      if (rawReply) brainUsed = 'GEMINI';
    }

    // ── MISTRAL
    const mistralKey = process.env.MISTRAL_API_KEY;
    if (!rawReply && mistralKey) {
      rawReply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mistralKey },
          body: JSON.stringify({ model: 'mistral-small-latest', messages: openaiMessages, max_tokens: 800 })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 9000);
      if (rawReply) brainUsed = 'MISTRAL';
    }

    if (!rawReply) {
      return res.status(500).json({ error: 'All brains timed out or failed. Check API keys in Vercel.' });
    }

    const studyContent = parseStudyContent(rawReply);
    if (!studyContent) {
      return res.status(500).json({ error: 'Could not parse study content from AI response.' });
    }

    // ── Build Pollinations image URLs (free, no key needed)
    const imageUrls = (studyContent.imagePrompts || []).map(prompt =>
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ', educational, detailed, high quality, illustration')}?width=400&height=300&nologo=true`
    );

    // ── Wikipedia summary
    let wikiSummary = null;
    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
      );
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        wikiSummary = wikiData.extract ? wikiData.extract.slice(0, 300) : null;
      }
    } catch (e) {}

    return res.status(200).json({
      title: studyContent.title || topic,
      explanation: studyContent.explanation || '',
      keyPoints: studyContent.keyPoints || [],
      imageUrls,
      funFact: studyContent.funFact || null,
      youtubeSearch: studyContent.youtubeSearch || topic + ' explained',
      wikiSummary,
      brain: brainUsed
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
