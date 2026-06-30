// ============================================================
// CHAT API HANDLER — SCORPION AI BRAIN v5.5.0
// ============================================================
// v5.5.0 Fixes (THIS VERSION):
//   - extract_play_query (both the standalone mode AND the inline
//     version used in the isPlayRequest path) now REFUSES to output
//     a vague/descriptive searchQuery (e.g. "movie about bullied
//     math genius", "guy who is bullied math genius"). It must
//     commit to a real, specific, identifiable title/speaker/event,
//     or explicitly say it doesn't know — in which case the frontend
//     should ask the user to clarify rather than blindly searching
//     YouTube with a vague phrase and grabbing result[0].
//   - Added a "status":"unknown" output option so the frontend can
//     distinguish "I genuinely don't know which video" from "here is
//     exactly one match" — previously every uncertain case silently
//     fell back to the original vague query, which is how wrong
//     videos (Michael Jackson short, 2008 Obama clip, etc.) ended up
//     auto-playing.
//   - extract_play_query system prompts now explicitly forbid
//     guessing a plausible-sounding but unverified title.
//
// v5.4.0 Fixes:
//   - YouTube search now runs for EVERY chat query, not just ones
//     classified as isMusic.
//   - Added an INSTRUCTION line to 'general'/'news' role prompts so
//     the model surfaces relevant YouTube finds.
//
// v5.3.0 Fixes:
//   - Added youtubeSearch() helper validating real YouTube results
//     during the play research phase.
//   - play requests get a [YOUTUBE SEARCH RESULTS] block.
//   - extract_play_query references REAL video data.
//
// v5.2.0 Fixes:
//   - isListRequest detection + bullet-preserving sanitizeReply.
//
// Author  : Dr. Davie Mwangi
// Version : 5.5.0
// ============================================================

const readMemory  = async () => '';
const writeMemory = async () => {};
const wipeMemory  = async () => true;

