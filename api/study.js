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

    const systemPrompt = `You are SCORPION, a genius Jarvis-style professor AI. When given a topic to study, you first classify the subject domain (medicine/biology, history, physics, chemistry, computer science, mathematics, law, literature, economics, geography, etc.) then build a study module perfectly suited for that domain.

You must respond ONLY with a valid JSON object — no text outside it, no markdown fences.

For a STANDARD study topic, return:
{
  "title": "exact topic name",
  "domain": "subject domain",
  "brain": "model used",
  "oneLiner": "one crisp sentence definition",
  "keyFacts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"],
  "mustKnow": "the single most important thing to understand",
  "mnemonic": "memory trick if applicable, else null",
  "watchOut": "common mistake or misconception",
  "examTip": "exam or practical tip",
  "funFact": "surprising fact",
  "quickTable": [{"label": "key", "value": "value"}, ...],
  "imagePrompts": ["specific image prompt 1", "specific image prompt 2"],
  "flashcards": [{"q": "question", "a": "answer"}, {"q": "...", "a": "..."}],
  "quiz": [
    {"q": "question", "options": ["A", "B", "C", "D"], "answer": 0, "explanation": "why A is correct"},
    {"q": "...", "options": [...], "answer": 1, "explanation": "..."}
  ],
  "faqs": [{"q": "common question", "a": "clear answer"}],
  "clarifyTopics": ["subtopic 1", "subtopic 2", "subtopic 3"],
  "youtubeSearch": "best youtube search query for this topic"
}

For a DEEP DIVE (clarify mode), return:
{
  "title": "subtopic name",
  "deepExplanation": "thorough paragraph explanation",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "example": "real world example or clinical case",
  "mnemonic": "memory trick",
  "imagePrompts": ["specific image prompt"],
  "relatedConcepts": ["related1", "related2", "related3"],
  "youtubeSearch": "youtube search for subtopic"
}`;

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
              { role: 'user', content: `Study topic: ${studyTopic}` }
            ],
            temperature: 0.7,
            max_tokens: 3000
          })
        });

        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { lastError = 'Bad JSON from ' + brain.name; continue; }
        if (data.error) { lastError = data.error.message || JSON.stringify(data.error); continue; }

        const raw = data?.choices?.[0]?.message?.content;
        if (!raw) { lastError = 'Empty from ' + brain.name; continue; }

        // clean and parse
        const cleaned = raw.replace(/```json/g,'').replace(/```/g,'').trim();
        let studyData;
        try { studyData = JSON.parse(cleaned); } catch(e) {
          // try to extract JSON from response
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (match) {
            try { studyData = JSON.parse(match[0]); } catch(e2) { lastError = 'JSON parse fail'; continue; }
          } else { lastError = 'No JSON found'; continue; }
        }

        studyData.brain = brain.name;

        // build image URLs from prompts
        if (studyData.imagePrompts && studyData.imagePrompts.length) {
          studyData.imageUrls = studyData.imagePrompts.map(p =>
            `/api/image?prompt=${encodeURIComponent(p)}`
          );
        }

        return res.status(200).json(studyData);

      } catch(e) {
        lastError = brain.name + ': ' + e.message;
        continue;
      }
    }

    return res.status(500).json({ error: 'All brains failed: ' + lastError });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
