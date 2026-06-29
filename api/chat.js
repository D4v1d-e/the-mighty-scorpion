// ============================================================
// CHAT API HANDLER — SCORPION AI BRAIN
// ============================================================
// Description : Multi-brain AI chat handler with live data
//               pipeline: web search, crypto, forex, metals,
//               weather, sports, news, and RSS feeds.
//
// Brain roster (sequential with timeout fallback):
//   1. Cerebras  — llama3.1-8b     (fastest)
//   2. Groq      — llama-3.3-70b   (balanced)
//   3. Gemini    — gemini-2.0-flash (powerful)
//   4. Mistral   — mistral-large    (fallback)
//
// Author  : Dr. Davie Mwangi
// Version : 3.0.0
// Fixes   :
//   - Sequential brain calling (was Promise.any — wasteful)
//   - planSearch/scoreAndFilter now race Cerebras + Groq
//   - cleanForSpeech cuts at sentence boundary (not mid-word)
//   - Weather city parser handles "weather Kisumu" (no preposition)
//     and multi-word cities
//   - conversationHistory standardised to {role, content}
//   - IMAGE_TRIGGERS tightened (no longer fires on "what is")
// ============================================================

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;

    // ── TIME CONTEXT ────────────────────────────────────────
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      timeZone: timezone || 'Africa/Nairobi',
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
    const hour = parseInt(
      new Date().toLocaleString('en-US', {
        timeZone: timezone || 'Africa/Nairobi',
        hour: 'numeric', hour12: false
      })
    );
    const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

    const todayStr     = now.toISOString().slice(0, 10);
    const yesterday    = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const currentYear  = now.getFullYear();
    const currentMonth = now.toLocaleString('en-US', { month: 'long' });

    // ── QUERY CLASSIFIER ────────────────────────────────────
    function classifyQuery(query) {
      const q = query.toLowerCase();
      return {
        isCrypto:    /bitcoin|btc|ethereum|eth|solana|sol|bnb|dogecoin|doge|xrp|cardano|ada|crypto|coin/.test(q),
        isForex:     /forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound/.test(q),
        isMetals:    /gold|silver|xau|xag|platinum|palladium|metal/.test(q),
        isWeather:   /weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/.test(q),
        isSports:    /football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/.test(q),
        isFinancial: /rate|exchange|currency|price|convert|worth|cost|how much|value|market|stock|share|trading/.test(q),
        isNews:      /news|happened|latest|today|yesterday|this week|breaking|announced|said|reported/.test(q),
        // ✅ FIX: isVisual only matches clearly visual requests, not "what is" factual queries
        isVisual:    /diagram of|illustrate|demonstrate|visualise|visualize|lab|laboratory|show me how .+ works/.test(q)
      };
    }

    // ── SMART QUERY ENHANCER ────────────────────────────────
    function enhanceQuery(query) {
      const q = query.toLowerCase();
      let enhanced = query;
      if      (q.includes('yesterday'))                                                          enhanced = query + ' ' + yesterdayStr;
      else if (q.includes('this morning') || q.includes('today'))                               enhanced = query + ' ' + todayStr;
      else if (q.includes('this week'))                                                          enhanced = query + ' ' + currentMonth + ' ' + currentYear;
      else if (/latest|recent|now|current|just|happened/.test(q))                              enhanced = query + ' ' + currentMonth + ' ' + currentYear;
      return enhanced;
    }

    // ── CEREBRAS HELPER ─────────────────────────────────────
    async function callCerebras(systemContent, userContent, maxTokens = 200) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'llama3.1-8b',
            temperature: 0,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user',   content: userContent   }
            ]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) { return null; }
    }

    // ── GROQ HELPER (for planning/filtering fallback) ────────
    async function callGroqSmall(systemContent, userContent, maxTokens = 200) {
      const key = process.env.GROQ_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant', // lightweight groq model for planning tasks
            temperature: 0,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user',   content: userContent   }
            ]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) { return null; }
    }

    // ── RACE HELPER: Cerebras vs Groq for planning tasks ────
    // ✅ FIX: planSearch/scoreAndFilter no longer rely solely on Cerebras
    async function raceSmallModels(systemContent, userContent, maxTokens = 200) {
      try {
        return await Promise.any([
          callCerebras(systemContent, userContent, maxTokens),
          callGroqSmall(systemContent, userContent, maxTokens)
        ].filter(p => p !== null));
      } catch (e) { return null; }
    }

    // ── SEARCH PLANNER ──────────────────────────────────────
    async function planSearch(query) {
      const result = await raceSmallModels(
        'You are a search query planner. Today is ' + timeStr + '. Given a user question, output 2-3 specific targeted search queries that would find the most accurate and current information. Each query should target a different angle — facts, news, analysis. Always append current month and year to queries about recent events. Output ONLY a valid JSON array of strings. No explanation, no markdown. Example: ["SpaceX IPO price June 2026","SpaceX SPCX Nasdaq debut","Elon Musk trillionaire 2026"]',
        query,
        200
      );
      if (!result) return [enhanceQuery(query)];
      try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        const queries = JSON.parse(cleaned);
        return Array.isArray(queries) && queries.length > 0 ? queries : [enhanceQuery(query)];
      } catch (e) { return [enhanceQuery(query)]; }
    }

    // ── CONFIDENCE FILTER ───────────────────────────────────
    async function scoreAndFilter(rawData, query) {
      if (!rawData) return rawData;
      const result = await raceSmallModels(
        'You are a data quality analyst. Today is ' + timeStr + '. Given raw search results and a query: ' +
        '1) Extract only facts that directly answer the query. ' +
        '2) Remove irrelevant content, ads, navigation, repetition. ' +
        '3) Tag each key fact as [HIGH CONFIDENCE] if multiple sources agree and it is recent, or [LOW CONFIDENCE] if single source or older than 7 days. ' +
        '4) For financial figures note the source and date. ' +
        '5) Flag the date of each fact as [DATE: YYYY-MM-DD]. If no date found, tag [DATE: UNKNOWN] and mark LOW CONFIDENCE. ' +
        '6) REJECT any news fact whose source article is older than 48 hours — mark it [STALE] and deprioritise it. ' +
        '7) Preserve exact numbers — never round or alter figures. ' +
        '8) Output clean structured facts only. If nothing is relevant output exactly: NO RELEVANT DATA FOUND',
        'QUERY: ' + query + '\n\nRAW DATA:\n' + rawData.slice(0, 10000),
        2000
      );
      if (!result || result === 'NO RELEVANT DATA FOUND') return rawData;
      return result;
    }

    // ── RECENCY VALIDATOR ───────────────────────────────────
    function hasRecentDate(text) {
      const cutoff = new Date(Date.now() - 3 * 86400000);
      const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
      return dateMatches.some(d => new Date(d) >= cutoff);
    }

    // ── URL CONTENT FETCHER ─────────────────────────────────
    async function fetchPageContent(url) {
      try {
        const blocked = ['wsj.com','ft.com','bloomberg.com','nytimes.com','economist.com','washingtonpost.com','thetimes.co.uk'];
        if (blocked.some(d => url.includes(d))) return null;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept': 'text/html' }
        });
        clearTimeout(timeout);
        if (!r.ok) return null;
        const html = await r.text();
        let text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        return text.length > 200 ? text.slice(0, 2000) : null;
      } catch (e) { return null; }
    }

    // ── SERPER — GOOGLE SEARCH ──────────────────────────────
    async function serperSearch(query, isNews) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const body = { q: query, num: 8, gl: 'us', hl: 'en' };
        if (isNews) body.tbs = 'qdr:d';
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        let results = '';
        if (data.answerBox)     results += 'DIRECT ANSWER: ' + (data.answerBox.answer || data.answerBox.snippet || data.answerBox.title || '') + '\n\n';
        if (data.knowledgeGraph) results += 'KNOWLEDGE: ' + (data.knowledgeGraph.title || '') + ' — ' + (data.knowledgeGraph.description || '') + '\n\n';
        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 6).forEach((r, i) => {
            results += '[' + (i+1) + '] ' + r.title + '\n' + r.snippet + '\nSource: ' + r.link + '\n\n';
          });
          const urls = data.organic.slice(0, 5).map(r => r.link).filter(Boolean);
          const contents = await Promise.all(urls.map(url => fetchPageContent(url)));
          const fullArticles = contents.map((c,i) => c ? 'FULL ARTICLE [' + (i+1) + '] from ' + urls[i] + ':\n' + c : null).filter(Boolean);
          if (fullArticles.length) results += '\nFULL ARTICLE CONTENT:\n' + fullArticles.join('\n\n---\n\n');
        }
        return results.trim() || null;
      } catch (e) { return null; }
    }

    // ── NEWSAPI ─────────────────────────────────────────────
    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const [everythingRes, headlinesRes] = await Promise.all([
          fetch('https://newsapi.org/v2/everything?q=' + encodeURIComponent(query) + '&sortBy=publishedAt&pageSize=5&language=en&apiKey=' + key),
          fetch('https://newsapi.org/v2/top-headlines?q=' + encodeURIComponent(query) + '&pageSize=3&language=en&apiKey=' + key)
        ]);
        const [everything, headlines] = await Promise.all([everythingRes.json(), headlinesRes.json()]);
        let result = '';
        if (headlines.articles?.length) {
          result += 'TOP HEADLINES:\n' + headlines.articles.slice(0,3).map((a,i) =>
            '[' + (i+1) + '] ' + a.title + '\n' + (a.description||'') + '\nPublished: ' + (a.publishedAt?.slice(0,10)) + '\nSource: ' + a.source?.name
          ).join('\n\n') + '\n\n';
        }
        if (everything.articles?.length) {
          result += 'RECENT NEWS:\n' + everything.articles.slice(0,5).map((a,i) =>
            '[' + (i+1) + '] ' + a.title + '\n' + (a.description||'') + '\nPublished: ' + (a.publishedAt?.slice(0,10)) + '\nSource: ' + a.source?.name
          ).join('\n\n');
        }
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── TAVILY ──────────────────────────────────────────────
    async function tavilySearch(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query, search_depth: 'advanced', max_results: 6, include_answer: true, include_raw_content: true })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results.map((r,i) => '[' + (i+1) + '] ' + r.title + '\n' + (r.raw_content||r.content)?.slice(0,1500)).join('\n\n');
        return data.answer ? 'DIRECT ANSWER: ' + data.answer + '\n\nSOURCES:\n' + snippets : snippets;
      } catch (e) { return null; }
    }

    // ── BRAVE ───────────────────────────────────────────────
    async function braveSearch(query) {
      const key = process.env.BRAVE_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch(
          'https://api.search.brave.com/res/v1/news/search?q=' + encodeURIComponent(query) + '&freshness=pd&count=5',
          { headers: { 'Accept': 'application/json', 'X-Subscription-Token': key } }
        );
        const data = await r.json();
        if (!data.results?.length) return null;
        return 'BRAVE NEWS (past 24h):\n' + data.results.map((r,i) =>
          '[' + (i+1) + '] ' + r.title + '\n' + (r.description||'') + '\nAge: ' + (r.age||'unknown')
        ).join('\n\n');
      } catch (e) { return null; }
    }

    // ── RSS ─────────────────────────────────────────────────
    async function rssSearch() {
      try {
        const feeds = [
          'https://feeds.bbci.co.uk/news/rss.xml',
          'https://rss.cnn.com/rss/edition.rss',
          'https://feeds.reuters.com/reuters/topNews'
        ];
        const results = await Promise.all(feeds.map(async (url) => {
          try {
            const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const text = await r.text();
            const items      = [...text.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
            const plainItems = [...text.matchAll(/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
            const all = [...items, ...plainItems];
            return all.slice(0,3).map(m => '[' + (m[2]?.trim()||'unknown date') + '] ' + (m[1]?.trim()||'')).join('\n');
          } catch (e) { return null; }
        }));
        const combined = results.filter(Boolean).join('\n');
        return combined ? 'RSS LIVE HEADLINES:\n' + combined : null;
      } catch (e) { return null; }
    }

    // ── DUCKDUCKGO ──────────────────────────────────────────
    async function duckSearch(query) {
      try {
        const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += 'ANSWER: ' + data.AbstractText + '\n\n';
        if (data.RelatedTopics?.length) data.RelatedTopics.slice(0,4).forEach(t => { if (t.Text) result += '- ' + t.Text + '\n'; });
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── CRYPTO ──────────────────────────────────────────────
    async function getCrypto(query) {
      const q = query.toLowerCase();
      const coinMap = { bitcoin:'bitcoin',btc:'bitcoin',ethereum:'ethereum',eth:'ethereum',solana:'solana',sol:'solana',bnb:'binancecoin',dogecoin:'dogecoin',doge:'dogecoin',xrp:'ripple',cardano:'cardano',ada:'cardano' };
      const coin = Object.keys(coinMap).find(k => q.includes(k));
      if (!coin) return null;
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + coinMap[coin] + '&vs_currencies=usd&include_24hr_change=true');
        const data = await r.json();
        const c = data[coinMap[coin]];
        if (!c) return null;
        return 'LIVE CRYPTO PRICE (fetched now):\n' + coin.toUpperCase() + ' = $' + c.usd.toLocaleString() + ' USD\n24h Change: ' + c.usd_24h_change?.toFixed(2) + '%\nINSTRUCTION: Report only these exact values.';
      } catch (e) { return null; }
    }

    // ── METALS ──────────────────────────────────────────────
    async function getMetals(query) {
      if (!query.toLowerCase().match(/gold|silver|xau|xag|platinum|palladium|metal/)) return null;
      try {
        const r = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        const gold     = data.find(m => m.metal === 'gold');
        const silver   = data.find(m => m.metal === 'silver');
        const platinum = data.find(m => m.metal === 'platinum');
        let result = 'LIVE METALS PRICES (fetched now, per troy ounce, USD):\n';
        if (gold)     result += 'Gold (XAU/USD): $' + gold.price.toFixed(2) + '\n';
        if (silver)   result += 'Silver (XAG/USD): $' + silver.price.toFixed(2) + '\n';
        if (platinum) result += 'Platinum: $' + platinum.price.toFixed(2) + '\n';
        result += 'INSTRUCTION: Report only prices listed.';
        return result.trim();
      } catch (e) { return null; }
    }

    // ── FOREX ───────────────────────────────────────────────
    const SUPPORTED_FOREX_PAIRS = ['EUR','GBP','KES','JPY','CAD','AUD','ZAR','NGN','UGX','TZS','INR','CHF'];

    async function getForex(query) {
      if (!query.toLowerCase().match(/forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound|rate/)) return null;
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates) return null;
        let result = 'LIVE FOREX RATES (fetched now, vs USD):\n';
        SUPPORTED_FOREX_PAIRS.forEach(p => { if (data.rates[p]) result += 'USD/' + p + ': ' + data.rates[p].toFixed(4) + '\n'; });
        result += '\nSUPPORTED PAIRS ONLY: ' + SUPPORTED_FOREX_PAIRS.join(', ');
        result += '\nINSTRUCTION: If the user asked for a pair NOT in this list, tell them "I do not have a live feed for that pair, Sir."';
        return result.trim();
      } catch (e) { return null; }
    }

    // ── WEATHER ─────────────────────────────────────────────
    async function getWeather(query) {
      if (!query.toLowerCase().match(/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/)) return null;

      // ✅ FIX: Robust city parser — handles "weather Kisumu", multi-word cities,
      //   and removes all filler words without requiring a preposition.
      let city = query
        .replace(/\b(weather|temperature|forecast|rain|sunny|cold|hot|humid|wind)\b/gi, '')
        .replace(/\b(right now|today|currently|please|now|this morning|tomorrow)\b/gi, '')
        .replace(/\b(in|at|for|of)\b/gi, '')
        .replace(/[?!.,]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || 'Nairobi';

      try {
        const geoR = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1');
        const geoData = await geoR.json();
        if (!geoData.results?.length) return 'WEATHER ERROR: Location "' + city + '" not found.';
        const loc = geoData.results[0];
        const wR = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto');
        const wData = await wR.json();
        const cur = wData.current;
        const conds = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',51:'Light drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',71:'Slight snow',80:'Rain showers',95:'Thunderstorm' };
        return 'LIVE WEATHER (fetched now) — ' + loc.name + ', ' + loc.country + ':\nTemperature: ' + cur.temperature_2m + 'C (feels like ' + cur.apparent_temperature + 'C)\nCondition: ' + (conds[cur.weather_code]||'Variable') + '\nHumidity: ' + cur.relative_humidity_2m + '%\nWind: ' + cur.wind_speed_10m + ' km/h\nINSTRUCTION: Report only these exact values.';
      } catch (e) { return null; }
    }

    // ── SPORTS ──────────────────────────────────────────────
    async function getSports(query) {
      if (!query.toLowerCase().match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today.';
        return 'LIVE SPORTS RESULTS (fetched now):\n' + data.events.slice(0,6).map(e =>
          e.strHomeTeam + ' ' + (e.intHomeScore??'-') + ' vs ' + (e.intAwayScore??'-') + ' ' + e.strAwayTeam + ' (' + e.strLeague + ')'
        ).join('\n') + '\nINSTRUCTION: Report only these matches.';
      } catch (e) { return null; }
    }

    // ── SIMPLE COMMAND DETECTOR ─────────────────────────────
    function isSimpleCommand(messages) {
      if (!messages?.length) return true;
      const last = messages[messages.length - 1];
      // ✅ FIX: read from .content (standardised) with .text fallback
      const text = (last?.content || last?.text || '').toLowerCase().trim();
      const simple = [
        'hello','hi','hey','thanks','thank you','bye','goodbye',
        'how are you','what is your name','who are you',
        'play ','stop','pause'
      ];
      // Visual queries must NOT be bypassed — they need web context
      const isVisual = /diagram of|illustrate|demonstrate|visualise|visualize/.test(text);
      if (isVisual) return false;
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // ── FORMAT MESSAGES ─────────────────────────────────────
    // ✅ FIX: standardised to {role, content} throughout — no more .text/.content duality
    const userMessages = messages || [{ role: 'user', content: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || m.text || ''
    }));

    // ── MAIN DATA PIPELINE ──────────────────────────────────
    let webContext  = '';
    let searchedWeb = false;
    let dataSource  = '';
    let gaps        = [];

    if (mode !== 'greeting' && !isSimpleCommand(userMessages)) {
      const lastMsg = userMessages[userMessages.length - 1];
      const query   = lastMsg?.content || lastMsg?.text || '';
      const intent  = classifyQuery(query);
      const plannedQueries = await planSearch(query);

      const [searchResults, cryptoData, metalData, forexData, weatherData, sportsData, rssData] = await Promise.all([
        Promise.all(plannedQueries.map(q =>
          Promise.all([serperSearch(q, intent.isNews), newsSearch(q), tavilySearch(q), braveSearch(q)])
        )),
        getCrypto(query),
        getMetals(query),
        getForex(query),
        getWeather(query),
        getSports(query),
        intent.isNews ? rssSearch() : Promise.resolve(null)
      ]);

      const rawWebData = searchResults.flat().filter(Boolean).join('\n\n---\n\n');

      let filteredWebData = null;
      if (rawWebData) filteredWebData = await scoreAndFilter(rawWebData, query);

      if (filteredWebData && intent.isNews && !hasRecentDate(filteredWebData)) {
        filteredWebData += '\n\nDATE WARNING: No source confirmed within the last 3 days. Treat all news claims as potentially stale.';
      }
      if (rssData) filteredWebData = (filteredWebData || '') + '\n\n' + rssData;
      if (!filteredWebData) {
        const duckData = await duckSearch(enhanceQuery(query));
        if (duckData) filteredWebData = duckData;
      }

      if (intent.isCrypto && !cryptoData)  gaps.push('CRYPTO GAP: No live crypto data found. Do NOT use training knowledge for any price.');
      if (intent.isMetals && !metalData)   gaps.push('METALS GAP: No live metals data found. Do NOT estimate any metal price.');
      if (intent.isForex  && !forexData)   gaps.push('FOREX GAP: No live forex data found. Do NOT estimate any exchange rate.');
      if (intent.isForex  &&  forexData)   gaps.push('FOREX PAIR CHECK: Only these pairs are in the live feed: ' + SUPPORTED_FOREX_PAIRS.join(', ') + '.');
      if (intent.isWeather && !weatherData) gaps.push('WEATHER GAP: Weather data could not be fetched. Do NOT guess weather conditions.');

      if (filteredWebData) { webContext += '=== WEB SEARCH (confidence-scored) ===\n' + filteredWebData + '\n\n'; searchedWeb = true; dataSource = 'WEB[' + plannedQueries.length + 'queries]'; }
      if (cryptoData)  { webContext += '=== LIVE CRYPTO DATA ===\n'   + cryptoData  + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource+'+CRYPTO'  : 'CRYPTO';  }
      if (metalData)   { webContext += '=== LIVE METALS DATA ===\n'   + metalData   + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource+'+METALS'  : 'METALS';  }
      if (forexData)   { webContext += '=== LIVE FOREX DATA ===\n'    + forexData   + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource+'+FOREX'   : 'FOREX';   }
      if (weatherData) { webContext += '=== LIVE WEATHER DATA ===\n'  + weatherData + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource+'+WEATHER' : 'WEATHER'; }
      if (sportsData)  { webContext += '=== LIVE SPORTS DATA ===\n'   + sportsData  + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource+'+SPORTS'  : 'SPORTS';  }
      if (gaps.length) { webContext += '=== DATA GAP WARNINGS ===\n'  + gaps.join('\n') + '\n\n'; }

      if (!webContext) {
        webContext  = '=== NO DATA FOUND ===\nAll search sources returned empty results. Tell the user: "I could not find reliable data on that, Sir."';
        searchedWeb = true;
        dataSource  = 'EMPTY';
      }
    }

    // ── SYSTEM PROMPT ────────────────────────────────────────
    const noMarkdownRule = `
CRITICAL OUTPUT FORMAT RULES (apply to every response, no exceptions):
- Write in plain conversational sentences only.
- NEVER use markdown: no asterisks, no bold, no italics, no bullet points, no dashes as lists, no numbered lists, no headers, no code blocks, no backticks.
- NEVER start a line with *, -, #, or a number followed by a period.
- Your output will be read aloud by a text-to-speech engine. Any symbol that is not a letter, comma, period, question mark, or exclamation mark will sound broken.
- Address the user as Sir.
- Keep responses concise and conversational unless asked for detail.
`;

    const webNote = searchedWeb
      ? `\n\nCRITICAL INSTRUCTIONS — YOU ARE AN INTELLIGENT ANALYST:\nToday is ${timeStr}.\nYesterday was ${yesterdayStr}.\n\nYou have data from MULTIPLE SOURCES that have been confidence-scored and filtered.\n\nSOURCE HIERARCHY:\n1. LIVE specialist APIs (CRYPTO, FOREX, METALS, WEATHER, SPORTS)\n2. [HIGH CONFIDENCE] tagged facts\n3. NEWS SOURCES with today or yesterday date\n4. [LOW CONFIDENCE] or [STALE] facts — mention uncertainty\n5. Training knowledge — FORBIDDEN for any factual claim\n\nHANDLE GAPS HONESTLY:\n- DATA GAP WARNING present: say "I do not have a live feed for that, Sir"\n- No sources mention it: say "I could not find reliable data on that, Sir"\n- NEVER fill a gap with training knowledge\n\nLIVE DATA:\n${webContext}`
      : '';

    const systemPrompt = mode === 'greeting'
      ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.\nThe current date and time is: ${timeStr}. It is ${partOfDay}.\nGreet the user warmly like Jarvis greets Tony Stark — address them as Sir.\nGive a brief, witty, engaging good ${partOfDay} greeting. Keep it to 2-3 sentences.\n${noMarkdownRule}`
      : `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.\nYou are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.\nToday is ${timeStr}.\n${noMarkdownRule}${webNote}`;

    // ── BRAIN ROSTER ─────────────────────────────────────────
    const brains = [
      { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions',    model:'llama3.1-8b',          headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
      { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile',headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
      { name:'GEMINI',   key:process.env.GEMINI_API_KEY,   url:null,                                              model:'gemini-2.0-flash' },
      { name:'MISTRAL',  key:process.env.MISTRAL_API_KEY,  url:'https://api.mistral.ai/v1/chat/completions',      model:'mistral-large-latest',  headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) }
    ];

    // ── REPLY SANITIZER ──────────────────────────────────────
    function sanitizeReply(text) {
      return text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/#{1,6}\s+/g, '')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/^\s*[-•]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\|/g, ', ')
        .replace(/\[HIGH CONFIDENCE\]/gi, '')
        .replace(/\[LOW CONFIDENCE\]/gi, '')
        .replace(/\[STALE\]/gi, '')
        .replace(/\[DATE:[^\]]*\]/gi, '')
        .replace(/\[UNKNOWN\]/gi, '')
        .replace(/INSTRUCTION:[^\n]*/gi, '')
        .replace(/===+[^=\n]*===+/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // ── CALL BRAIN ───────────────────────────────────────────
    async function callBrain(brain) {
      try {
        if (brain.name === 'GEMINI') {
          const geminiMessages = formattedMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));
          const gRes = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/' + brain.model + ':generateContent?key=' + brain.key,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: geminiMessages,
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
              })
            }
          );
          const gData = await gRes.json();
          if (gData.error) throw new Error(gData.error.message);
          const reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!reply) throw new Error('Empty reply from ' + brain.name);
          return { reply: sanitizeReply(reply), brain: brain.name };
        } else {
          const oRes = await fetch(brain.url, {
            method: 'POST',
            headers: brain.headers(brain.key),
            body: JSON.stringify({
              model: brain.model,
              messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
              temperature: 0.1,
              max_tokens: 1024
            })
          });
          const oData = await oRes.json();
          if (oData.error) throw new Error(oData.error?.message || JSON.stringify(oData.error));
          const reply = oData?.choices?.[0]?.message?.content;
          if (!reply) throw new Error('Empty reply from ' + brain.name);
          return { reply: sanitizeReply(reply), brain: brain.name };
        }
      } catch (e) {
        throw new Error(brain.name + ': ' + e.message);
      }
    }

    // ── SEQUENTIAL BRAIN CALLER ──────────────────────────────
    // ✅ FIX: was Promise.any (fires all simultaneously, wasteful).
    //   Now tries each brain in order; falls to next only on error/timeout.
    async function callBrainsSequential(activeBrains, timeoutMs = 8000) {
      const errors = [];
      for (const brain of activeBrains) {
        try {
          return await Promise.race([
            callBrain(brain),
            new Promise((_, rej) => setTimeout(() => rej(new Error(brain.name + ': timeout')), timeoutMs))
          ]);
        } catch (e) {
          errors.push(e.message);
          // continue to next brain
        }
      }
      throw new Error('All brains failed: ' + errors.join(' | '));
    }

    // ── FIRE ─────────────────────────────────────────────────
    const activeBrains = brains.filter(b => b.key);
    if (!activeBrains.length) return res.status(500).json({ error: 'No brain API keys configured' });

    try {
      const result   = await callBrainsSequential(activeBrains);
      const webLabel = searchedWeb ? ' + WEB' + (dataSource ? ' [' + dataSource + ']' : '') : '';
      return res.status(200).json({ reply: result.reply, brain: result.brain + webLabel });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
