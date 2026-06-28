// ============================================================
// IMAGE GENERATION API HANDLER v3.0
// ============================================================
// Brain roster (tries each in order until one works):
//   1. HuggingFace FLUX.1-schnell — best quality, free key
//   2. HuggingFace FLUX.1-dev     — alternative FLUX model
//   3. HuggingFace SDXL           — Stable Diffusion XL
//   4. Gemini image generation    — if key available
//   5. Lexica.art                 — free image search, no key
//   6. Pollinations.ai Flux       — free, no key
//   7. Pollinations.ai default    — free, no key
//   8. SVG fallback               — always works, no network
//
// Environment Variables:
//   HF_API_KEY     — HuggingFace token (free at huggingface.co)
//   GEMINI_API_KEY — optional fallback
//
// Author  : Dr. Davie Mwangi
// Version : 3.0.0
// ============================================================

const HF_TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function huggingFaceImage(prompt, model, apiKey) {
  const enhancedPrompt = `${prompt}, educational diagram, high quality, professional, detailed, clean background, clearly labeled`;
  const res = await fetchWithTimeout(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Wait-For-Model': 'true'
      },
      body: JSON.stringify({
        inputs: enhancedPrompt,
        parameters: {
          width: 640,
          height: 480,
          num_inference_steps: 4,
          guidance_scale: 0.0
        }
      })
    },
    HF_TIMEOUT_MS
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HF ${model} error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    const body = await res.text();
    throw new Error(`HF ${model} returned non-image: ${body.slice(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 2000) throw new Error(`HF ${model} returned tiny file`);
  return { buffer: Buffer.from(buffer), contentType };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const prompt = req.query.prompt || 'educational diagram';
  const hfKey  = process.env.HF_API_KEY;
  const gemKey = process.env.GEMINI_API_KEY;

  // ── 1. HUGGINGFACE FLUX.1-schnell ────────────────────────
  if (hfKey) {
    try {
      console.log('Trying HF FLUX.1-schnell…');
      const { buffer, contentType } = await huggingFaceImage(
        prompt, 'black-forest-labs/FLUX.1-schnell', hfKey
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buffer);
    } catch (e) { console.warn('FLUX.1-schnell failed:', e.message); }

    // ── 2. HUGGINGFACE FLUX.1-dev ──────────────────────────
    try {
      console.log('Trying HF FLUX.1-dev…');
      const { buffer, contentType } = await huggingFaceImage(
        prompt, 'black-forest-labs/FLUX.1-dev', hfKey
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buffer);
    } catch (e) { console.warn('FLUX.1-dev failed:', e.message); }

    // ── 3. HUGGINGFACE SDXL ────────────────────────────────
    try {
      console.log('Trying HF SDXL…');
      const { buffer, contentType } = await huggingFaceImage(
        prompt, 'stabilityai/stable-diffusion-xl-base-1.0', hfKey
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buffer);
    } catch (e) { console.warn('SDXL failed:', e.message); }
  }

  // ── 4. GEMINI IMAGE ───────────────────────────────────────
  if (gemKey) {
    try {
      console.log('Trying Gemini image…');
      const response = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${gemKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Educational diagram: ${prompt}. Clean, labeled, professional.` }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
          })
        },
        15000
      );
      const data = await response.json();
      if (data.error?.status === 'RESOURCE_EXHAUSTED') throw new Error('Gemini quota exceeded');
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
      if (imgPart) {
        const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
        res.setHeader('Content-Type', imgPart.inlineData.mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(buffer);
      }
    } catch (e) { console.warn('Gemini image failed:', e.message); }
  }

  // ── 5. LEXICA.ART ─────────────────────────────────────────
  try {
    console.log('Trying Lexica.art…');
    const searchRes = await fetchWithTimeout(
      `https://lexica.art/api/v1/search?q=${encodeURIComponent(prompt + ' diagram educational illustration')}`,
      {}, 8000
    );
    const searchData = await searchRes.json();
    const images = searchData?.images || [];
    const best = images.find(img => img.width >= 512) || images[0];
    if (best?.src) {
      const imgRes = await fetchWithTimeout(best.src, {}, 10000);
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        if (buffer.byteLength > 1000) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.status(200).send(Buffer.from(buffer));
        }
      }
    }
  } catch (e) { console.warn('Lexica failed:', e.message); }

  // ── 6. POLLINATIONS FLUX ──────────────────────────────────
  try {
    console.log('Trying Pollinations Flux…');
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      prompt + ', educational, professional, detailed, high quality, clean background, labeled diagram'
    )}?model=flux&width=640&height=480&nologo=true&seed=${Date.now()}`;
    const imgRes = await fetchWithTimeout(url, {}, 15000);
    if (imgRes.ok) {
      const buffer = await imgRes.arrayBuffer();
      if (buffer.byteLength > 1000) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(Buffer.from(buffer));
      }
    }
  } catch (e) { console.warn('Pollinations Flux failed:', e.message); }

  // ── 7. POLLINATIONS DEFAULT ───────────────────────────────
  try {
    console.log('Trying Pollinations default…');
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      prompt + ', educational diagram, professional'
    )}?width=640&height=480&nologo=true`;
    const imgRes = await fetchWithTimeout(url, {}, 15000);
    if (imgRes.ok) {
      const buffer = await imgRes.arrayBuffer();
      if (buffer.byteLength > 1000) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(Buffer.from(buffer));
      }
    }
  } catch (e) { console.warn('Pollinations default failed:', e.message); }

  // ── 8. SVG FALLBACK (always works) ───────────────────────
  console.warn('All image sources failed — serving SVG fallback');
  const label = prompt.split(' ').slice(0, 3).join(' ').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
    <rect width="640" height="480" fill="#000d05"/>
    <rect x="20" y="20" width="600" height="440" rx="8" fill="none" stroke="#00ff66" stroke-width="1.5" opacity="0.4"/>
    <text x="320" y="55" text-anchor="middle" font-family="monospace" font-size="15" fill="#00ff66" opacity="0.9" font-weight="bold">SCORPION AI // DIAGRAM</text>
    <text x="320" y="76" text-anchor="middle" font-family="monospace" font-size="10" fill="#00cc55" opacity="0.6">${prompt.slice(0, 70)}</text>
    <line x1="60" y1="88" x2="580" y2="88" stroke="#00ff66" stroke-width="0.5" opacity="0.2"/>
    <circle cx="320" cy="240" r="70" fill="rgba(0,255,102,0.07)" stroke="#00ff66" stroke-width="1.5"/>
    <text x="320" y="235" text-anchor="middle" font-family="monospace" font-size="11" fill="#00ff66">${label}</text>
    <text x="320" y="255" text-anchor="middle" font-family="monospace" font-size="9" fill="#00cc55">CORE SYSTEM</text>
    <ellipse cx="320" cy="130" rx="60" ry="28" fill="rgba(0,255,102,0.05)" stroke="#00ff66" stroke-width="1" opacity="0.8"/>
    <text x="320" y="135" text-anchor="middle" font-family="monospace" font-size="9" fill="#00ff66">INPUT</text>
    <line x1="320" y1="158" x2="320" y2="170" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <ellipse cx="140" cy="240" rx="60" ry="28" fill="rgba(0,255,102,0.05)" stroke="#00ff66" stroke-width="1" opacity="0.8"/>
    <text x="140" y="245" text-anchor="middle" font-family="monospace" font-size="9" fill="#00ff66">PROCESS</text>
    <line x1="200" y1="240" x2="250" y2="240" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <ellipse cx="500" cy="240" rx="60" ry="28" fill="rgba(0,255,102,0.05)" stroke="#00ff66" stroke-width="1" opacity="0.8"/>
    <text x="500" y="245" text-anchor="middle" font-family="monospace" font-size="9" fill="#00ff66">ANALYSE</text>
    <line x1="390" y1="240" x2="440" y2="240" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <ellipse cx="320" cy="355" rx="60" ry="28" fill="rgba(0,255,102,0.05)" stroke="#00ff66" stroke-width="1" opacity="0.8"/>
    <text x="320" y="360" text-anchor="middle" font-family="monospace" font-size="9" fill="#00ff66">OUTPUT</text>
    <line x1="320" y1="310" x2="320" y2="327" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <path d="M40 40 L60 40 L60 60" fill="none" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <path d="M600 40 L580 40 L580 60" fill="none" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <path d="M40 440 L60 440 L60 420" fill="none" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <path d="M600 440 L580 440 L580 420" fill="none" stroke="#00ff66" stroke-width="1" opacity="0.5"/>
    <text x="320" y="465" text-anchor="middle" font-family="monospace" font-size="8" fill="#1a4a2a">ADD HF_API_KEY FOR FLUX.1 IMAGE GENERATION // huggingface.co</text>
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(svg);
}
