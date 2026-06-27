export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const clean = encodeURIComponent(text.slice(0, 200));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${clean}&tl=en&client=tw-ob`;

    const audioResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
        'Accept': '*/*'
      }
    });

    if (!audioResponse.ok) {
      return res.status(500).json({ 
        error: 'Google TTS HTTP error: ' + audioResponse.status,
        statusText: audioResponse.statusText
      });
    }

    const contentType = audioResponse.headers.get('content-type');
    if (!contentType || !contentType.includes('audio')) {
      const body = await audioResponse.text();
      return res.status(500).json({ 
        error: 'Not audio. Content-Type: ' + contentType,
        body: body.slice(0, 200)
      });
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.status(200).send(Buffer.from(audioBuffer));

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
