export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic, clarify } = req.body;
    if (!topic) return res.status(400).json({ error: 'No topic provided' });

    const isDeepDive = !!clarify;
    const studyTopic = isDeepDive ? `${topic} — specifically: ${clarify}` : topic;

    // ══ SYSTEM PROMPT ══
    // Structured like Claude AI study notes: clear sections, no fluff, exam-focused
    const systemPrompt = `You are SCORPION, a world-class professor AI. Generate clean, professional, exam-ready study notes.
Structure your output exactly like a top medical/academic textbook combined with Claude AI's clarity style.
No fluff. Every word earns its place. Be precise, thorough, and clinically accurate.

Respond ONLY with a valid JSON object — no markdown fences, no text outside the JSON.

For a STANDARD study topic return:
{
  "title": "exact topic name",
  "domain": "subject domain (Medicine, Biology, Chemistry, Physics, History, CS, etc.)",
  "oneLiner": "one precise sentence that completely defines this topic",
  "overview": "3-5 sentence professional overview covering what it is, why it matters, and clinical/academic context",
  "keyFacts": [
    "concise, exam-critical fact — specific numbers, values, names where relevant",
    "fact 2",
    "fact 3",
    "fact 4",
    "fact 5",
    "fact 6"
  ],
  "mechanism": "detailed explanation of HOW it works — pathophysiology, mechanism of action, or core process. 3-5 sentences.",
  "classification": [
    {"label": "category or type", "value": "description or examples"}
  ],
  "clinicalFeatures": [
    {"label": "feature name", "value": "description — signs, symptoms, or manifestations"}
  ],
  "investigations": [
    {"label": "test or investigation", "value": "what it shows, normal vs abnormal values"}
  ],
  "management": [
    {"label": "step or drug", "value": "dose, route, duration, or key detail"}
  ],
  "mustKnow": "the single most critical concept — what separates pass from fail",
  "mnemonic": "a powerful memory aid if applicable, otherwise null",
  "watchOut": "the most common exam trap, misconception, or clinical pitfall",
  "examTip": "high-yield exam strategy — what examiners love to test",
  "quickTable": [
    {"label": "comparison label", "value": "value or comparison"}
  ],
  "differentialDiagnosis": ["condition 1", "condition 2", "condition 3"],
  "complications": ["complication 1", "complication 2", "complication 3"],
  "imagePrompts": [
    "detailed educational diagram description 1 — be specific about what to show",
    "detailed educational diagram description 2"
  ],
  "clarifyTopics": ["subtopic 1 worth exploring", "subtopic 2", "subtopic 3"],
  "youtubeSearch": "highly specific youtube search query using exact medical/academic terminology"
}

RULES:
- If a section does not apply to the topic (e.g. management for a history topic), return an empty array [] for that field
- classification, clinicalFeatures, investigations, management, quickTable are all arrays of {label, value} objects
- differentialDiagnosis and complications are arrays of strings
- imagePrompts must be specific and descriptive enough to generate a useful educational diagram
- keyFacts must be exam-critical — include specific values, percentages, drug names, classifications
- mechanism must explain the underlying process deeply, not just restate the definition

For a DEEP DIVE (clarify mode) return:
{
  "title": "subtopic name",
  "overview": "2-3 sentence context — where this fits in the bigger picture",
  "deepExplanation": "thorough, structured explanation — mechanism, details, clinical significance. 5-8 sentences.",
  "keyPoints": [
    "key point 1 — specific and exam-ready",
    "key point 2",
    "key point 3",
    "key point 4"
  ],
  "stepByStep": [
    {"step": 1, "title": "step title", "detail": "what happens at this step"},
    {"step": 2, "title": "step title", "detail": "detail"}
  ],
  "example": "a concrete clinical case or real-world scenario that makes this tangible",
  "mnemonic": "memory aid if applicable, otherwise null",
  "watchOut": "specific pitfall or misconception about this subtopic",
  "imagePrompts": ["specific educational diagram for this subtopic"],
  "relatedConcepts": ["related concept 1", "related concept 2", "related concept 3"],
  "youtubeSearch": "specific youtube search query for this exact subtopic"
}`;

    // ══ BRAIN STACK ══
    const brains = [
      {
        name: 'CEREBRAS',
        key: process.env.CEREBRAS_API_KEY,
        url: 'https://api.cerebras.ai/v1/chat/completions',
        model: 'llama-4-scout-17b-16e-instruct'
      },
      {
        name: 'GROQ',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile'
      },
      {
        name: 'MISTRAL',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-large-latest'
      },
      {
        name: 'OPENROUTER',
        key: process.env.OPENROUTER_API_KEY,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'google/gemma-4-31b-it:free'
      }
    ];

    let studyData = null;
    let usedBrain = '';
    let lastError = '';

    for (const brain of brains) {
      if (!brain.key) continue;
      try {
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + brain.key
        };
        if (brain.name === 'OPENROUTER') {
          headers['HTTP-Referer'] = 'https://the-mighty-scorpion.vercel.app';
          headers['X-Title'] = 'Scorpion AI';
        }

        const response = await fetch(brain.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: brain.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Generate complete study notes for: ${studyTopic}` }
            ],
            temperature: 0.6,
            max_tokens: 4000
          })
        });

        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { lastError = 'Bad JSON from ' + brain.name; continue; }
        if (data.error) { lastError = data.error.message || JSON.stringify(data.error); continue; }

        const raw = data?.choices?.[0]?.message?.content;
        if (!raw) { lastError = 'Empty from ' + brain.name; continue; }

        const cleaned = raw.replace(/```json/g,'').replace(/```/g,'').trim();
        try {
          studyData = JSON.parse(cleaned);
        } catch(e) {
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (match) {
            try { studyData = JSON.parse(match[0]); } catch(e2) { lastError = 'JSON parse fail'; continue; }
          } else { lastError = 'No JSON found'; continue; }
        }

        usedBrain = brain.name;
        break;

      } catch(e) {
        lastError = brain.name + ': ' + e.message;
        continue;
      }
    }

    if (!studyData) {
      return res.status(500).json({ error: 'All brains failed: ' + lastError });
    }

    studyData.brain = usedBrain;

    // ══ GEMINI IMAGEN — generate images from prompts ══
    const geminiKey = process.env.GEMINI_API_KEY;
    const imagePrompts = Array.isArray(studyData.imagePrompts) ? studyData.imagePrompts.slice(0, 2) : [];
    studyData.imageUrls = [];

    if (geminiKey && imagePrompts.length > 0) {
      const imageResults = await Promise.allSettled(
        imagePrompts.map(async (prompt) => {
          const fullPrompt = `Educational medical diagram: ${prompt}. Clean, professional, labeled, suitable for medical students. White background, clear annotations.`;
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instances: [{ prompt: fullPrompt }],
                parameters: {
                  sampleCount: 1,
                  aspectRatio: '4:3',
                  safetyFilterLevel: 'block_few',
                  personGeneration: 'dont_allow'
                }
              })
            }
          );
          const data = await r.json();
          if (data.error) throw new Error(data.error.message);
          const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
          if (!b64) throw new Error('No image data');
          return `data:image/png;base64,${b64}`;
        })
      );

      studyData.imageUrls = imageResults
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
    }

    // ══ SANITIZE — ensure all arrays are arrays ══
    const ensureArr = (v) => Array.isArray(v) ? v : [];
    studyData.keyFacts          = ensureArr(studyData.keyFacts);
    studyData.classification    = ensureArr(studyData.classification);
    studyData.clinicalFeatures  = ensureArr(studyData.clinicalFeatures);
    studyData.investigations    = ensureArr(studyData.investigations);
    studyData.management        = ensureArr(studyData.management);
    studyData.quickTable        = ensureArr(studyData.quickTable);
    studyData.differentialDiagnosis = ensureArr(studyData.differentialDiagnosis);
    studyData.complications     = ensureArr(studyData.complications);
    studyData.clarifyTopics     = ensureArr(studyData.clarifyTopics);
    studyData.imageUrls         = ensureArr(studyData.imageUrls);
    // deep dive
    studyData.keyPoints         = ensureArr(studyData.keyPoints);
    studyData.stepByStep        = ensureArr(studyData.stepByStep);
    studyData.relatedConcepts   = ensureArr(studyData.relatedConcepts);

    return res.status(200).json(studyData);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
