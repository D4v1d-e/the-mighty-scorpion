// ═══════════════════════════════════════════════════════════════════
//  SCORPION AI — STUDY.JS  //  Master Tutor Engine
//  Vercel Serverless Function  →  /api/study
//  Returns rich structured JSON matching the pedagogical format:
//  WHY IT MATTERS → WHAT IS IT → FACTS → STRUCTURE → MECHANISM
//  → EXAMPLE → PROBLEMS → TAKEAWAYS → DEEPER
//  With strategic image prompts woven throughout
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic, clarify } = req.body;
    if (!topic) return res.status(400).json({ error: 'No topic provided' });

    const studyTopic = clarify ? `${topic} — specifically: ${clarify}` : topic;

    // ── SYSTEM PROMPT ────────────────────────────────────────────────
    const SYSTEM = `You are a master teacher. Your job is to teach any topic with the depth, clarity and flow of the world's best textbook combined with the warmth of a brilliant tutor.

You MUST return ONLY a valid JSON object — no markdown, no code fences, no preamble.

Return this exact JSON structure:

{
  "title": "Full descriptive title of the topic",
  "domain": "Subject area e.g. Cardiology, Physics, History, Chemistry",
  "brain": "AI",
  "oneLiner": "One powerful sentence that captures the essence in plain language",
  "whyShouldYouCare": "2-3 sentences explaining real-world relevance. Why does this matter? Connect it to life, career, health, or understanding the world.",
  "whatIsIt": "3-4 sentences giving a clear, conversational overview. Use analogies. Make it vivid.",
  "imagePrompts": [
    "Detailed description for image 1 — placed after the overview. Describe exactly what should be shown: anatomical diagram / process diagram / historical illustration / chemical structure etc. Be very specific about labels, colors, arrows, style.",
    "Detailed description for image 2 — placed after the mechanism section.",
    "Detailed description for image 3 — placed after the real world example.",
    "Detailed description for image 4 — placed after complications/problems section."
  ],
  "keyFacts": [
    "Specific fact with numbers/data where possible",
    "Specific fact with numbers/data where possible",
    "Specific fact with numbers/data where possible",
    "Specific fact with numbers/data where possible",
    "Specific fact with numbers/data where possible"
  ],
  "structure": {
    "intro": "1-2 sentences introducing the structural/component breakdown",
    "components": [
      { "name": "Component/Part name", "description": "What it is and what it does — conversational, clear" },
      { "name": "Component/Part name", "description": "What it is and what it does — conversational, clear" },
      { "name": "Component/Part name", "description": "What it is and what it does — conversational, clear" },
      { "name": "Component/Part name", "description": "What it is and what it does — conversational, clear" }
    ],
    "sequence": "If there is a sequence or flow, describe it as: A → B → C → D"
  },
  "mechanism": "3-5 sentences explaining HOW it works step by step. Use numbered steps or clear cause-effect language. This is the engine of understanding.",
  "realWorldExample": {
    "title": "Catchy title for the example e.g. Running to Catch a Bus",
    "story": "A vivid, concrete narrative showing the topic in action. Walk through what actually happens step by step. Use second person — 'you'. Make it engaging and memorable. 4-6 sentences minimum."
  },
  "commonProblems": [
    { "name": "Problem/Condition/Misconception name", "detail": "What it is, why it happens, key symptoms or consequences. Be specific and clinically/practically useful." },
    { "name": "Problem/Condition/Misconception name", "detail": "What it is, why it happens, key symptoms or consequences." },
    { "name": "Problem/Condition/Misconception name", "detail": "What it is, why it happens, key symptoms or consequences." },
    { "name": "Problem/Condition/Misconception name", "detail": "What it is, why it happens, key symptoms or consequences." }
  ],
  "keyTakeaways": [
    "Takeaway 1 — complete sentence, captures a core insight",
    "Takeaway 2 — complete sentence, captures a core insight",
    "Takeaway 3 — complete sentence, captures a core insight",
    "Takeaway 4 — complete sentence, captures a core insight",
    "Takeaway 5 — complete sentence, captures a core insight",
    "Takeaway 6 — complete sentence, captures a core insight",
    "Takeaway 7 — complete sentence, captures a core insight",
    "Takeaway 8 — complete sentence, captures a core insight"
  ],
  "digDeeper": [
    "Related topic 1 with brief note on what it covers",
    "Related topic 2 with brief note on what it covers",
    "Related topic 3 with brief note on what it covers",
    "Related topic 4 with brief note on what it covers",
    "Related topic 5 with brief note on what it covers"
  ],
  "mustKnow": "The single most important thing to remember about this topic. One sentence.",
  "mnemonic": "A memorable mnemonic, acronym, or memory trick if applicable. Otherwise null.",
  "examTip": "The most commonly tested or misunderstood aspect. One sentence.",
  "watchOut": "The biggest mistake people make or the most dangerous misconception. One sentence.",
  "youtubeSearch": "Best YouTube search query to find a good video about this topic",
  "clarifyTopics": [
    "Specific subtopic worth exploring deeper",
    "Specific subtopic worth exploring deeper",
    "Specific subtopic worth exploring deeper",
    "Specific subtopic worth exploring deeper",
    "Specific subtopic worth exploring deeper"
  ]
}

CRITICAL RULES:
- Return ONLY the JSON object. No text before or after.
- Every field must be filled. Never return null for strings — use empty string "" if truly not applicable.
- imagePrompts must be VERY detailed and specific — describe exactly what should be illustrated, what labels should appear, what colors/arrows/style to use.
- Be conversational and engaging — write like the world's best teacher, not a textbook robot.
- keyFacts must include specific numbers and data where possible.
- realWorldExample.story must be vivid and narrative, not a bullet list.
- commonProblems should cover the most clinically/practically important issues.`;

    // ── BRAIN FALLBACK CHAIN ─────────────────────────────────────────
    const brains = [
      {
        name: 'GROQ',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4000,
        type: 'openai'
      },
      {
        name: 'CEREBRAS',
        key: process.env.CEREBRAS_API_KEY,
        url: 'https://api.cerebras.ai/v1/chat/completions',
        model: 'llama-4-scout-17b-16e-instruct',
        max_tokens: 4000,
        type: 'openai'
      },
      {
        name: 'GEMINI',
        key: process.env.GEMINI_API_KEY,
        url: null,
        model: 'gemini-2.0-flash',
        max_tokens: 4000,
        type: 'gemini'
      },
      {
        name: 'MISTRAL',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-large-latest',
        max_tokens: 4000,
        type: 'openai'
      }
    ];

    let lastError = '';

    for (const brain of brains) {
      if (!brain.key) continue;

      try {
        let rawText = '';

        if (brain.type === 'gemini') {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${brain.model}:generateContent?key=${brain.key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM }] },
                contents: [{ role: 'user', parts: [{ text: `Teach me about: ${studyTopic}` }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: brain.max_tokens }
              })
            }
          );
          const d = await r.json();
          if (d.error) { lastError = d.error.message; continue; }
          rawText = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        } else {
          const r = await fetch(brain.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + brain.key
            },
            body: JSON.stringify({
              model: brain.model,
              messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user', content: `Teach me about: ${studyTopic}` }
              ],
              temperature: 0.7,
              max_tokens: brain.max_tokens,
              response_format: brain.name !== 'CEREBRAS' ? { type: 'json_object' } : undefined
            })
          });
          const d = await r.json();
          if (d.error) { lastError = d.error?.message || JSON.stringify(d.error); continue; }
          rawText = d?.choices?.[0]?.message?.content || '';
        }

        if (!rawText) { lastError = 'Empty response from ' + brain.name; continue; }

        // ── Parse JSON ─────────────────────────────────────────────
        let parsed;
        try {
          // strip any markdown fences just in case
          const clean = rawText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          parsed = JSON.parse(clean);
        } catch (e) {
          // try extracting JSON object from text
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); }
            catch (e2) { lastError = brain.name + ': JSON parse failed'; continue; }
          } else {
            lastError = brain.name + ': No JSON found in response';
            continue;
          }
        }

        // ── Fetch images using imagePrompts ────────────────────────
        const imageUrls = await fetchImages(parsed.imagePrompts || [], parsed.title || studyTopic);

        return res.status(200).json({
          ...parsed,
          brain: brain.name,
          imageUrls,
          topic: studyTopic
        });

      } catch (e) {
        lastError = brain.name + ': ' + e.message;
        continue;
      }
    }

    return res.status(500).json({ error: 'All brains failed. Last error: ' + lastError });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── IMAGE FETCHER ────────────────────────────────────────────────────
// Uses Wikimedia / Unsplash (no key) to find relevant images
async function fetchImages(prompts, topic) {
  if (!prompts || !prompts.length) return [];

  const urls = [];

  // Build search terms from topic + prompt keywords
  const searchTerms = prompts.map((prompt, i) => {
    // extract key nouns from the prompt for search
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(' ')
      .filter(w => w.length > 4)
      .slice(0, 3)
      .join(' ');
    return words || topic;
  });

  // Try Wikimedia Commons for each prompt
  for (let i = 0; i < Math.min(prompts.length, 4); i++) {
    try {
      const query = searchTerms[i] || topic;
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=images&titles=${encodeURIComponent(topic)}&gimlimit=10&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
      
      // Use Unsplash source (no API key needed, direct image URL)
      // This gives us real relevant images
      const unsplashUrl = `https://source.unsplash.com/800x500/?${encodeURIComponent(query.split(' ').slice(0,2).join(','))}`;
      urls.push(unsplashUrl);

    } catch (e) {
      // fallback: use topic-based search
      urls.push(`https://source.unsplash.com/800x500/?${encodeURIComponent(topic)},${i}`);
    }
  }

  return urls;
}
