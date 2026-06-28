// ============================================================
// IMAGE GENERATION API HANDLER
// ============================================================
// Description : Generates educational diagrams and illustrations
//               using AI image generation models.
//
// Primary     : Google Gemini 2.0 Flash (Image Generation)
//               Model: gemini-2.0-flash-preview-image-generation
//
// Fallback    : Pollinations.ai (Free AI Image Generation)
//               URL : https://image.pollinations.ai
//
// Method      : GET
// Query Param : ?prompt=your+image+description
//
// Response    : Raw image binary (image/jpeg or image/png)
// Cache       : 24 hours (public, max-age=86400)
// CORS        : Enabled (all origins)
//
// Environment Variables Required:
//               GEMINI_API_KEY — Google Gemini API key (optional)
//                                Falls back to Pollinations if absent
//
// Author      : Dr. Davie Mwangi
// Version     : 1.0.0
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const prompt = req.query.prompt || 'educational diagram';
  const apiKey = process.env.GEMINI_API_KEY;

  // ── PRIMARY: Gemini 2.0 Flash Image Generation ───────────
  if (apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Create a high quality educational diagram or illustration: ${prompt}. Professional, clean, clearly labeled, suitable for studying.`
              }]
            }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT']
            }
          })
        }
      );
      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

      if (imgPart) {
        const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
        res.setHeader('Content-Type', imgPart.inlineData.mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(buffer);
      }
    } catch (e) {
      console.error('Gemini image failed:', e.message);
    }
  }

  // ── FALLBACK: Pollinations.ai ─────────────────────────────
  try {
    const pollinationsUrl =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(
        prompt + ', educational, professional, detailed, high quality, clean white background, labeled diagram'
      )}?width=600&height=420&nologo=true`;

    const imgRes = await fetch(pollinationsUrl);
    if (!imgRes.ok) throw new Error('Pollinations failed');

    const buffer = await imgRes.arrayBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(Buffer.from(buffer));

  } catch (e) {
    return res.status(500).json({ error: 'Image generation failed: ' + e.message });
  }
}
