// ═══════════════════════════════════════════════════════════════════
//  SCORPION AI — YOUTUBE.JS  //  YouTube Search API
//  Vercel Serverless Function  →  /api/youtube
//  Uses YouTube Data API v3 — key stored in Vercel env vars
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { query } = req.body;
    if (!query || !query.trim())
      return res.status(400).json({ error: 'No search query provided' });
    const key = process.env.YOUTUBE_API_KEY;
    if (!key)
      return res.status(500).json({ error: 'YouTube API key not configured' });
    const url = `https://www.googleapis.com/youtube/v3/search?` +
      `part=snippet` +
      `&q=${encodeURIComponent(query)}` +
      `&type=video` +
      `&maxResults=10` +
      `&videoCategoryId=10` +
      `&key=${key}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error)
      return res.status(500).json({ error: data.error.message });
    if (!data.items || data.items.length === 0)
      return res.status(200).json({ results: [] });
    const results = data.items.map(item => ({
      videoId:   item.id.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || '',
    }));
    return res.status(200).json({ results });
  } catch (err) {
    console.error('[youtube.js] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
