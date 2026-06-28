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
    const isClarify = !!clarify;

    // ══════════════════════════════════════════════════════════════
    // SYSTEM PROMPT — returns PURE JSON matching renderStudy() fields
    // ══════════════════════════════════════════════════════════════
    const systemPrompt = `You are an expert teacher and master explainer. Your job is to produce a COMPREHENSIVE, DEEPLY ENGAGING study module that teaches like the world's best tutor.

CRITICAL: Return ONLY a valid JSON object. No markdown. No code fences. No preamble. No explanation outside the JSON.

The JSON must match this EXACT schema:

{
  "title": "Full topic name (clear, descriptive)",
  "domain": "Subject area e.g. CARDIOLOGY / BIOCHEMISTRY / PHYSICS / HISTORY",
  "oneLiner": "One sentence that nails the essence — what it IS and why it MATTERS. Should hook the reader instantly.",
  "overview": "3-5 sentences. Conversational but precise. Explain it like to a smart friend. Use analogies. WHY does this exist? What problem does it solve? Give the big picture FIRST before details.",
  "keyFacts": [
    "Fact 1 — include numbers, units, specifics. Not vague — be precise.",
    "Fact 2 — surprising or counterintuitive facts work best here.",
    "Fact 3 — clinical/practical/real-world relevance.",
    "Fact 4 — mechanism or process highlight.",
    "Fact 5 — something examiners love to test."
  ],
  "mechanism": "How it WORKS — step by step in flowing prose. This is the engine room. Explain cause → effect → result. Use analogies. Be vivid. If it's a process, walk through it. If it's a concept, build from first principles. 3-6 sentences minimum.",
  "classification": [
    {"label": "Category name", "value": "What belongs here and key distinguishing feature"},
    {"label": "Type 2", "value": "Description with clinical/practical significance"}
  ],
  "clinicalFeatures": [
    {"label": "Feature name", "value": "Description — include WHY this feature occurs mechanistically"},
    {"label": "Sign/Symptom", "value": "Detail"}
  ],
  "investigations": [
    {"label": "Test name", "value": "What it shows and why you order it — include key values/findings"},
    {"label": "Investigation 2", "value": "Finding and significance"}
  ],
  "management": [
    {"label": "Stage/Priority", "value": "Specific intervention — drug names, doses where relevant, rationale"},
    {"label": "Step 2", "value": "Next intervention"}
  ],
  "quickTable": [
    {"label": "Key term or parameter", "value": "Value, range, or definition"},
    {"label": "Another parameter", "value": "Its value"}
  ],
  "mustKnow": "The single most important fact. The one thing that, if you forget everything else, you must remember THIS. Often the mechanism, the exception, or the killer fact.",
  "mnemonic": "A memorable mnemonic, acronym, or rhyme that locks in the key points. Make it vivid and sticky. If a classic mnemonic exists, use it. Otherwise create a brilliant one.",
  "watchOut": "The classic mistake, dangerous assumption, or common pitfall. What trips up students and kills patients. Be specific.",
  "examTip": "What examiners specifically love to test about this topic. Pattern of questions, common stems, what distinguishes a top answer.",
  "differentialDiagnosis": [
    "Condition 1 — key distinguishing feature vs topic",
    "Condition 2 — how to tell apart"
  ],
  "complications": [
    "Complication 1 — mechanism and timing",
    "Complication 2"
  ],
  "clarifyTopics": [
    "Specific subtopic worth deep-diving",
    "Related mechanism to explore",
    "Clinical application to investigate",
    "Comparison with related concept"
  ],
  "youtubeSearch": "Best YouTube search query to find a great educational video on this topic",
  "imageUrls": []
}

QUALITY RULES:
- Every field should teach, not just label. "Fact" is not enough — explain WHY it's true.
- The overview should answer: what IS it, why does it EXIST, why should I CARE?
- Mechanism should use analogies. Heart = two pumps. Kidneys = filter + regulator. Make it click.
- mustKnow should be the thing that changes how you understand everything else.
- mnemonic must be genuinely memorable — not just an acronym, make it stick.
- clarifyTopics should be specific and tantalising — things you'd actually WANT to know more about.
- If the topic is not medical/clinical, adapt the fields: skip clinicalFeatures/investigations/management if irrelevant and instead use quickTable and classification creatively.
- Always include at least 5 keyFacts, always include mustKnow, mnemonic, watchOut, examTip.
- imageUrls: return as empty array []. Images will be sourced separately.
- Respond ONLY with the JSON object. Nothing before it. Nothing after it.`;

    // ══════════════════════════════════════════════════════════════
    // CLARIFY SYSTEM PROMPT — deep dive on a subtopic
    // ══════════════════════════════════════════════════════════════
    const clarifySystemPrompt = `You are an expert teacher doing a DEEP DIVE on a specific subtopic. Go beyond the surface — this is for someone who already understands the basics and wants the full picture.

CRITICAL: Return ONLY a valid JSON object. No markdown. No code fences. No preamble.

{
  "title": "Subtopic name — specific and descriptive",
  "domain": "Subject area",
  "overview": "3-5 sentences. Start with the big idea. Why does this subtopic matter within the broader topic? What's the core concept?",
  "deepExplanation": "This is the heart of the response. 5-8 sentences of rich, detailed explanation. Build from first principles. Use analogies. Explain mechanism, not just description. Go to the level that makes you say 'ohhhh now I get it'.",
  "keyPoints": [
    "Key point 1 — specific, precise, with numbers/values where relevant",
    "Key point 2 — mechanistic insight",
    "Key point 3 — clinical or practical application",
    "Key point 4 — common confusion cleared up",
    "Key point 5 — the advanced insight that separates good from great"
  ],
  "stepByStep": [
    {"step": 1, "title": "Step name", "detail": "What happens at this step and WHY — include mechanism"},
    {"step": 2, "title": "Step name", "detail": "Detail"},
    {"step": 3, "title": "Step name", "detail": "Detail"}
  ],
  "example": "A vivid, concrete real-world example or scenario that makes this click. Tell a mini story. Make it memorable.",
  "mnemonic": "Memory aid specifically for this subtopic.",
  "watchOut": "The specific pitfall or misconception about THIS subtopic.",
  "relatedConcepts": [
    "Related concept 1",
    "Related concept 2",
    "Related concept 3"
  ],
  "youtubeSearch": "Best search query for a video on this specific subtopic",
  "imageUrls": []
}

QUALITY RULES:
- deepExplanation is the most important field. This should genuinely teach — not summarize.
- stepByStep should only be included if the topic is a process/mechanism. If it's a concept, still include it but frame as conceptual layers.
- example should be specific, not generic. "Imagine you're running to catch a bus..." not "For example, in clinical practice..."
- Respond ONLY with the JSON object. Nothing before it. Nothing after it.`;

    const brains = [
      {
        name: 'CEREBRAS',
        key: process.env.CEREBRAS_API_KEY,
        url: 'https://api.cerebras.ai/v1/chat/completions',
        model: 'llama-4-scout-17b-16e-instruct',
        type: 'openai'
      },
      {
        name: 'GROQ',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        type: 'openai',
        jsonMode: true
      },
      {
        name: 'GEMINI',
        key: process.env.GEMINI_API_KEY,
        model: 'gemini-2.0-flash',
        type: 'gemini'
      },
      {
        name: 'MISTRAL',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-large-latest',
        type: 'openai',
        jsonMode: true
      }
    ];

    let lastError = '';
    const chosenPrompt = isClarify ? clarifySystemPrompt : systemPrompt;
    const userMessage = isClarify
      ? `Give me a deep dive on: "${clarify}" — in the context of: "${topic}"`
      : `Create a complete study module for: "${studyTopic}"`;

    for (const brain of brains) {
      if (!brain.key) continue;

      try {
        let rawContent = null;

        // ── GEMINI — special request format
        if (brain.type === 'gemini') {
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${brain.model}:generateContent?key=${brain.key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: chosenPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userMessage }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 4000,
                  responseMimeType: 'application/json'   // Gemini native JSON mode
                }
              })
            }
          );
          const gData = await gRes.json();
          if (gData.error) { lastError = 'GEMINI: ' + gData.error.message; continue; }
          rawContent = gData?.candidates?.[0]?.content?.parts?.[0]?.text;

        // ── OPENAI-compatible (Cerebras, Groq, Mistral)
        } else {
          const body = {
            model: brain.model,
            messages: [
              { role: 'system', content: chosenPrompt },
              { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 4000
          };
          if (brain.jsonMode) body.response_format = { type: 'json_object' };

          const response = await fetch(brain.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + brain.key
            },
            body: JSON.stringify(body)
          });

          const data = await response.json();
          if (data.error) { lastError = brain.name + ': ' + (data.error.message || JSON.stringify(data.error)); continue; }
          rawContent = data?.choices?.[0]?.message?.content;
        }

        if (!rawContent) {
          lastError = 'Empty response from ' + brain.name;
          continue;
        }

        // ── Strip any accidental markdown fences
        rawContent = rawContent
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();

        // ── Find the JSON object boundaries (defensive)
        const firstBrace = rawContent.indexOf('{');
        const lastBrace = rawContent.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          rawContent = rawContent.slice(firstBrace, lastBrace + 1);
        }

        let parsed;
        try {
          parsed = JSON.parse(rawContent);
        } catch (parseErr) {
          // ── Try to recover: sometimes model adds trailing commas or minor issues
          try {
            // Remove trailing commas before } or ]
            const fixed = rawContent
              .replace(/,\s*([}\]])/g, '$1')
              .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // unquoted keys
            parsed = JSON.parse(fixed);
          } catch (e2) {
            lastError = brain.name + ': JSON parse failed — ' + parseErr.message;
            continue;
          }
        }

        // ── Guarantee imageUrls is always an empty array (images sourced elsewhere)
        parsed.imageUrls = [];

        // ── Guarantee arrays exist even if AI omitted them
        const arrayFields = [
          'keyFacts', 'classification', 'clinicalFeatures',
          'investigations', 'management', 'quickTable',
          'differentialDiagnosis', 'complications', 'clarifyTopics',
          'keyPoints', 'stepByStep', 'relatedConcepts'
        ];
        for (const f of arrayFields) {
          if (!Array.isArray(parsed[f])) parsed[f] = [];
        }

        // ── Guarantee string fields exist
        const stringFields = [
          'title', 'domain', 'oneLiner', 'overview', 'mechanism',
          'mustKnow', 'mnemonic', 'watchOut', 'examTip',
          'youtubeSearch', 'deepExplanation', 'example'
        ];
        for (const f of stringFields) {
          if (typeof parsed[f] !== 'string') parsed[f] = '';
        }

        return res.status(200).json({
          ...parsed,
          brain: brain.name,
          topic: topic,
          clarify: clarify || null
        });

      } catch (e) {
        lastError = brain.name + ': ' + e.message;
        continue;
      }
    }

    return res.status(500).json({
      error: 'All brains failed. Last error: ' + lastError
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
