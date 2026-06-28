export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic, clarify } = req.body;
    if (!topic) return res.status(400).json({ error: 'No topic provided' });

    const studyTopic = clarify ? `${topic} — specifically: ${clarify}` : topic;
    const isClarify = Boolean(clarify);

    // ── SYSTEM PROMPT ──
    // Returns structured JSON for the renderer. Strict schema, no markdown.
    const systemPrompt = isClarify
      ? `You are an expert teacher doing a deep dive explanation. Return ONLY a valid JSON object — no markdown, no code fences, no preamble.

Schema for clarify/deep-dive:
{
  "title": "Subtopic name",
  "overview": "2-3 sentence plain-text overview",
  "deepExplanation": "Thorough paragraph explanation, plain text",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4"],
  "stepByStep": [
    { "step": 1, "title": "Step name", "detail": "Plain text detail" }
  ],
  "example": "Concrete real-world example, plain text",
  "mnemonic": "Memory aid or null",
  "watchOut": "Common mistake or pitfall or null",
  "relatedConcepts": ["concept 1", "concept 2", "concept 3"],
  "imagePrompts": ["Detailed image description 1", "Detailed image description 2"],
  "youtubeSearch": "Best YouTube search query for this subtopic",
  "brain": ""
}

Rules:
- All values plain text only — no markdown, no asterisks, no bullet characters.
- stepByStep must have 3-6 steps.
- keyPoints must have 4-6 items.
- relatedConcepts must have 3-5 items.
- imagePrompts: 1-2 vivid, detailed descriptions suitable for image search.
- Return ONLY the JSON object. Nothing else.`

      : `You are an expert teacher. Return ONLY a valid JSON object — no markdown, no code fences, no preamble.

Schema:
{
  "title": "Topic display name",
  "domain": "Subject area e.g. Biology / History / Physics",
  "oneLiner": "One punchy sentence defining the topic",
  "overview": "2-3 sentence plain-text overview, conversational tone",
  "keyFacts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"],
  "mechanism": "How it works — plain text, conversational, 2-4 sentences",
  "classification": [
    { "label": "Category name", "value": "Description" }
  ],
  "clinicalFeatures": [
    { "label": "Feature name", "value": "Description" }
  ],
  "investigations": [
    { "label": "Test name", "value": "What it shows" }
  ],
  "management": [
    { "label": "Stage or type", "value": "Treatment approach" }
  ],
  "quickTable": [
    { "label": "Key term", "value": "Definition or value" }
  ],
  "mustKnow": "The single most important fact to remember",
  "mnemonic": "A memorable acronym or phrase, or null if none exists",
  "examTip": "Top exam/test tip for this topic, or null",
  "watchOut": "Most common misconception or mistake, plain text",
  "differentialDiagnosis": ["item 1", "item 2", "item 3"],
  "complications": ["complication 1", "complication 2", "complication 3"],
  "clarifyTopics": ["subtopic chip 1", "subtopic chip 2", "subtopic chip 3", "subtopic chip 4", "subtopic chip 5"],
  "imagePrompts": ["Detailed image description 1", "Detailed image description 2"],
  "youtubeSearch": "Best YouTube search query for this topic",
  "brain": ""
}

Rules:
- All values plain text — no markdown, no asterisks, no bullet characters.
- keyFacts: 4-6 items, each a complete, interesting sentence.
- classification/clinicalFeatures/investigations/management/quickTable: include ONLY if relevant to the topic. Use [] if not applicable.
- differentialDiagnosis and complications: use [] if not applicable.
- clarifyTopics: 4-6 chips for sub-topics the user might want to explore.
- imagePrompts: 2 detailed image descriptions for search/display.
- Return ONLY the JSON object. Nothing else.`;

    // ── BRAIN ROSTER ──
    const brains = [
      {
        name: 'GROQ',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile'
      },
      {
        name: 'CEREBRAS',
        key: process.env.CEREBRAS_API_KEY,
        url: 'https://api.cerebras.ai/v1/chat/completions',
        model: 'llama-4-scout-17b-16e-instruct'
      },
      {
        name: 'MISTRAL',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-large-latest'
      }
    ];

    let lastError = '';

    // ── BRAIN FALLBACK LOOP ──
    for (const brain of brains) {
      if (!brain.key) continue;

      try {
        const response = await fetch(brain.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + brain.key
          },
          body: JSON.stringify({
            model: brain.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Study topic: ${studyTopic}` }
            ],
            temperature: 0.7,
            max_tokens: 3000
          })
        });

        const data = await response.json();

        if (data.error) {
          lastError = data.error.message || JSON.stringify(data.error);
          continue;
        }

        const raw = data?.choices?.[0]?.message?.content;
        if (!raw) { lastError = 'Empty response from ' + brain.name; continue; }

        // ── PARSE JSON ──
        let parsed;
        try {
          // Strip any accidental code fences
          const cleaned = raw
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          parsed = JSON.parse(cleaned);
        } catch (parseErr) {
          lastError = brain.name + ': JSON parse failed — ' + parseErr.message;
          continue;
        }

        // ── INJECT BRAIN NAME ──
        parsed.brain = brain.name;

        // ── RESOLVE IMAGES via Unsplash ──
        // imagePrompts → try Unsplash, fall back to placeholder
        const imagePrompts = Array.isArray(parsed.imagePrompts) ? parsed.imagePrompts : [];
        const imageUrls = imagePrompts.map(prompt => {
          const q = encodeURIComponent(prompt.slice(0, 80));
          // Unsplash Source (no API key needed, random image from search)
          return `https://source.unsplash.com/800x450/?${q}`;
        });
        parsed.imageUrls = imageUrls;

        // ── CLEAN UP FIELDS ──
        // Ensure arrays are always arrays (guard against model returning null)
        const arrFields = [
          'keyFacts', 'classification', 'clinicalFeatures', 'investigations',
          'management', 'quickTable', 'differentialDiagnosis', 'complications',
          'clarifyTopics', 'imagePrompts', 'keyPoints', 'stepByStep', 'relatedConcepts'
        ];
        for (const field of arrFields) {
          if (!Array.isArray(parsed[field])) parsed[field] = [];
        }

        // Ensure string fields are strings
        const strFields = [
          'title', 'domain', 'oneLiner', 'overview', 'mechanism',
          'mustKnow', 'mnemonic', 'examTip', 'watchOut',
          'deepExplanation', 'example', 'youtubeSearch'
        ];
        for (const field of strFields) {
          if (parsed[field] && typeof parsed[field] !== 'string') {
            parsed[field] = String(parsed[field]);
          }
        }

        return res.status(200).json(parsed);

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
