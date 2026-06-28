export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'No topic provided' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not found' });

    // ── STEP 1: Get AI explanation + key points + image prompts
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://the-mighty-scorpion.vercel.app',
        'X-Title': 'Scorpion AI Study Mode'
      },
      body: JSON.stringify({
        model: 'google/gemma-4-31b-it:free',
        messages: [
          {
            role: 'system',
            content: `You are Scorpion, a super intelligent study assistant. 
When given a topic, respond ONLY with a valid JSON object in this exact format:
{
  "title": "topic title",
  "explanation": "clear 3-4 sentence explanation a student can understand",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "imagePrompts": ["detailed image prompt 1", "detailed image prompt 2", "detailed image prompt 3"],
  "funFact": "one amazing fun fact about this topic",
  "youtubeSearch": "best youtube search query for learning this topic"
}
Do not include any text outside the JSON.`
          },
          {
            role: 'user',
            content: 'Study topic: ' + topic
          }
        ]
      })
    });

    const aiText = await aiResponse.text();
    let aiData;
    try { aiData = JSON.parse(aiText); } 
    catch(e) { return res.status(500).json({ error: 'AI parse error: ' + aiText.slice(0,200) }); }

    if (aiData.error) return res.status(500).json({ error: aiData.error.message || JSON.stringify(aiData.error) });

    let studyContent;
    try {
      const raw = aiData.choices[0].message.content;
      // strip markdown code fences if present
      const cleaned = raw.replace(/```json/g,'').replace(/```/g,'').trim();
      studyContent = JSON.parse(cleaned);
    } catch(e) {
      return res.status(500).json({ error: 'Could not parse study content' });
    }

    // ── STEP 2: Build image URLs from Pollinations (no key needed)
    const imageUrls = studyContent.imagePrompts.map(prompt =>
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ', educational, detailed, high quality')}?width=400&height=300&nologo=true`
    );

    // ── STEP 3: Build Wikipedia summary URL
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
    let wikiSummary = null;
    try {
      const wikiRes = await fetch(wikiUrl);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        wikiSummary = wikiData.extract ? wikiData.extract.slice(0, 300) : null;
      }
    } catch(e) {}

    return res.status(200).json({
      title: studyContent.title,
      explanation: studyContent.explanation,
      keyPoints: studyContent.keyPoints,
      imageUrls: imageUrls,
      funFact: studyContent.funFact,
      youtubeSearch: studyContent.youtubeSearch,
      wikiSummary: wikiSummary
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