export default async function handler(req, res) {
  console.log('[chat.js] Handler started');

  // ── CORS ────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-scorpion-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── AUTH ─────────────────────────────────────────────────
  const SECRET = process.env.APP_SECRET;
  if (SECRET && req.headers['x-scorpion-key'] !== SECRET) {
    console.warn('[chat.js] Auth failed: wrong or missing token');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── ENV DEBUG ────────────────────────────────────────────
  console.log('[chat.js] Environment check:', {
    hasSecret:   !!process.env.APP_SECRET,
    hasCerebras: !!process.env.CEREBRAS_API_KEY,
    hasGroq:     !!process.env.GROQ_API_KEY,
    hasGemini:   !!process.env.GEMINI_API_KEY,
    hasMistral:  !!process.env.MISTRAL_API_KEY,
    hasSerper:   !!process.env.SERPER_API_KEY,
    hasTavily:   !!process.env.TAVILY_API_KEY,
  });

  try {
    const { messages, mode, timezone, query, clarificationAnswer, originalQuery } = req.body;

    // ── HISTORY CONTEXT HELPER (shared by resolve_video / resolve_song / resolve_intent) ──
    function buildHistoryContext(msgs) {
      return (msgs || []).slice(-6).map(m =>
        (m.role === 'user' ? 'USER: ' : 'SCORPION: ') + (m.text || m.content || '')
      ).join('\n');
    }

    // ── TIME CONTEXT ─────────────────────────────────────
    const now = new Date();
    const tz  = timezone || 'Africa/Nairobi';
    const timeStr = now.toLocaleString('en-US', {
      timeZone: tz, weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
    const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    const partOfDay   = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
    const todayStr    = now.toISOString().slice(0, 10);
    const yesterday   = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const currentYear  = now.getFullYear();
    const currentMonth = now.toLocaleString('en-US', { month: 'long' });

    // ── FETCH TIMESTAMP HELPER ────────────────────────────
    function fetchTimestamp() {
      return new Date().toLocaleString('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
    }

    // ── BRAIN HELPERS ─────────────────────────────────────
    async function callCerebras(systemContent, userContent, maxTokens = 200) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) { console.warn('[chat.js] CEREBRAS_API_KEY not set'); return null; }
      try {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'llama3.1-8b', temperature: 0, max_tokens: maxTokens,
            messages: [{ role: 'system', content: systemContent }, { role: 'user', content: userContent }]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) { console.error('[chat.js] Cerebras call failed:', e.message); return null; }
    }

    async function callGroq(systemContent, userContent, maxTokens = 300) {
      const key = process.env.GROQ_API_KEY;
      if (!key) { console.warn('[chat.js] GROQ_API_KEY not set'); return null; }
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile', temperature: 0, max_tokens: maxTokens,
            messages: [{ role: 'system', content: systemContent }, { role: 'user', content: userContent }]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) { console.error('[chat.js] Groq call failed:', e.message); return null; }
    }

    async function callAnyBrain(system, user, maxTokens = 300) {
      return (await callCerebras(system, user, maxTokens)) ||
             (await callGroq(system, user, maxTokens)) || null;
    }

    // ── SSE STREAMING HELPERS ─────────────────────────────
    function startStream() {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    function writeChunk(type, content, extra = {}) {
      const payload = JSON.stringify({ type, content, ...extra });
      res.write('data: ' + payload + '\n\n');
    }

    function endStream() {
      res.write('data: [DONE]\n\n');
      res.end();
    }

    // ── URL CONTENT FETCHER ───────────────────────────────
    async function fetchPageContent(url) {
      try {
        const blocked = ['wsj.com','ft.com','bloomberg.com','nytimes.com','economist.com','washingtonpost.com','thetimes.co.uk'];
        if (blocked.some(d => url.includes(d))) return null;
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept': 'text/html' } });
        clearTimeout(timeout);
        if (!r.ok) return null;
        const html = await r.text();
        let text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<header[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '').replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ').trim();
        return text.length > 200 ? text.slice(0, 2000) : null;
      } catch (e) { return null; }
    }

    // ── SEARCH HELPERS ────────────────────────────────────
    async function serperSearch(q, isNews) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const body = { q, num: 8, gl: 'us', hl: 'en' };
        if (isNews) body.tbs = 'qdr:d';
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        let results = '';
        if (data.answerBox)      results += 'DIRECT ANSWER: ' + (data.answerBox.answer || data.answerBox.snippet || data.answerBox.title || '') + '\n\n';
        if (data.knowledgeGraph) results += 'KNOWLEDGE: ' + (data.knowledgeGraph.title || '') + ' — ' + (data.knowledgeGraph.description || '') + '\n\n';
        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 6).forEach((r, i) => {
            results += '[' + (i+1) + '] ' + r.title + '\n' + r.snippet + '\nSource: ' + r.link + '\n\n';
          });
          const urls     = data.organic.slice(0, 5).map(r => r.link).filter(Boolean);
          const contents = await Promise.all(urls.map(url => fetchPageContent(url)));
          const full     = contents.map((c, i) => c ? 'FULL ARTICLE [' + (i+1) + '] from ' + urls[i] + ':\n' + c : null).filter(Boolean);
          if (full.length) results += '\nFULL ARTICLE CONTENT:\n' + full.join('\n\n---\n\n');
        }
        return results.trim() || null;
      } catch (e) { return null; }
    }

    async function tavilySearch(q) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query: q, search_depth: 'advanced', max_results: 6, include_answer: true, include_raw_content: true })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results.map((r, i) => '[' + (i+1) + '] ' + r.title + '\n' + (r.raw_content || r.content)?.slice(0, 1500)).join('\n\n');
        return data.answer ? 'DIRECT ANSWER: ' + data.answer + '\n\nSOURCES:\n' + snippets : snippets;
      } catch (e) { return null; }
    }

    async function braveSearch(q) {
      const key = process.env.BRAVE_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.search.brave.com/res/v1/news/search?q=' + encodeURIComponent(q) + '&freshness=pd&count=5',
          { headers: { 'Accept': 'application/json', 'X-Subscription-Token': key } });
        const data = await r.json();
        if (!data.results?.length) return null;
        return 'BRAVE NEWS (past 24h):\n' + data.results.map((r, i) =>
          '[' + (i+1) + '] ' + r.title + '\n' + (r.description || '') + '\nAge: ' + (r.age || 'unknown')
        ).join('\n\n');
      } catch (e) { return null; }
    }

    async function newsSearch(q) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const [eRes, hRes] = await Promise.all([
          fetch('https://newsapi.org/v2/everything?q=' + encodeURIComponent(q) + '&sortBy=publishedAt&pageSize=5&language=en&apiKey=' + key),
          fetch('https://newsapi.org/v2/top-headlines?q=' + encodeURIComponent(q) + '&pageSize=3&language=en&apiKey=' + key)
        ]);
        const [e, h] = await Promise.all([eRes.json(), hRes.json()]);
        let result = '';
        if (h.articles?.length) result += 'TOP HEADLINES:\n' + h.articles.slice(0,3).map((a,i) =>
          '[' + (i+1) + '] ' + a.title + '\n' + (a.description||'') + '\nPublished: ' + (a.publishedAt?.slice(0,10)) + '\nSource: ' + a.source?.name
        ).join('\n\n') + '\n\n';
        if (e.articles?.length) result += 'RECENT NEWS:\n' + e.articles.slice(0,5).map((a,i) =>
          '[' + (i+1) + '] ' + a.title + '\n' + (a.description||'') + '\nPublished: ' + (a.publishedAt?.slice(0,10)) + '\nSource: ' + a.source?.name
        ).join('\n\n');
        return result.trim() || null;
      } catch (e) { return null; }
    }

    async function rssSearch() {
      try {
        const feeds = ['https://feeds.bbci.co.uk/news/rss.xml','https://rss.cnn.com/rss/edition.rss','https://feeds.reuters.com/reuters/topNews'];
        const results = await Promise.all(feeds.map(async (url) => {
          try {
            const r    = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const text = await r.text();
            const items      = [...text.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
            const plainItems = [...text.matchAll(/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
            return [...items, ...plainItems].slice(0,3).map(m => '[' + (m[2]?.trim()||'unknown date') + '] ' + (m[1]?.trim()||'')).join('\n');
          } catch (e) { return null; }
        }));
        const combined = results.filter(Boolean).join('\n');
        return combined ? 'RSS LIVE HEADLINES:\n' + combined : null;
      } catch (e) { return null; }
    }

    async function duckSearch(q) {
      try {
        const r    = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1');
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += 'ANSWER: ' + data.AbstractText + '\n\n';
        if (data.RelatedTopics?.length) data.RelatedTopics.slice(0,4).forEach(t => { if (t.Text) result += '- ' + t.Text + '\n'; });
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── CREDIBILITY FILTER ────────────────────────────────
    // Flags channels/titles matching the clickbait-news-farm pattern seen
    // in practice (e.g. "NR 2 STUDIO" reposting fabricated headlines like
    // "Trump Orders Immediate National Lockdown") so they get filtered out
    // before being offered to the user as a real match for play requests.
    const CLICKBAIT_TITLE_PATTERNS = /\b(stuns everyone|urgent (24|breaking)[- ]hour|america in shock|shocking announcement|you won'?t believe|breaking news live now|world stunned|panic erupts|emergency alert|in shock as|national lockdown)\b/i;
    const CLICKBAIT_CHANNEL_PATTERNS = /\b(news\s*live|studio\s*\d|\bnr\s*\d\b|live\s*now\s*\d|breaking\s*now)\b/i;

    function isLowCredibilitySource(video) {
      const title = (video.title || '');
      const channel = (video.channel || '');
      if (CLICKBAIT_TITLE_PATTERNS.test(title)) return true;
      if (CLICKBAIT_CHANNEL_PATTERNS.test(channel)) return true;
      return false;
    }

    // ── YOUTUBE SEARCH VALIDATION ──────────────────────────
    async function youtubeSearch(q) {
      try {
        // FIX: localhost:3000 does NOT work between Vercel serverless
        // function invocations in production — each function call is an
        // isolated instance with nothing listening on localhost. Use the
        // real deployment host instead (Vercel injects VERCEL_URL).
        const base = process.env.VERCEL_URL
          ? 'https://' + process.env.VERCEL_URL
          : (process.env.APP_BASE_URL || 'http://localhost:3000');
        const r = await fetch(base + '/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
          signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) return null;
        const data = await r.json();
        if (!data.results?.length) return null;

        // FIX: drop clickbait/low-credibility channels before they ever
        // reach the model as "VERIFIED" results.
        const filtered = data.results.filter(v => !isLowCredibilitySource(v));
        const pool = filtered.length ? filtered : data.results;

        let result = 'YOUTUBE SEARCH RESULTS (VERIFIED):\n';
        pool.slice(0, 5).forEach((v, i) => {
          result += '[' + (i+1) + '] "' + v.title + '" by ' + v.channel + ' (ID: ' + v.videoId + ')\n';
        });
        return result.trim();
      } catch (e) {
        console.error('[chat.js] youtubeSearch failed:', e.message);
        return null;
      }
    }

    function dedupeBlocks(text) {
      if (!text) return text;
      const blocks = text.split(/\n\n---\n\n|\n\n(?=\[\d+\])/g);
      const seen   = new Set(); const out = [];
      for (const b of blocks) {
        const firstLine = (b.split('\n')[0] || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!firstLine || seen.has(firstLine)) continue;
        seen.add(firstLine); out.push(b);
      }
      return out.join('\n\n---\n\n');
    }

    function hasRecentDateStrict(text, maxAgeDays) {
      if (!text) return false;
      const cutoff      = Date.now() - maxAgeDays * 86400000;
      const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (!dateMatches.length) return false;
      return dateMatches.some(d => { const t = new Date(d).getTime(); return !isNaN(t) && t >= cutoff && t <= Date.now() + 86400000; });
    }

    function isUsable(text) { return !!(text && text.replace(/\s+/g, '').length > 150); }

    async function runSearchChain(plannedQueries, intent) {
      const perQuery = {};
      for (const q of plannedQueries) {
        let combined = '';
        const [serperData, tavilyData] = await Promise.all([serperSearch(q, intent.isNews), tavilySearch(q)]);
        combined = [serperData, tavilyData].filter(Boolean).join('\n\n---\n\n');
        if (!isUsable(combined) && intent.isNews) {
          const [braveData, newsData] = await Promise.all([braveSearch(q), newsSearch(q)]);
          combined = [combined, braveData, newsData].filter(Boolean).join('\n\n---\n\n');
        }
        if (!isUsable(combined) && intent.isNews) {
          const rssData = await rssSearch();
          combined = [combined, rssData].filter(Boolean).join('\n\n---\n\n');
        }
        if (!isUsable(combined)) { const duckData = await duckSearch(q); combined = [combined, duckData].filter(Boolean).join('\n\n---\n\n'); }
        perQuery[q] = dedupeBlocks(combined);
      }
      return Object.values(perQuery).filter(Boolean).join('\n\n---\n\n');
    }

    // ── LIVE DATA HELPERS ─────────────────────────────────
    async function getCrypto(q) {
      const ql = q.toLowerCase();
      const coinMap = { bitcoin:'bitcoin',btc:'bitcoin',ethereum:'ethereum',eth:'ethereum',solana:'solana',sol:'solana',bnb:'binancecoin',dogecoin:'dogecoin',doge:'dogecoin',xrp:'ripple',cardano:'cardano',ada:'cardano' };
      const coin = Object.keys(coinMap).find(k => ql.includes(k));
      if (!coin) return null;
      try {
        const r    = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + coinMap[coin] + '&vs_currencies=usd&include_24hr_change=true');
        const data = await r.json();
        const c    = data[coinMap[coin]];
        if (!c) return null;
        const ts = fetchTimestamp();
        return 'LIVE CRYPTO PRICE:\n' + coin.toUpperCase() + ' = $' + c.usd.toLocaleString() + ' USD\n24h Change: ' + c.usd_24h_change?.toFixed(2) + '%\nFetched at: ' + ts + '\nINSTRUCTION: Always state the fetch time and date in your answer.';
      } catch (e) { return null; }
    }

    async function getMetals(q) {
      if (!q.toLowerCase().match(/gold|silver|xau|xag|platinum|palladium|metal/)) return null;
      try {
        const r    = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        const gold = data.find(m => m.metal === 'gold');
        const silver   = data.find(m => m.metal === 'silver');
        const platinum = data.find(m => m.metal === 'platinum');
        const ts = fetchTimestamp();
        let result = 'LIVE METALS PRICES (per troy ounce, USD):\n';
        if (gold)     result += 'Gold (XAU/USD): $' + gold.price.toFixed(2) + '\n';
        if (silver)   result += 'Silver (XAG/USD): $' + silver.price.toFixed(2) + '\n';
        if (platinum) result += 'Platinum: $' + platinum.price.toFixed(2) + '\n';
        result += 'Fetched at: ' + ts + '\nINSTRUCTION: Always state the fetch time and date in your answer.';
        return result;
      } catch (e) { return null; }
    }

    const SUPPORTED_FOREX_PAIRS = ['EUR','GBP','KES','JPY','CAD','AUD','ZAR','NGN','UGX','TZS','INR','CHF'];
    async function getForex(q) {
      if (!q.toLowerCase().match(/forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound|rate/)) return null;
      try {
        const r    = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates) return null;
        const ts = fetchTimestamp();
        let result = 'LIVE FOREX RATES (vs USD):\n';
        SUPPORTED_FOREX_PAIRS.forEach(p => { if (data.rates[p]) result += 'USD/' + p + ': ' + data.rates[p].toFixed(4) + '\n'; });
        result += 'Fetched at: ' + ts + '\nSUPPORTED PAIRS ONLY: ' + SUPPORTED_FOREX_PAIRS.join(', ');
        result += '\nINSTRUCTION: Always state the fetch time and date. If pair not in list, say "I do not have a live feed for that pair, Sir."';
        return result;
      } catch (e) { return null; }
    }

    async function getWeather(q) {
      if (!q.toLowerCase().match(/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/)) return null;
      let city = 'Nairobi';
      const m1 = q.match(/\b(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\s+currently|\s+now|\s+please|\?|$)/i);
      if (m1) city = m1[1].trim();
      else { const m2 = q.match(/(?:weather|temperature|forecast|rain|sunny|cold|hot)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\?|$)/i); if (m2) city = m2[1].trim(); }
      city = city.replace(/\s+(right|now|today|currently|please)$/gi,'').replace(/\?/g,'').trim() || 'Nairobi';
      try {
        const geoR  = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1');
        const geoD  = await geoR.json();
        if (!geoD.results?.length) return 'WEATHER ERROR: Location "' + city + '" not found.';
        const loc = geoD.results[0];
        const wR  = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto');
        const wD  = await wR.json(); const cur = wD.current;
        const conds = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',51:'Light drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',71:'Slight snow',80:'Rain showers',95:'Thunderstorm' };
        const ts = fetchTimestamp();
        return 'LIVE WEATHER — ' + loc.name + ', ' + loc.country + ':\nTemperature: ' + cur.temperature_2m + 'C (feels like ' + cur.apparent_temperature + 'C)\nCondition: ' + (conds[cur.weather_code]||'Variable') + '\nHumidity: ' + cur.relative_humidity_2m + '%\nWind: ' + cur.wind_speed_10m + ' km/h\nFetched at: ' + ts + '\nINSTRUCTION: Always state the fetch time and date in your answer.';
      } catch (e) { return null; }
    }

    async function getSports(q) {
      if (!q.toLowerCase().match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r    = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today.';
        const ts = fetchTimestamp();
        return 'LIVE SPORTS RESULTS:\n' + data.events.slice(0,6).map(e =>
          e.strHomeTeam + ' ' + (e.intHomeScore??'-') + ' vs ' + (e.intAwayScore??'-') + ' ' + e.strAwayTeam + ' (' + e.strLeague + ')'
        ).join('\n') + '\nFetched at: ' + ts + '\nINSTRUCTION: Report only these matches and state the fetch time.';
      } catch (e) { return null; }
    }

    // ── SANITIZE ──────────────────────────────────────────
    function sanitizeReply(text, listMode) {
      let t = text
        .replace(/\*\*/g,'').replace(/\*/g,'').replace(/#{1,6}\s+/g,'')
        .replace(/`{1,3}[^`]*`{1,3}/g,'');
      if (!listMode) {
        t = t.replace(/^\s*[-•]\s+/gm,'').replace(/^\s*\d+\.\s+/gm,'');
      }
      return t
        .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
        .replace(/\|/g,', ').replace(/\[HIGH CONFIDENCE\]/gi,'').replace(/\[LOW CONFIDENCE\]/gi,'')
        .replace(/\[STALE\]/gi,'').replace(/\[DATE:[^\]]*\]/gi,'').replace(/\[UNKNOWN\]/gi,'')
        .replace(/INSTRUCTION:[^\n]*/gi,'').replace(/===+[^=\n]*===+/g,'')
        .replace(/\n{3,}/g,'\n\n').trim();
    }

    // ── CLASSIFIERS ───────────────────────────────────────
    function classifyQuery(q) {
      const ql = q.toLowerCase();
      const intent = {
        isCrypto:    /bitcoin|btc|ethereum|eth|solana|sol|bnb|dogecoin|doge|xrp|cardano|ada|crypto|coin|blockchain|wallet|exchange/.test(ql),
        isForex:     /forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound|pips|pair/.test(ql),
        isMetals:    /gold|silver|xau|xag|platinum|palladium|metal|commodity|bullion|spot price/.test(ql),
        isWeather:   /weather|temperature|forecast|rain|humid|wind|sunny|cold|hot|celsius|fahrenheit|climate/.test(ql),
        isSports:    /football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal|team|league|tournament/.test(ql),
        isNews:      /news|happened|latest|today|yesterday|this week|breaking|announced|said|reported|now|currently|recent|update|headline/.test(ql),
        isMusic:     /song|artist|musician|track|album|audio|music|listen|hear|reggae|rap|rock|pop|jazz|classical|spotify|soundcloud|youtube music|cover|remix|official audio|lyrics|band|singer|composer|discography/.test(ql),
        isTechnical: /code|python|javascript|api|database|algorithm|function|class|library|framework|syntax|debug|error|compile/.test(ql),
        needsLiveData: false
      };

      intent.primary = Object.keys(intent)
        .filter(k => k !== 'needsLiveData' && k !== 'primary' && intent[k])
        .sort()[0] || 'general';

      intent.needsLiveData = intent.isCrypto || intent.isForex || intent.isMetals || intent.isWeather || intent.isSports ||
        (/\b(current|now|today|live|real[- ]?time|right now)\b/i.test(ql));

      return intent;
    }

    function isListRequest(text) {
      if (!text) return false;
      return /\b(point form|in points|bullet points?|bulleted|as a list|in list form|make notes|key points|in note form|outline (this|it)|summar(y|ize|ise)[\s\S]{0,40}(points|notes|list)|notes on this)\b/i.test(text);
    }

    // ── ROLE-BASED SYSTEM PROMPTS ──────────────────────
    function getRolePrompt(intent, partOfDay, timeStr) {
      const basePersonality = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.
Today is ${timeStr}. It is ${partOfDay}.`;

      const roles = {
        music: `${basePersonality}

You are a music encyclopedia and curator. You know:
- Artist histories, discographies, sample sources
- Production techniques, collaborations, influences
- Album release dates, chart positions, critical reception
- Song meanings, lyrics context, live versions, remixes

INSTRUCTION:
- If YOUTUBE SEARCH RESULTS show verified videos matching the query, ALWAYS offer: "I found [exact title] by [channel]. Would you like me to play it, Sir?"
- Answer follow-ups about artist/song using the YOUTUBE + WEB context already available — no new research needed.
- Be enthusiastic about music. Use era/genre context naturally.`,

        news: `${basePersonality}

You are a news analyst and fact-checker. You:
- Synthesize multiple sources, spot agreements and disagreements
- Flag uncertain claims and outdated information
- Understand publication biases and source reliability
- Trace facts to original reporting

INSTRUCTION:
- ALWAYS state fetch timestamp and source freshness ([HIGH CONFIDENCE] = today/yesterday, [MEDIUM] = 1-7 days, [LOW] = older)
- If sources contradict, explicitly say which source and analyze why (different measurement? old data? bias?)
- Warn: "This is 30+ days old, Sir — may not reflect current status."
- Never state unverified claims as fact.
- If a YOUTUBE SEARCH RESULTS block is present and a listed video is genuinely a real, relevant recording of the event/person/topic discussed (e.g. an actual speech, interview, or news clip — not a random unrelated result), mention it naturally: "I also found footage of this — [exact title] by [channel]. Would you like me to play it, Sir?" Only offer this when it's a real match; never invent or guess a title that isn't in the YOUTUBE SEARCH RESULTS block.`,

        crypto: `${basePersonality}

You are a markets analyst specializing in cryptocurrency. You:
- Read live price feeds and understand volatility
- Explain blockchain fundamentals, wallets, exchanges
- Know major projects and their use cases
- Understand technical analysis basics

CRITICAL: Live crypto data in [LIVE CRYPTO DATA] section is GROUND TRUTH. Do NOT use training knowledge for prices — ONLY cite the live feed with timestamp.

INSTRUCTION:
- Always report prices with [LIVE CRYPTO DATA] timestamp
- If query asks for price but no live data: "I do not have a live feed for that, Sir."
- Provide context (market cap, 24h change) when available
- Admit uncertainty for predictions (price going up/down is speculation).`,

        technical: `${basePersonality}

You are a technical problem-solver and engineer. You:
- Debug code, explain architecture, write pseudocode
- Know multiple languages, frameworks, design patterns
- Understand system performance, scalability, trade-offs
- Write clear, correct examples

INSTRUCTION:
- Be precise. Code examples must be syntactically valid or clearly marked pseudocode.
- Explain *why*, not just how.
- Admit when something is beyond scope or requires specialized knowledge.`,

        general: `${basePersonality}

You are a conversationalist and explainer. You:
- Answer questions clearly and conversationally
- Break complex topics into digestible pieces
- Know when to go deep and when to stay surface-level
- Engage naturally without being robotic

INSTRUCTION:
- If a YOUTUBE SEARCH RESULTS block is present and a listed video is genuinely relevant to the question (a real, on-topic match — not a coincidental keyword hit), you may mention it: "I also found a video on this, [exact title] by [channel]. Would you like me to play it, Sir?" Only do this when it adds real value to your answer — skip it for results that aren't a meaningful match, and never invent a title that isn't actually in the YOUTUBE SEARCH RESULTS block.`
      };

      return roles[intent.primary] || roles.general;
    }

    // ── DATA DISTILLATION ──────────────────────────────
    async function distillWebData(rawData, q) {
      if (!rawData || rawData.length < 300) return rawData;

      const distillSystem = `You are a data analyst. Extract ONLY facts directly answering: "${q}"
Remove: ads, navigation, repetition, tangents, irrelevant sections.
Output: bullet list of key facts, max 600 chars. Be specific (numbers, dates, names).
If nothing relevant, output: NO RELEVANT DATA`;

      const result = await callCerebras(distillSystem, rawData.slice(0, 8000), 200);
      if (!result || result === 'NO RELEVANT DATA') return rawData;
      return result;
    }

    function enhanceQuery(q) {
      const ql = q.toLowerCase();
      if (ql.includes('yesterday'))                              return q + ' ' + yesterdayStr;
      if (ql.includes('this morning') || ql.includes('today'))  return q + ' ' + todayStr;
      if (ql.includes('this week'))                             return q + ' ' + currentMonth + ' ' + currentYear;
      if (/latest|recent|now|current|just|happened/.test(ql))   return q + ' ' + currentMonth + ' ' + currentYear;
      return q;
    }

    async function planSearch(q) {
      const result = await callCerebras(
        'You are a search query planner. Today is ' + timeStr + '. Given a user question, output 2-3 specific targeted search queries. Always append current month and year to queries about recent events. Output ONLY a valid JSON array of strings. No explanation, no markdown.',
        q, 200
      );
      if (!result) return [enhanceQuery(q)];
      try {
        const cleaned = result.replace(/```json|```/g,'').trim();
        const queries = JSON.parse(cleaned);
        return Array.isArray(queries) && queries.length > 0 ? queries : [enhanceQuery(q)];
      } catch (e) { return [enhanceQuery(q)]; }
    }

    async function scoreAndFilter(rawData, q) {
      if (!rawData) return rawData;
      const result = await callCerebras(
        'You are a data quality analyst. Today is ' + timeStr + '. Given raw search results and a query: ' +
        '1) Extract only facts that directly answer the query. ' +
        '2) Remove irrelevant content, ads, navigation, repetition. ' +
        '3) Tag each key fact as [HIGH CONFIDENCE] or [LOW CONFIDENCE]. ' +
        '4) Flag dates as [DATE: YYYY-MM-DD]. If no date tag [DATE: UNKNOWN]. ' +
        '5) PENALIZE STALE DATA: facts older than 48 hours get [STALE]. Facts older than 30 days get [VERY STALE]. ' +
        '6) Preserve exact numbers and dates. ' +
        '7) Output clean structured facts only. If nothing relevant output: NO RELEVANT DATA FOUND',
        'QUERY: ' + q + '\n\nRAW DATA:\n' + rawData.slice(0, 10000), 2000
      );
      if (!result || result === 'NO RELEVANT DATA FOUND') return rawData;
      return result;
    }

    function isSimpleCommand(msgs) {
      if (!msgs?.length) return true;
      const last = msgs[msgs.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = ['hello','hi','hey','thanks','thank you','bye','goodbye','how are you','what is your name','who are you','play ','stop','pause'];
      const isVisual = /explain|show me|what is|how does|diagram of|illustrate/.test(text);
      if (isVisual) return false;
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    function isAnalyzeRequest(text) {
      if (!text) return false;
      if (text.length > 400) return true;
      return /\b(analy[sz]e|summar[iz]e|review this|what does this (mean|say)|proofread|critique this)\b/i.test(text);
    }

    // ══════════════════════════════════════════════════════
    // NON-STREAMING MODES
    // ══════════════════════════════════════════════════════

    if (mode === 'wipe_memory') {
      await wipeMemory();
      return res.status(200).json({ success: true, message: 'Memory cleared, Sir.' });
    }

    // ── EXTRACT PLAY QUERY ────────────────────────────────
    // v5.5.0: this now REFUSES to output a vague descriptive query.
    // It must either commit to one real, specific, identifiable title
    // (movie/song/speech name + speaker/artist), or say it doesn't
    // know — never guess a plausible-sounding-but-unverified one.
    if (mode === 'extract_play_query') {
      const rawQuery = (query || '').trim();
      const answer   = (req.body.answer || '').trim();
      if (!rawQuery && !answer) return res.status(200).json({ status: 'clear', searchQuery: '' });

      const extractSystem = `You are a YouTube search query extractor for Scorpion AI. Today is ${timeStr}.
Given the user's original "play" request and a researched answer (which may include ACTUAL YOUTUBE SEARCH RESULTS), decide one of THREE outcomes:

- "clear": exactly ONE specific, real, identifiable video/song/speech/event is meant, AND you can name it precisely (exact or near-exact title, plus speaker/artist/event/date if relevant). NEVER output a vague description like "movie about a bullied math genius" or "guy who gets bullied" as the searchQuery — that is NOT a valid clear result, it is a guess. If you cannot name the actual title, do NOT use "clear".
- "choice": the researched answer itself names 2+ DISTINCT real, specific titles that the user plausibly means.
- "unknown": you cannot confidently identify a specific real title from the request and the researched answer (e.g. the request is just a vague plot description with no title given anywhere in the answer). Do NOT guess in this case.

If the answer contains "YOUTUBE SEARCH RESULTS (VERIFIED):" block, those are REAL YouTube videos — use the titles and channels from that block, never invent your own.

Output ONLY valid JSON. No markdown, no backticks.

If clear:
{"status":"clear","searchQuery":"<exact, specific YouTube search query — a real title, never a vague description>"}

If choice (when answer shows 2+ distinct real candidates):
{"status":"choice","question":"<short spoken question, max 15 words>","options":[{"label":"<video title>","searchQuery":"<precise YouTube search for this result>"}, ...]}

If unknown:
{"status":"unknown","reason":"<one short sentence explaining what extra detail is needed, e.g. 'I don't have a confirmed title — could you name the movie or describe it more specifically?'"}`;
      const userContent = `ORIGINAL REQUEST: ${rawQuery}\n\nRESEARCHED ANSWER:\n${answer.slice(0,2000)}`;
      let raw = await callAnyBrain(extractSystem, userContent, 350);
      let parsed = null;
      try { parsed = JSON.parse((raw || '').replace(/```json|```/g,'').trim()); } catch (e) { parsed = null; }

      if (parsed?.status === 'choice' && Array.isArray(parsed.options) && parsed.options.length >= 2) {
        const cleanOptions = parsed.options
          .filter(o => o && o.label && o.searchQuery)
          .slice(0, 3);
        if (cleanOptions.length >= 2) {
          return res.status(200).json({ status: 'choice', question: parsed.question || 'Which one, Sir?', options: cleanOptions });
        }
      }

      if (parsed?.status === 'unknown') {
        return res.status(200).json({ status: 'unknown', reason: parsed.reason || 'I do not have a confirmed match, Sir. Could you be more specific?' });
      }

      // Guard: even if status was "clear", reject obviously vague/descriptive
      // searchQueries as a last line of defense (a long phrase with no
      // proper-noun-looking tokens is a strong vagueness signal).
      const sq = (parsed && parsed.searchQuery) || '';
      const hasProperNounSignal = /[A-Z][a-z]+/.test(sq);
      if (sq && sq.split(/\s+/).length >= 5 && !hasProperNounSignal) {
        return res.status(200).json({ status: 'unknown', reason: 'I do not have a confirmed title for that, Sir. Could you name it more specifically?' });
      }

      return res.status(200).json({ status: 'clear', searchQuery: sq || rawQuery });
    }

    if (mode === 'greeting') {
      const greetSystem = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
The current date and time is: ${timeStr}. It is ${partOfDay}.
Greet the user warmly like Jarvis greets Tony Stark — address them as Sir.
You MUST explicitly state the current time and date somewhere in the greeting (e.g. "It's 7:21 AM on Tuesday, June 30th, 2026, Sir"), worked naturally into a sentence.
Give a brief, witty, engaging good ${partOfDay} greeting. Keep it to 2-3 sentences.
End with a short, simple, easy-to-answer-with-"yes" question (e.g. asking if they're ready to begin).
NEVER use markdown. Write plain conversational sentences only.`;
      const brains = [
        { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions', model:'llama3.1-8b' },
        { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile' }
      ];
      for (const brain of brains.filter(b => b.key)) {
        try {
          const r    = await fetch(brain.url, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+brain.key}, body:JSON.stringify({ model:brain.model, temperature:0.2, max_tokens:200, messages:[{role:'system',content:greetSystem},{role:'user',content:'greet me'}] }) });
          const data = await r.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) return res.status(200).json({ reply:sanitizeReply(reply, false), brain:brain.name });
        } catch (e) {}
      }
      return res.status(200).json({ reply:'Good ' + partOfDay + ' Sir. Scorpion online and ready.', brain:'FALLBACK' });
    }

    // ══════════════════════════════════════════════════════
    // MAIN CHAT — STREAMING PIPELINE
    // ══════════════════════════════════════════════════════
    startStream();

    const userMessages      = messages || [{ role:'user', text:'hello' }];
    const lastMsg           = userMessages[userMessages.length - 1];
    const userQuery         = lastMsg?.text || lastMsg?.content || '';
    const formattedMessages = userMessages.map(m => ({ role:m.role==='assistant'?'assistant':'user', content:m.text||m.content||'' }));

    if (/\b(forget everything|clear your memory|wipe your memory|reset memory)\b/i.test(userQuery)) {
      await wipeMemory();
      writeChunk('answer', 'Memory cleared Sir. Starting fresh.', { brain:'SCORPION' });
      endStream();
      return;
    }

    const analyzeMode = isAnalyzeRequest(userQuery);
    const listMode = isListRequest(userQuery);

    // ── DETECT PLAY REQUEST ───────────────────────────────
    const isPlayRequest = /^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s+.+/i.test(userQuery);

    if (!isSimpleCommand(userMessages) && !analyzeMode && !isPlayRequest) {
      const reasoningSystem = `You are the reasoning layer of Scorpion AI. Today is ${timeStr}.
In ONE sentence only, state: what the user is asking for AND what data source or action is needed.
Be specific. Examples:
- "XAU/USD price — requires live metals spot feed."
- "Where Ruto was yesterday — requires news search for ${yesterdayStr}."
- "Bitcoin 24h change — requires live crypto feed from CoinGecko."
- "Explain photosynthesis — requires general knowledge, no live data needed."
Output ONLY that one sentence. No preamble, no extra text.`;
      const reasoningSentence = await callCerebras(reasoningSystem, userQuery, 80);
      if (reasoningSentence) writeChunk('thinking', reasoningSentence.trim());

      const intent = classifyQuery(userQuery);
      writeChunk('searching', 'Planning search strategy...');
      const plannedQueries = await planSearch(userQuery);
      writeChunk('searching', 'Running ' + plannedQueries.length + ' search queries: ' + plannedQueries.join(' / '));

      writeChunk('fetching', 'Fetching live data and web results...');

      const [rawWebData, cryptoData, metalData, forexData, weatherData, sportsData, youtubeData] = await Promise.all([
        runSearchChain(plannedQueries, intent),
        getCrypto(userQuery),
        getMetals(userQuery),
        getForex(userQuery),
        getWeather(userQuery),
        getSports(userQuery),
        youtubeSearch(userQuery)
      ]);

      if (cryptoData)  writeChunk('fetching', 'Live crypto data received — ' + fetchTimestamp());
      if (metalData)   writeChunk('fetching', 'Live metals data received — ' + fetchTimestamp());
      if (forexData)   writeChunk('fetching', 'Live forex rates received — ' + fetchTimestamp());
      if (weatherData) writeChunk('fetching', 'Live weather data received — ' + fetchTimestamp());
      if (sportsData)  writeChunk('fetching', 'Live sports data received — ' + fetchTimestamp());
      if (youtubeData) writeChunk('fetching', 'YouTube search complete — ' + fetchTimestamp());
      if (rawWebData)  writeChunk('fetching', 'Web search complete — ' + fetchTimestamp());

      writeChunk('scoring', 'Analysing and scoring sources for confidence...');

      let filteredWebData = null;
      if (rawWebData) filteredWebData = await scoreAndFilter(rawWebData, userQuery);

      if (filteredWebData && filteredWebData.length > 2000) {
        writeChunk('fetching', 'Condensing data to key facts...');
        filteredWebData = await distillWebData(filteredWebData, userQuery);
      }

      if (filteredWebData && intent.isNews) {
        const tightWindow = /\btoday\b|\bthis morning\b|\bright now\b|\bcurrently\b/i.test(userQuery);
        const maxAge = tightWindow ? 5 : 30;
        if (!hasRecentDateStrict(filteredWebData, maxAge)) {
          filteredWebData += '\n\nDATE WARNING: No source confirmed within the last ' + maxAge + ' days. Treat all news claims as potentially stale.';
        }
      }

      if (!filteredWebData) {
        filteredWebData = 'NO LIVE SEARCH DATA AVAILABLE.\nINSTRUCTION: Do not invent a definitive current answer. Tell the user you do not have a live feed for this right now.';
      }

      let webContext = ''; let dataSource = ''; let gaps = [];

      if (filteredWebData) { webContext += '=== WEB SEARCH (confidence-scored) ===\n' + filteredWebData + '\n\n'; dataSource = 'WEB[' + plannedQueries.length + 'q]'; }
      if (youtubeData)  { webContext += '=== YOUTUBE SEARCH RESULTS ===\n' + youtubeData + '\n\n'; dataSource += '+YOUTUBE'; }
      if (cryptoData)  { webContext += '=== LIVE CRYPTO DATA ===\n'   + cryptoData  + '\n\n'; dataSource += '+CRYPTO';  }
      if (metalData)   { webContext += '=== LIVE METALS DATA ===\n'   + metalData   + '\n\n'; dataSource += '+METALS';  }
      if (forexData)   { webContext += '=== LIVE FOREX DATA ===\n'    + forexData   + '\n\n'; dataSource += '+FOREX';   }
      if (weatherData) { webContext += '=== LIVE WEATHER DATA ===\n'  + weatherData + '\n\n'; dataSource += '+WEATHER'; }
      if (sportsData)  { webContext += '=== LIVE SPORTS DATA ===\n'   + sportsData  + '\n\n'; dataSource += '+SPORTS';  }

      if (intent.isCrypto  && !cryptoData)  gaps.push('CRYPTO GAP: No live crypto data. Do NOT use training knowledge for any price.');
      if (intent.isMetals  && !metalData)   gaps.push('METALS GAP: No live metals data. Do NOT estimate any metal price.');
      if (intent.isForex   && !forexData)   gaps.push('FOREX GAP: No live forex data. Do NOT estimate any exchange rate.');
      if (intent.isWeather && !weatherData) gaps.push('WEATHER GAP: Do NOT guess weather conditions.');
      if (gaps.length) webContext += '=== DATA GAP WARNINGS ===\n' + gaps.join('\n') + '\n\n';

      const formatRule = listMode ? `OUTPUT FORMAT RULES:
- The user wants point-form / list output. Write your answer as short points, one per line, each starting with "- ".
- Keep each point concise and scannable.
- No bold, no headers, no numbered lists — only "- " bullets.
- Address the user as Sir.
- Always state the exact fetch time and date when reporting live data.` : `CRITICAL OUTPUT FORMAT RULES:
- Write in plain conversational sentences only.
- NEVER use markdown: no asterisks, no bold, no headers, no bullet points, no numbered lists, no backticks.
- Your output will be read aloud by a text-to-speech engine.
- Address the user as Sir.
- Always state the exact fetch time and date when reporting live data.`;

      const rolePrompt = getRolePrompt(intent, partOfDay, timeStr);

      const systemPrompt = `${rolePrompt}

${formatRule}

CONFIDENCE SELF-RATING (critical):
Before answering, rate yourself [CONFIDENT] / [LIKELY] / [UNCERTAIN] / [GUESSING]:
- [CONFIDENT] = data directly answers query, sources agree, info is recent/verified
- [LIKELY] = data mostly answers, some minor uncertainty or source disagreement
- [UNCERTAIN] = partial data, sources disagree, or data is older
- [GUESSING] = no direct data, using training knowledge only

Start your answer with [CONFIDENCE LEVEL] then the answer. Example: "[CONFIDENT] Bitcoin is currently $45,230 USD..."

CONTRADICTION RESOLUTION:
If sources disagree on same fact, analyze why:
1) Is one source outdated? (check timestamps)
2) Do they measure different things?
3) Is one source more reliable?
4) Could both be partially true?
Mention this analysis in your answer.

EXAMPLE ANSWERS:

MUSIC:
Query: "Tell me about reggae in the 70s"
Good: "[CONFIDENT] Reggae in the 1970s was revolutionized by Bob Marley and the Wailers, who released 'Exodus' in 1977... I found several albums on YouTube. Would you like me to play one, Sir?"

NEWS:
Query: "What happened in tech today"
Good: "[CONFIDENT] OpenAI announced GPT-5 this morning [TechCrunch, fetched 6:45 AM]. [LIKELY] Reports suggest $10B funding, but unconfirmed [source disagreement noted]."

CRYPTO:
Query: "Bitcoin price now"
Good: "[CONFIDENT] Bitcoin = $45,230 USD, up 3.2% in 24h. [LIVE CRYPTO DATA fetched 10:15 AM GMT+3]"

TECHNICAL:
Query: "Sort array in Python"
Good: "[CONFIDENT] Use sorted(): sorted([3,1,2]) returns [1,2,3]"

LIVE DATA CONTEXT:
${webContext}`;

      const brainRoster = [
        { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions',     model:'llama3.1-8b',            headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
        { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile', headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
        { name:'GEMINI',   key:process.env.GEMINI_API_KEY,   url:null,                                               model:'gemini-2.0-flash' },
        { name:'MISTRAL',  key:process.env.MISTRAL_API_KEY,  url:'https://api.mistral.ai/v1/chat/completions',       model:'mistral-large-latest',    headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) }
      ];

      async function callBrain(brain) {
        if (brain.name === 'GEMINI') {
          const geminiMessages = formattedMessages.map(m => ({ role:m.role==='assistant'?'model':'user', parts:[{text:m.content}] }));
          const gRes  = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + brain.model + ':generateContent?key=' + brain.key, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ systemInstruction:{parts:[{text:systemPrompt}]}, contents:geminiMessages, generationConfig:{temperature:0.1,maxOutputTokens:1024} })
          });
          const gData = await gRes.json();
          if (gData.error) throw new Error(gData.error.message);
          const reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!reply) throw new Error('Empty reply from GEMINI');
          return { reply:sanitizeReply(reply, listMode), brain:brain.name };
        } else {
          const oRes  = await fetch(brain.url, {
            method:'POST', headers:brain.headers(brain.key),
            body:JSON.stringify({ model:brain.model, messages:[{role:'system',content:systemPrompt},...formattedMessages], temperature:0.1, max_tokens:1024 })
          });
          const oData = await oRes.json();
          if (oData.error) throw new Error(oData.error?.message || JSON.stringify(oData.error));
          const reply = oData?.choices?.[0]?.message?.content;
          if (!reply) throw new Error('Empty reply from ' + brain.name);
          return { reply:sanitizeReply(reply, listMode), brain:brain.name };
        }
      }

      const activeBrains = brainRoster.filter(b => b.key);
      if (!activeBrains.length) {
        console.error('[chat.js] NO BRAIN API KEYS CONFIGURED');
        writeChunk('error', 'No brain API keys configured.');
        endStream(); return;
      }

      try {
        const result = await Promise.any(activeBrains.map(b => callBrain(b)));
        writeChunk('answer', result.reply, { brain: result.brain + ' + WEB [' + dataSource + ']' });
      } catch (aggErr) {
        const errors = aggErr.errors?.map(e => e.message).join(' | ') || aggErr.message;
        console.error('[chat.js] All brains failed:', errors);
        writeChunk('error', 'All brains failed: ' + errors);
      }

    } else if (isPlayRequest) {
      // ── PLAY REQUEST PATH — v5.5.0: extraction now also supports
      // "unknown" so vague descriptions trigger a clarifying question
      // instead of a guessed/wrong video. ──
      writeChunk('thinking', 'Processing play request...');

      const extractedQuery = userQuery.replace(/^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s*/i,'').replace(/\s*(on youtube|for me|please|now)\s*/ig,'').trim();
      const ytResults = await youtubeSearch(extractedQuery);

      if (ytResults) {
        writeChunk('fetching', 'Found videos on YouTube matching your request...');
        writeChunk('searching', 'Verifying matches...');

        const extractSystem = `You are a YouTube search query extractor for Scorpion AI. Today is ${timeStr}.
Given the user's request and ACTUAL YOUTUBE SEARCH RESULTS, extract the best exact match.

Choose ONE of three outcomes:
- "clear": the user's request clearly matches exactly ONE of the YouTube results above (recommend it by its real title/channel).
- "choice": 2+ of the YouTube results plausibly match equally well — surface them as distinct options.
- "unknown": NONE of the YouTube results above genuinely match what the user described (e.g. their request was a vague plot/topic description and the actual results are unrelated, like an unrelated short or clip). In this case do NOT pick a result just because it's the only one available — say so.

YouTube search results provided below are VERIFIED to exist. Use their exact titles and channels. NEVER invent a title that isn't listed.

Output ONLY valid JSON:
{"status":"clear","searchQuery":"<most precise YouTube search query that matches a real result above>"}
OR
{"status":"choice","question":"<max 15 words, spoken question>","options":[{"label":"<video title>","searchQuery":"<search for that exact result>"}, ...]}
OR
{"status":"unknown","reason":"<one short sentence — e.g. 'None of the results I found genuinely match that description, Sir — could you tell me the movie/song title?'"}`;

        const userContent = `ORIGINAL REQUEST: ${extractedQuery}\n\nACTUAL YOUTUBE SEARCH RESULTS:\n${ytResults}`;
        let raw = await callAnyBrain(extractSystem, userContent, 350);
        let parsed = null;
        try { parsed = JSON.parse((raw || '').replace(/```json|```/g,'').trim()); } catch (e) { parsed = null; }

        if (parsed?.status === 'choice' && Array.isArray(parsed.options) && parsed.options.length >= 2) {
          const cleanOptions = parsed.options.filter(o => o && o.label && o.searchQuery).slice(0, 3);
          if (cleanOptions.length >= 2) {
            writeChunk('answer', 'Found multiple matches:\n- ' + cleanOptions.map(o => o.label).join('\n- '), { brain:'YOUTUBE-CHOICE' });
            endStream();
            return;
          }
        }

        if (parsed?.status === 'unknown') {
          writeChunk('answer', parsed.reason || ('I could not confidently match that to a real video, Sir. Could you name the title more specifically? "' + extractedQuery + '" was too vague to verify against what I found on YouTube.'), { brain:'YOUTUBE-UNKNOWN' });
          endStream();
          return;
        }

        const finalQuery = (parsed && parsed.searchQuery) || extractedQuery;
        writeChunk('answer', 'Locking onto: ' + finalQuery, { brain:'YOUTUBE' });
      } else {
        writeChunk('searching', 'No direct YouTube match — searching web for context...');
        const [serperData, tavilyData] = await Promise.all([serperSearch(extractedQuery, false), tavilySearch(extractedQuery)]);
        const rawWeb = [serperData, tavilyData].filter(Boolean).join('\n\n---\n\n');

        if (!rawWeb) {
          writeChunk('answer', 'Could not find: ' + extractedQuery, { brain:'YOUTUBE' });
          endStream();
          return;
        }

        writeChunk('fetching', 'Analysing web context...');
        const extractSystem = `You are a YouTube search query extractor for Scorpion AI. Today is ${timeStr}.
Given the user's "play" request and web search context (no YouTube search succeeded), extract the best search query — but ONLY if the web context actually names a specific, real, identifiable title/speaker/event. Never output a vague plot description as the search query.

Output ONLY valid JSON:
{"status":"clear","searchQuery":"<best YouTube search string based on web context — must be a real specific title, not a vague description>"}
OR
{"status":"unknown","reason":"<one short sentence explaining what's missing>"}`;
        const userContent = `REQUEST: ${extractedQuery}\n\nWEB CONTEXT:\n${rawWeb.slice(0,2000)}`;
        let raw = await callAnyBrain(extractSystem, userContent, 300);
        let parsed = null;
        try { parsed = JSON.parse((raw || '').replace(/```json|```/g,'').trim()); } catch (e) { parsed = null; }

        if (parsed?.status === 'unknown') {
          writeChunk('answer', parsed.reason || ('I could not confirm a specific match for "' + extractedQuery + '", Sir. Could you give me the exact title?'), { brain:'WEB-UNKNOWN' });
          endStream();
          return;
        }

        const sq = (parsed && parsed.searchQuery) || extractedQuery;
        writeChunk('answer', 'Resolved to: ' + sq, { brain:'YOUTUBE+WEB' });
      }

    } else if (analyzeMode) {
      const analyzeFormatRule = listMode ? `OUTPUT FORMAT RULES:
- The user wants point-form / list output. Write as short points, each line starting with "- ".
- No bold, no headers, no numbered lists — only "- " bullets.
- Address the user as Sir.` : `CRITICAL OUTPUT FORMAT RULES:
- Write in plain conversational sentences only.
- NEVER use markdown: no asterisks, no bold, no headers, no bullet points, no numbered lists, no backticks.
- Your output will be read aloud by text-to-speech.
- Address the user as Sir.`;

      const analyzeSystem = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.
Today is ${timeStr}.

${analyzeFormatRule}

The user has pasted or referenced a block of text below for you to analyse, summarise, or otherwise work with.
Do NOT treat this content as something to search the web for — it is already provided to you in full.
Read it carefully and respond directly to what they asked you to do with it.`;

      const brainRoster = [
        { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions',     model:'llama3.1-8b',            headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
        { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile', headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
        { name:'GEMINI',   key:process.env.GEMINI_API_KEY,   url:null,                                               model:'gemini-2.0-flash' },
        { name:'MISTRAL',  key:process.env.MISTRAL_API_KEY,  url:'https://api.mistral.ai/v1/chat/completions',       model:'mistral-large-latest',    headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) }
      ].filter(b => b.key);

      writeChunk('fetching', 'No search needed — analysing provided text directly.');

      if (!brainRoster.length) {
        console.error('[chat.js] NO BRAIN API KEYS CONFIGURED');
        writeChunk('error', 'No brain API keys configured.');
        endStream(); return;
      }

      async function callAnalyzeBrain(brain) {
        if (brain.name === 'GEMINI') {
          const geminiMessages = formattedMessages.map(m => ({ role:m.role==='assistant'?'model':'user', parts:[{text:m.content}] }));
          const gRes  = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + brain.model + ':generateContent?key=' + brain.key, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ systemInstruction:{parts:[{text:analyzeSystem}]}, contents:geminiMessages, generationConfig:{temperature:0.2,maxOutputTokens:1536} })
          });
          const gData = await gRes.json();
          if (gData.error) throw new Error(gData.error.message);
          const reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!reply) throw new Error('Empty reply from GEMINI');
          return { reply:sanitizeReply(reply, listMode), brain:brain.name };
        } else {
          const oRes  = await fetch(brain.url, {
            method:'POST', headers:brain.headers(brain.key),
            body:JSON.stringify({ model:brain.model, messages:[{role:'system',content:analyzeSystem},...formattedMessages], temperature:0.2, max_tokens:1536 })
          });
          const oData = await oRes.json();
          if (oData.error) throw new Error(oData.error?.message || JSON.stringify(oData.error));
          const reply = oData?.choices?.[0]?.message?.content;
          if (!reply) throw new Error('Empty reply from ' + brain.name);
          return { reply:sanitizeReply(reply, listMode), brain:brain.name };
        }
      }

      try {
        const result = await Promise.any(brainRoster.map(b => callAnalyzeBrain(b)));
        writeChunk('answer', result.reply, { brain: result.brain + ' + DIRECT' });
      } catch (aggErr) {
        const errors = aggErr.errors?.map(e => e.message).join(' | ') || aggErr.message;
        console.error('[chat.js] All brains failed (analyze mode):', errors);
        writeChunk('error', 'All brains failed: ' + errors);
      }

    } else {
      // ── SIMPLE COMMAND PATH ────────────────────────────
      const simpleSystem = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal. Address the user as Sir. Today is ${timeStr}.
NEVER use markdown. Write plain conversational sentences only. Keep it brief.`;

      const activeBrains = [
        { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions', model:'llama3.1-8b' },
        { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile' }
      ].filter(b => b.key);

      for (const brain of activeBrains) {
        try {
          const r    = await fetch(brain.url, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+brain.key}, body:JSON.stringify({ model:brain.model, temperature:0.2, max_tokens:300, messages:[{role:'system',content:simpleSystem},...formattedMessages] }) });
          const data = await r.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) { writeChunk('answer', sanitizeReply(reply, false), { brain:brain.name }); endStream(); return; }
        } catch (e) {
          console.error('[chat.js] Brain call failed:', brain.name, e.message);
        }
      }
      writeChunk('answer', 'At your service Sir.', { brain:'FALLBACK' });
    }

    endStream();

  } catch (e) {
    console.error('[chat.js] Handler error:', e.message, e.stack);
    try {
      res.write('data: ' + JSON.stringify({ type:'error', content:e.message }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (_) {
      res.status(500).json({ error: e.message });
    }
  }
}
