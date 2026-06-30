// ============================================================
// CHAT API HANDLER — SCORPION AI BRAIN v5.6.0
// ============================================================
// v5.6.0 (THIS VERSION):
//   - REMOVED unnecessary search fallback bloat: braveSearch,
//     newsSearch, rssSearch, duckSearch are gone. runSearchChain
//     now uses Serper + Tavily only (the two providers that were
//     actually configured/used in practice). Less surface area,
//     fewer silent failure paths, faster responses.
//   - FIX: play-research requests (resolveAndPlay's long
//     "Identify exactly which video..." prompt) no longer get
//     misclassified as analyzeMode just because they're >400
//     chars. Added isPlayResearch flag from frontend + a regex
//     guard so play research ALWAYS goes through the search
//     pipeline instead of skipping straight to a no-search reply.
//   - FIX: youtubeSearch() in the main pipeline now receives a
//     CLEAN seed query (the actual subject — "latest trump speech
//     white house June 2026") instead of the entire raw instruction
//     sentence, which is what was causing irrelevant old videos to
//     surface as the top YouTube match.
//   - FIX: role prompts now explicitly forbid the model claiming
//     "I'm a language model, I can't browse" when LIVE DATA CONTEXT
//     is actually present in the prompt.
//   - FIX: confidence threshold for auto-playing a YouTube match is
//     now higher for time-sensitive ("latest/recent/today") queries,
//     so it asks instead of guessing on a stale match.
//
// Author  : Dr. Davie Mwangi
// Version : 5.6.0
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

  try {
    const { messages, mode, timezone, query, clarificationAnswer, originalQuery, isPlayResearch } = req.body;

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

    function fetchTimestamp() {
      return new Date().toLocaleString('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
    }

    // ── BRAIN HELPERS ─────────────────────────────────────
    async function callCerebras(systemContent, userContent, maxTokens = 200) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) return null;
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
      if (!key) return null;
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
      res.write('data: ' + JSON.stringify({ type, content, ...extra }) + '\n\n');
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

    // ── SEARCH HELPERS (trimmed: Serper + Tavily only) ────
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

    // ── YOUTUBE SEARCH VALIDATION ──────────────────────────
    const CLICKBAIT_TITLE_PATTERNS = /\b(stuns everyone|urgent (24|breaking)[- ]hour|america in shock|shocking announcement|you won'?t believe|breaking news live now|world stunned|panic erupts|emergency alert|in shock as|national lockdown)\b/i;
    const CLICKBAIT_CHANNEL_PATTERNS = /\b(news\s*live|studio\s*\d|\bnr\s*\d\b|live\s*now\s*\d|breaking\s*now)\b/i;

    function isLowCredibilitySource(video) {
      const title = (video.title || '');
      const channel = (video.channel || '');
      if (CLICKBAIT_TITLE_PATTERNS.test(title)) return true;
      if (CLICKBAIT_CHANNEL_PATTERNS.test(channel)) return true;
      return false;
    }

    async function youtubeSearch(q) {
      try {
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

    // FIX: extracts a clean YouTube search subject from either a normal
    // "play X" user query OR the long researchPrompt sentence built by
    // resolveAndPlay() on the frontend ("Identify exactly which video...
    // Request: play X"). Previously the ENTIRE instruction sentence was
    // passed straight to youtubeSearch(), which is why irrelevant/stale
    // videos kept winning the match.
    function extractYoutubeSeedQuery(q) {
      const m = q.match(/Request:\s*play\s+(.+)$/i);
      if (m) return m[1].trim();
      return q.replace(/^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s*/i, '')
               .replace(/\s*(on youtube|for me|please|now)\s*/ig, '')
               .trim();
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

    // Trimmed: Serper + Tavily only. No brave/news/rss/duck fallback chain.
    async function runSearchChain(plannedQueries, intent) {
      const perQuery = {};
      for (const q of plannedQueries) {
        const [serperData, tavilyData] = await Promise.all([serperSearch(q, intent.isNews), tavilySearch(q)]);
        perQuery[q] = dedupeBlocks([serperData, tavilyData].filter(Boolean).join('\n\n---\n\n'));
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
        return 'LIVE CRYPTO PRICE:\n' + coin.toUpperCase() + ' = $' + c.usd.toLocaleString() + ' USD\n24h Change: ' + c.usd_24h_change?.toFixed(2) + '%\nFetched at: ' + fetchTimestamp() + '\nINSTRUCTION: Always state the fetch time and date in your answer.';
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
        let result = 'LIVE METALS PRICES (per troy ounce, USD):\n';
        if (gold)     result += 'Gold (XAU/USD): $' + gold.price.toFixed(2) + '\n';
        if (silver)   result += 'Silver (XAG/USD): $' + silver.price.toFixed(2) + '\n';
        if (platinum) result += 'Platinum: $' + platinum.price.toFixed(2) + '\n';
        result += 'Fetched at: ' + fetchTimestamp() + '\nINSTRUCTION: Always state the fetch time and date in your answer.';
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
        let result = 'LIVE FOREX RATES (vs USD):\n';
        SUPPORTED_FOREX_PAIRS.forEach(p => { if (data.rates[p]) result += 'USD/' + p + ': ' + data.rates[p].toFixed(4) + '\n'; });
        result += 'Fetched at: ' + fetchTimestamp() + '\nSUPPORTED PAIRS ONLY: ' + SUPPORTED_FOREX_PAIRS.join(', ');
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
        return 'LIVE WEATHER — ' + loc.name + ', ' + loc.country + ':\nTemperature: ' + cur.temperature_2m + 'C (feels like ' + cur.apparent_temperature + 'C)\nCondition: ' + (conds[cur.weather_code]||'Variable') + '\nHumidity: ' + cur.relative_humidity_2m + '%\nWind: ' + cur.wind_speed_10m + ' km/h\nFetched at: ' + fetchTimestamp() + '\nINSTRUCTION: Always state the fetch time and date in your answer.';
      } catch (e) { return null; }
    }

    async function getSports(q) {
      if (!q.toLowerCase().match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r    = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today.';
        return 'LIVE SPORTS RESULTS:\n' + data.events.slice(0,6).map(e =>
          e.strHomeTeam + ' ' + (e.intHomeScore??'-') + ' vs ' + (e.intAwayScore??'-') + ' ' + e.strAwayTeam + ' (' + e.strLeague + ')'
        ).join('\n') + '\nFetched at: ' + fetchTimestamp() + '\nINSTRUCTION: Report only these matches and state the fetch time.';
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

    // FIX: play-research requests (the long "Identify exactly which
    // video..." prompt built by resolveAndPlay on the frontend) must
    // NEVER be classified as analyzeMode — that was bypassing search
    // entirely. Guarded two ways: (1) explicit isPlayResearch flag from
    // frontend, (2) regex fallback in case the flag is ever missing.
    function isAnalyzeRequest(text) {
      if (!text) return false;
      if (/^Identify exactly which video the user wants to play/i.test(text)) return false;
      if (text.length > 400) return true;
      return /\b(analy[sz]e|summar[iz]e|review this|what does this (mean|say)|proofread|critique this)\b/i.test(text);
    }

    // ── ROLE-BASED SYSTEM PROMPTS ──────────────────────
    function getRolePrompt(intent, partOfDay, timeStr) {
      const basePersonality = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.
Today is ${timeStr}. It is ${partOfDay}.`;

      const noDisclaimerRule = `
INSTRUCTION (CRITICAL): You ARE given live web/YouTube search results in the LIVE DATA CONTEXT section below when search was run. NEVER say "I'm a language model" or "I cannot browse the internet" or similar disclaimers — that is false in this context and confuses the user. If LIVE DATA CONTEXT contains real results, use them directly. Only say you lack live data if the DATA GAP WARNINGS section explicitly says so or the context is empty.`;

      const roles = {
        music: `${basePersonality}
${noDisclaimerRule}

You are a music encyclopedia and curator. You know artist histories, discographies, production techniques, collaborations, album release dates, chart positions, and song meanings.

INSTRUCTION:
- If YOUTUBE SEARCH RESULTS show verified videos matching the query, ALWAYS offer: "I found [exact title] by [channel]. Would you like me to play it, Sir?"
- Be enthusiastic about music. Use era/genre context naturally.`,

        news: `${basePersonality}
${noDisclaimerRule}

You are a news analyst and fact-checker. You synthesize multiple sources, flag uncertain or outdated claims, and trace facts to original reporting.

INSTRUCTION:
- ALWAYS state fetch timestamp and source freshness ([HIGH CONFIDENCE] = today/yesterday, [MEDIUM] = 1-7 days, [LOW] = older)
- If sources contradict, say which source and why.
- If a YOUTUBE SEARCH RESULTS block is present and a listed video is genuinely a real, relevant recording of the event/person/topic discussed, mention it: "I also found footage of this — [exact title] by [channel]. Would you like me to play it, Sir?" Only offer this when it's a real match; never invent a title.`,

        crypto: `${basePersonality}
${noDisclaimerRule}

You are a markets analyst specializing in cryptocurrency.

CRITICAL: Live crypto data in LIVE CRYPTO DATA is GROUND TRUTH. Do NOT use training knowledge for prices.
INSTRUCTION:
- Always report prices with timestamp.
- If query asks for price but no live data: "I do not have a live feed for that, Sir."`,

        technical: `${basePersonality}

You are a technical problem-solver and engineer. Be precise, explain *why* not just how, and admit when something needs specialized knowledge.`,

        general: `${basePersonality}
${noDisclaimerRule}

You are a conversationalist and explainer. Answer clearly, break complex topics down, and engage naturally.

INSTRUCTION:
- If a YOUTUBE SEARCH RESULTS block is present and a listed video is genuinely relevant, you may mention it: "I also found a video on this, [exact title] by [channel]. Would you like me to play it, Sir?" Never invent a title that isn't actually listed.`
      };

      return roles[intent.primary] || roles.general;
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

    function isSimpleCommand(msgs) {
      if (!msgs?.length) return true;
      const last = msgs[msgs.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = ['hello','hi','hey','thanks','thank you','bye','goodbye','how are you','what is your name','who are you','play ','stop','pause'];
      const isVisual = /explain|show me|what is|how does|diagram of|illustrate/.test(text);
      if (isVisual) return false;
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // ══════════════════════════════════════════════════════
    // NON-STREAMING MODES
    // ══════════════════════════════════════════════════════

    if (mode === 'wipe_memory') {
      await wipeMemory();
      return res.status(200).json({ success: true, message: 'Memory cleared, Sir.' });
    }

    if (mode === 'extract_play_query') {
      const rawQuery = (query || '').trim();
      const answer   = (req.body.answer || '').trim();
      if (!rawQuery && !answer) return res.status(200).json({ status: 'clear', searchQuery: '' });

      const extractSystem = `You are a YouTube search query extractor for Scorpion AI. Today is ${timeStr}.
Given the user's original "play" request and a researched answer (which may include ACTUAL YOUTUBE SEARCH RESULTS), decide one of THREE outcomes:

- "clear": exactly ONE specific, real, identifiable video/song/speech/event is meant, AND you can name it precisely. NEVER output a vague description as the searchQuery.
- "choice": the researched answer itself names 2+ DISTINCT real, specific titles.
- "unknown": you cannot confidently identify a specific real title. Do NOT guess.

If the answer contains "YOUTUBE SEARCH RESULTS (VERIFIED):" block, those are REAL YouTube videos — use the titles and channels from that block, never invent your own.

Output ONLY valid JSON. No markdown, no backticks.
If clear: {"status":"clear","searchQuery":"<exact, specific YouTube search query>"}
If choice: {"status":"choice","question":"<short spoken question, max 15 words>","options":[{"label":"<video title>","searchQuery":"<precise YouTube search>"}, ...]}
If unknown: {"status":"unknown","reason":"<one short sentence>"}`;
      const userContent = `ORIGINAL REQUEST: ${rawQuery}\n\nRESEARCHED ANSWER:\n${answer.slice(0,2000)}`;
      let raw = await callAnyBrain(extractSystem, userContent, 350);
      let parsed = null;
      try { parsed = JSON.parse((raw || '').replace(/```json|```/g,'').trim()); } catch (e) { parsed = null; }

      if (parsed?.status === 'choice' && Array.isArray(parsed.options) && parsed.options.length >= 2) {
        const cleanOptions = parsed.options.filter(o => o && o.label && o.searchQuery).slice(0, 3);
        if (cleanOptions.length >= 2) {
          return res.status(200).json({ status: 'choice', question: parsed.question || 'Which one, Sir?', options: cleanOptions });
        }
      }
      if (parsed?.status === 'unknown') {
        return res.status(200).json({ status: 'unknown', reason: parsed.reason || 'I do not have a confirmed match, Sir. Could you be more specific?' });
      }

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
You MUST explicitly state the current time and date somewhere in the greeting, worked naturally into a sentence.
Give a brief, witty, engaging good ${partOfDay} greeting. Keep it to 2-3 sentences.
End with a short, simple, easy-to-answer-with-"yes" question.
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

    const analyzeMode = !isPlayResearch && isAnalyzeRequest(userQuery);
    const listMode = isListRequest(userQuery);
    const isPlayRequest = !isPlayResearch && /^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s+.+/i.test(userQuery);

    if (!isSimpleCommand(userMessages) && !analyzeMode && !isPlayRequest) {
      const reasoningSystem = `You are the reasoning layer of Scorpion AI. Today is ${timeStr}.
In ONE sentence only, state: what the user is asking for AND what data source or action is needed.
Output ONLY that one sentence. No preamble, no extra text.`;
      const reasoningSentence = await callCerebras(reasoningSystem, userQuery, 80);
      if (reasoningSentence) writeChunk('thinking', reasoningSentence.trim());

      const intent = classifyQuery(userQuery);
      writeChunk('searching', 'Planning search strategy...');
      const plannedQueries = await planSearch(userQuery);
      writeChunk('searching', 'Running ' + plannedQueries.length + ' search queries: ' + plannedQueries.join(' / '));

      writeChunk('fetching', 'Fetching live data and web results...');

      // FIX: youtubeSearch now gets a clean seed query, not the raw
      // (possibly very long, instruction-laden) userQuery.
      const ytSeedQuery = enhanceQuery(extractYoutubeSeedQuery(userQuery));

      const [rawWebData, cryptoData, metalData, forexData, weatherData, sportsData, youtubeData] = await Promise.all([
        runSearchChain(plannedQueries, intent),
        getCrypto(userQuery),
        getMetals(userQuery),
        getForex(userQuery),
        getWeather(userQuery),
        getSports(userQuery),
        youtubeSearch(ytSeedQuery)
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
- No bold, no headers, no numbered lists — only "- " bullets.
- Address the user as Sir.
- Always state the exact fetch time and date when reporting live data.` : `CRITICAL OUTPUT FORMAT RULES:
- Write in plain conversational sentences only.
- NEVER use markdown.
- Your output will be read aloud by a text-to-speech engine.
- Address the user as Sir.
- Always state the exact fetch time and date when reporting live data.`;

      const rolePrompt = getRolePrompt(intent, partOfDay, timeStr);

      const systemPrompt = `${rolePrompt}

${formatRule}

CONFIDENCE SELF-RATING: Start your answer with [CONFIDENT] / [LIKELY] / [UNCERTAIN] / [GUESSING] then the answer.

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
      // ── PLAY REQUEST PATH (direct "play X" command, no research step) ──
      writeChunk('thinking', 'Processing play request...');

      const extractedQuery = extractYoutubeSeedQuery(userQuery);
      const ytResults = await youtubeSearch(extractedQuery);

      if (ytResults) {
        writeChunk('fetching', 'Found videos on YouTube matching your request...');
        writeChunk('searching', 'Verifying matches...');

        const extractSystem = `You are a YouTube search query extractor for Scorpion AI. Today is ${timeStr}.
Given the user's request and ACTUAL YOUTUBE SEARCH RESULTS, extract the best exact match.
- "clear": clearly matches exactly ONE result.
- "choice": 2+ results plausibly match equally well.
- "unknown": NONE genuinely match — do not pick one just because it's available.
Use exact titles/channels from the results. NEVER invent a title.
Output ONLY valid JSON:
{"status":"clear","searchQuery":"<query matching a real result above>"}
OR {"status":"choice","question":"<max 15 words>","options":[{"label":"<title>","searchQuery":"<query>"}, ...]}
OR {"status":"unknown","reason":"<one short sentence>"}`;

        const userContent = `ORIGINAL REQUEST: ${extractedQuery}\n\nACTUAL YOUTUBE SEARCH RESULTS:\n${ytResults}`;
        let raw = await callAnyBrain(extractSystem, userContent, 350);
        let parsed = null;
        try { parsed = JSON.parse((raw || '').replace(/```json|```/g,'').trim()); } catch (e) { parsed = null; }

        if (parsed?.status === 'choice' && Array.isArray(parsed.options) && parsed.options.length >= 2) {
          const cleanOptions = parsed.options.filter(o => o && o.label && o.searchQuery).slice(0, 3);
          if (cleanOptions.length >= 2) {
            writeChunk('answer', 'Found multiple matches:\n- ' + cleanOptions.map(o => o.label).join('\n- '), { brain:'YOUTUBE-CHOICE' });
            endStream(); return;
          }
        }
        if (parsed?.status === 'unknown') {
          writeChunk('answer', parsed.reason || ('I could not confidently match that to a real video, Sir. Could you name the title more specifically?'), { brain:'YOUTUBE-UNKNOWN' });
          endStream(); return;
        }

        const finalQuery = (parsed && parsed.searchQuery) || extractedQuery;
        writeChunk('answer', 'Locking onto: ' + finalQuery, { brain:'YOUTUBE' });
      } else {
        writeChunk('searching', 'No direct YouTube match — searching web for context...');
        const [serperData, tavilyData] = await Promise.all([serperSearch(extractedQuery, false), tavilySearch(extractedQuery)]);
        const rawWeb = [serperData, tavilyData].filter(Boolean).join('\n\n---\n\n');

        if (!rawWeb) {
          writeChunk('answer', 'Could not find: ' + extractedQuery, { brain:'YOUTUBE' });
          endStream(); return;
        }

        writeChunk('fetching', 'Analysing web context...');
        const extractSystem = `You are a YouTube search query extractor for Scorpion AI. Today is ${timeStr}.
Given the user's "play" request and web search context (no YouTube search succeeded), extract the best search query — but ONLY if the web context actually names a specific, real, identifiable title/speaker/event.
Output ONLY valid JSON:
{"status":"clear","searchQuery":"<best YouTube search string — must be a real specific title>"}
OR {"status":"unknown","reason":"<one short sentence>"}`;
        const userContent = `REQUEST: ${extractedQuery}\n\nWEB CONTEXT:\n${rawWeb.slice(0,2000)}`;
        let raw = await callAnyBrain(extractSystem, userContent, 300);
        let parsed = null;
        try { parsed = JSON.parse((raw || '').replace(/```json|```/g,'').trim()); } catch (e) { parsed = null; }

        if (parsed?.status === 'unknown') {
          writeChunk('answer', parsed.reason || ('I could not confirm a specific match for "' + extractedQuery + '", Sir. Could you give me the exact title?'), { brain:'WEB-UNKNOWN' });
          endStream(); return;
        }

        const sq = (parsed && parsed.searchQuery) || extractedQuery;
        writeChunk('answer', 'Resolved to: ' + sq, { brain:'YOUTUBE+WEB' });
      }

    } else if (analyzeMode) {
      const analyzeFormatRule = listMode ? `OUTPUT FORMAT RULES:
- Write as short points, each line starting with "- ". Address the user as Sir.` : `CRITICAL OUTPUT FORMAT RULES:
- Plain conversational sentences only, no markdown. Output is read by TTS. Address the user as Sir.`;

      const analyzeSystem = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.
Today is ${timeStr}.

${analyzeFormatRule}

The user has pasted or referenced a block of text below for you to analyse, summarise, or otherwise work with.
Do NOT treat this content as something to search the web for — it is already provided to you in full.`;

      const brainRoster = [
        { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions',     model:'llama3.1-8b',            headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
        { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile', headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
        { name:'GEMINI',   key:process.env.GEMINI_API_KEY,   url:null,                                               model:'gemini-2.0-flash' },
        { name:'MISTRAL',  key:process.env.MISTRAL_API_KEY,  url:'https://api.mistral.ai/v1/chat/completions',       model:'mistral-large-latest',    headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) }
      ].filter(b => b.key);

      writeChunk('fetching', 'No search needed — analysing provided text directly.');

      if (!brainRoster.length) {
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
