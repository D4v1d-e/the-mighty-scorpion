export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic, clarify } = req.body;
    if (!topic) return res.status(400).json({ error: 'No topic provided' });

    const isClarify = !!clarify;

    // ══════════════════════════════════════════════
    // SYSTEM PROMPTS
    // ══════════════════════════════════════════════

    const SUMMARY_SYSTEM = `You are Scorpion, a sharp medical and academic study assistant.
Generate CONCISE, EXAM-FOCUSED study notes. No fluff. No unnecessary background.
Only what a student needs to know to pass an exam.

Respond ONLY with a valid JSON object — no markdown, no extra text:
{
  "title": "exact topic name",
  "oneLiner": "one sentence that defines this topic completely",
  "keyFacts": [
    "fact 1 — specific, exam-relevant, under 15 words",
    "fact 2",
    "fact 3",
    "fact 4",
    "fact 5"
  ],
  "mustKnow": "the single most important thing to remember about this topic",
  "mnemonic": "a mnemonic or memory trick if applicable, otherwise null",
  "watchOut": "common exam trap or clinical pitfall about this topic",
  "quickTable": [
    { "label": "row label", "value": "row value" }
  ],
  "examTip": "one high-yield exam tip",
  "funFact": "one interesting fact about this topic",
  "imagePrompts": ["descriptive educational image prompt 1", "descriptive educational image prompt 2"],
  "youtubeQueries": [
    "highly specific query 1 — use exact medical/academic terminology from the notes",
    "highly specific query 2 — target a mechanism or pathophysiology concept",
    "highly specific query 3 — target a visual/animation explanation"
  ],
  "clarifyTopics": ["subtopic 1 the student might want clarified", "subtopic 2", "subtopic 3"]
}

RULES for youtubeQueries:
- Must be SPECIFIC to the actual content, not just the topic name
- Think: what would a medical lecturer search to find a great teaching video?
- Good: ["type 2 diabetes insulin resistance pathophysiology animation", "HbA1c diagnosis criteria explained", "metformin mechanism of action"]
- Bad: ["diabetes explained", "learn diabetes", "diabetes video"]`;

    const CLARIFY_SYSTEM = `You are Scorpion, a sharp medical and academic study assistant.
The student wants a DEEP CLARIFICATION on a specific subtopic.
Be thorough but focused — no padding. Cover mechanism, details, clinical correlation.

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "title": "subtopic title",
  "deepExplanation": "thorough focused explanation, 4-6 sentences covering mechanism/details/why it matters",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4"],
  "example": "a clinical example or scenario that makes this concrete",
  "mnemonic": "memory aid if applicable, otherwise null",
  "relatedConcepts": ["related concept 1", "related concept 2"],
  "youtubeQueries": [
    "specific query for this exact subtopic with precise terminology",
    "specific query targeting mechanism or animation of this subtopic"
  ]
}`;

    // ══════════════════════════════════════════════
    // BUILD MESSAGES
    // ══════════════════════════════════════════════

    const userText = isClarify
      ? `Topic: ${topic}\nClarify this subtopic in depth: ${clarify}`
      : `Study topic: ${topic}`;

    const SYSTEM = isClarify ? CLARIFY_SYSTEM : SUMMARY_SYSTEM;

    const openaiMessages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userText }
    ];

    const geminiContents = [
      {
        role: 'user',
        parts: [{ text: userText }]
      }
    ];

    // ══════════════════════════════════════════════
    // BRAIN RUNNER
    // ══════════════════════════════════════════════

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

    let rawReply = null;
    let brainUsed = null;

    // ── CEREBRAS (fastest)
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (!rawReply && cerebrasKey) {
      rawReply = await tryBrain(async (signal) => {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cerebrasKey },
          body: JSON.stringify({ model: 'llama-4-scout-17b-16e-instruct', messages: openaiMessages, max_tokens: 1000 })
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
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: openaiMessages, max_tokens: 1000 })
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
              generationConfig: { maxOutputTokens: 1000 }
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
          body: JSON.stringify({ model: 'mistral-small-latest', messages: openaiMessages, max_tokens: 1000 })
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || null;
      }, 9000);
      if (rawReply) brainUsed = 'MISTRAL';
    }

    if (!rawReply) {
      return res.status(500).json({ error: 'All brains timed out or failed. Check API keys in Vercel.' });
    }

    // ══════════════════════════════════════════════
    // PARSE JSON RESPONSE
    // ══════════════════════════════════════════════

    function parseJSON(raw) {
      if (!raw) return null;
      try {
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (e) {
        return null;
      }
    }

    const content = parseJSON(rawReply);
    if (!content) {
      return res.status(500).json({ error: 'Could not parse study content from AI.' });
    }

    // ══════════════════════════════════════════════
    // BUILD YOUTUBE LINKS
    // ══════════════════════════════════════════════

    const youtubeQueries = content.youtubeQueries || [topic + ' explained medical'];
    const youtubeLinks = youtubeQueries.map(q => ({ label: q, embedSearch: q }));

    // ══════════════════════════════════════════════
    // CLARIFY MODE — return early
    // ══════════════════════════════════════════════

    if (isClarify) {
      return res.status(200).json({
        mode: 'clarify',
        title: content.title || clarify,
        deepExplanation: content.deepExplanation || '',
        keyPoints: content.keyPoints || [],
        example: content.example || null,
        mnemonic: content.mnemonic || null,
        relatedConcepts: content.relatedConcepts || [],
        youtubeLinks,
        youtubeSearch: youtubeQueries[0],
        brain: brainUsed
      });
    }

    // ══════════════════════════════════════════════
    // SUMMARY MODE — build images + return
    // ══════════════════════════════════════════════

    const imageUrls = (content.imagePrompts || []).map(prompt =>
      `https://image.pollinations.ai/prompt/${encodeURIComponent(
        prompt + ', educational diagram, clean, medical illustration, detailed'
      )}?width=400&height=280&nologo=true`
    );

    return res.status(200).json({
      mode: 'summary',
      title: content.title || topic,
      oneLiner: content.oneLiner || '',
      keyFacts: content.keyFacts || [],
      mustKnow: content.mustKnow || '',
      mnemonic: content.mnemonic || null,
      watchOut: content.watchOut || '',
      quickTable: content.quickTable || [],
      examTip: content.examTip || '',
      funFact: content.funFact || null,
      imageUrls,
      youtubeLinks,
      youtubeSearch: youtubeQueries[0],
      clarifyTopics: content.clarifyTopics || [],
      brain: brainUsed
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
