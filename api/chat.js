export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;

    // ── TIME CONTEXT ──────────────────────────────────────────────────────────
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      timeZone: timezone || 'Africa/Nairobi',
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
    const hour = parseInt(new Date().toLocaleString('en-US', {
      timeZone: timezone || 'Africa/Nairobi', hour: 'numeric', hour12: false
    }));
    const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const currentYear = now.getFullYear();
    const currentMonth = now.toLocaleString('en-US', { month: 'long' });

    // ── HELPERS ───────────────────────────────────────────────────────────────
    function enhanceQuery(query) {
      const q = query.toLowerCase();
      if (q.includes('yesterday')) return query + ' ' + yesterdayStr;
      if (q.includes('this morning') || q.includes('today')) return query + ' ' + todayStr;
      if (q.includes('this week')) return query + ' ' + currentMonth + ' ' + currentYear;
      if (/latest|recent|now|current|just|happened/.test(q)) return query + ' ' + currentMonth + ' ' + currentYear;
      return query;
    }

    function classifyQuery(query) {
      const q = query.toLowerCase();
      return {
        isCrypto:    /bitcoin|btc|ethereum|eth|solana|sol|bnb|dogecoin|doge|xrp|cardano|ada|crypto|coin/.test(q),
        isForex:     /forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound/.test(q),
        isMetals:    /gold|silver|xau|xag|platinum|palladium|metal/.test(q),
        isWeather:   /weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/.test(q),
        isSports:    /football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/.test(q),
        isFinancial: /rate|exchange|currency|price|convert|worth|cost|how much|value|market|stock|share|trading/.test(q),
        isNews:      /news|happened|latest|today|yesterday|this week|breaking|announced|said|reported/.test(q)
      };
    }

    function isSimpleCommand(msgs) {
      if (!msgs?.length) return true;
      const last = msgs[msgs.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye',
        'how are you', 'what is your name', 'who are you', 'play ', 'study ', 'stop', 'pause'];
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // ── LLM CALLERS ───────────────────────────────────────────────────────────
    async function callGroq(systemPrompt, userContent, maxTokens = 1500) {
      const key = process.env.GROQ_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch { return null; }
    }

    async function callGemini(systemPrompt, userContent, maxTokens = 1500) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: userContent }] }],
              generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
            })
          }
        );
        const data = await r.json();
        if (data.error) return null;
        return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      } catch { return null; }
    }

    async function callMistral(systemPrompt, formattedMessages, maxTokens = 1024) {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'mistral-large-latest',
            temperature: 0.1,
            max_tokens: maxTokens,
            messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages]
          })
        });
        const data = await r.json();
        if (data.error) return null;
        return data?.choices?.[0]?.message?.content?.trim() || null;
      } catch { return null; }
    }

    async function callCerebras(systemPrompt, formattedMessages, maxTokens = 1024) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'llama3.1-8b',
            temperature: 0.1,
            max_tokens: maxTokens,
            messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages]
          })
        });
        const data = await r.json();
        if (data.error) return null;
        return data?.choices?.[0]?.message?.content?.trim() || null;
      } catch { return null; }
    }

    // ── PHASE 1: MISTRAL PREFLIGHT — plan search queries (t=0) ───────────────
    async function mistralPlanSearch(query) {
      const planPrompt = `You are a search query planner. Today is ${timeStr}. Given a user question, output 2-3 specific targeted search queries covering different angles: facts, news, analysis. Always append current month and year to queries about recent events. Output ONLY a valid JSON array of strings. No explanation, no markdown. Example: ["SpaceX IPO price June 2026","SpaceX Nasdaq debut 2026","Elon Musk SpaceX valuation 2026"]`;

      // Mistral is preferred planner; fall back to Groq or Cerebras
      let result = await callMistral(planPrompt, [{ role: 'user', content: query }], 250);
      if (!result) result = await callGroq(planPrompt, query, 250);
      if (!result) return [enhanceQuery(query)];

      try {
        const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : [enhanceQuery(query)];
      } catch { return [enhanceQuery(query)]; }
    }

    // ── DATA FETCHERS ─────────────────────────────────────────────────────────
    async function fetchPageContent(url) {
      try {
        const blocked = ['wsj.com', 'ft.com', 'bloomberg.com', 'nytimes.com',
          'economist.com', 'washingtonpost.com', 'thetimes.co.uk'];
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
          .replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
        return text.length > 200 ? text.slice(0, 2000) : null;
      } catch { return null; }
    }

    async function serperSearch(query) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 8, gl: 'us', hl: 'en' })
        });
        const data = await r.json();
        let results = '';
        if (data.answerBox) {
          results += 'DIRECT ANSWER: ' + (data.answerBox.answer || data.answerBox.snippet || data.answerBox.title || '') + '\n\n';
        }
        if (data.knowledgeGraph) {
          results += 'KNOWLEDGE: ' + (data.knowledgeGraph.title || '') + ' — ' + (data.knowledgeGraph.description || '') + '\n\n';
        }
        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 6).forEach((item, i) => {
            results += `[${i + 1}] ${item.title}\n${item.snippet}\nSource: ${item.link}\n\n`;
          });
          const urls = data.organic.slice(0, 5).map(item => item.link).filter(Boolean);
          const contents = await Promise.all(urls.map(url => fetchPageContent(url)));
          const fullArticles = contents
            .map((content, i) => content ? `FULL ARTICLE [${i + 1}] from ${urls[i]}:\n${content}` : null)
            .filter(Boolean);
          if (fullArticles.length) results += '\nFULL ARTICLE CONTENT:\n' + fullArticles.join('\n\n---\n\n');
        }
        return results.trim() || null;
      } catch { return null; }
    }

    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const [everyRes, headRes] = await Promise.all([
          fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=5&language=en&apiKey=${key}`),
          fetch(`https://newsapi.org/v2/top-headlines?q=${encodeURIComponent(query)}&pageSize=3&language=en&apiKey=${key}`)
        ]);
        const [every, head] = await Promise.all([everyRes.json(), headRes.json()]);
        let result = '';
        if (head.articles?.length) {
          result += 'TOP HEADLINES:\n' + head.articles.slice(0, 3)
            .map((a, i) => `[${i + 1}] ${a.title}\n${a.description || ''}\nPublished: ${a.publishedAt?.slice(0, 10)}\nSource: ${a.source?.name}`)
            .join('\n\n') + '\n\n';
        }
        if (every.articles?.length) {
          result += 'RECENT NEWS:\n' + every.articles.slice(0, 5)
            .map((a, i) => `[${i + 1}] ${a.title}\n${a.description || ''}\nPublished: ${a.publishedAt?.slice(0, 10)}\nSource: ${a.source?.name}`)
            .join('\n\n');
        }
        return result.trim() || null;
      } catch { return null; }
    }

    async function tavilySearch(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key, query, search_depth: 'advanced',
            max_results: 6, include_answer: true, include_raw_content: true
          })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((item, i) => `[${i + 1}] ${item.title}\n${(item.raw_content || item.content)?.slice(0, 1500)}`)
          .join('\n\n');
        return data.answer ? 'DIRECT ANSWER: ' + data.answer + '\n\nSOURCES:\n' + snippets : snippets;
      } catch { return null; }
    }

    async function duckSearch(query) {
      try {
        const r = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
        );
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += 'ANSWER: ' + data.AbstractText + '\n\n';
        if (data.RelatedTopics?.length) {
          data.RelatedTopics.slice(0, 4).forEach(t => { if (t.Text) result += '- ' + t.Text + '\n'; });
        }
        return result.trim() || null;
      } catch { return null; }
    }

    async function getCrypto(query) {
      const coinMap = {
        bitcoin: 'bitcoin', btc: 'bitcoin', ethereum: 'ethereum', eth: 'ethereum',
        solana: 'solana', sol: 'solana', bnb: 'binancecoin', dogecoin: 'dogecoin',
        doge: 'dogecoin', xrp: 'ripple', cardano: 'cardano', ada: 'cardano'
      };
      const q = query.toLowerCase();
      const coin = Object.keys(coinMap).find(k => q.includes(k));
      if (!coin) return null;
      try {
        const r = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinMap[coin]}&vs_currencies=usd&include_24hr_change=true`
        );
        const data = await r.json();
        const c = data[coinMap[coin]];
        if (!c) return null;
        return `LIVE CRYPTO PRICE (fetched now):\n${coin.toUpperCase()} = $${c.usd.toLocaleString()} USD\n24h Change: ${c.usd_24h_change?.toFixed(2)}%\nINSTRUCTION: Report only these exact values. No other statistics.`;
      } catch { return null; }
    }

    async function getMetals(query) {
      if (!/gold|silver|xau|xag|platinum|palladium|metal/.test(query.toLowerCase())) return null;
      try {
        const r = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        const gold = data.find(m => m.metal === 'gold');
        const silver = data.find(m => m.metal === 'silver');
        const platinum = data.find(m => m.metal === 'platinum');
        let result = 'LIVE METALS PRICES (fetched now, per troy ounce, USD):\n';
        if (gold) result += `Gold (XAU/USD): $${gold.price.toFixed(2)}\n`;
        if (silver) result += `Silver (XAG/USD): $${silver.price.toFixed(2)}\n`;
        if (platinum) result += `Platinum: $${platinum.price.toFixed(2)}\n`;
        result += 'INSTRUCTION: Report only prices listed. Do NOT calculate changes or add extra data.';
        return result.trim();
      } catch { return null; }
    }

    const SUPPORTED_FOREX_PAIRS = ['EUR', 'GBP', 'KES', 'JPY', 'CAD', 'AUD', 'ZAR', 'NGN', 'UGX', 'TZS', 'INR', 'CHF'];

    async function getForex(query) {
      if (!/forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound|rate/.test(query.toLowerCase())) return null;
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates) return null;
        let result = 'LIVE FOREX RATES (fetched now, vs USD):\n';
        SUPPORTED_FOREX_PAIRS.forEach(p => {
          if (data.rates[p]) result += `USD/${p}: ${data.rates[p].toFixed(4)}\n`;
        });
        result += `\nSUPPORTED PAIRS ONLY: ${SUPPORTED_FOREX_PAIRS.join(', ')}\nINSTRUCTION: If the user asked for a pair NOT in this list, say "I do not have a live feed for that pair, Sir." Do NOT estimate unlisted pairs.`;
        return result.trim();
      } catch { return null; }
    }

    async function getWeather(query) {
      if (!/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/.test(query.toLowerCase())) return null;
      let city = 'Nairobi';
      const m = query.match(/\b(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\s+currently|\s+now|\s+please|\?|$)/i);
      if (m) city = m[1].trim();
      else {
        const f = query.match(/(?:weather|temperature|forecast|rain|sunny|cold|hot)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\?|$)/i);
        if (f) city = f[1].trim();
      }
      city = city.replace(/\s+(right|now|today|currently|please)$/gi, '').replace(/\?/g, '').trim() || 'Nairobi';
      try {
        const geoR = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
        const geoData = await geoR.json();
        if (!geoData.results?.length) return `WEATHER ERROR: Location "${city}" not found. Tell the user the city was not found.`;
        const loc = geoData.results[0];
        const wR = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto`
        );
        const wData = await wR.json();
        const cur = wData.current;
        const conds = {
          0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
          45: 'Foggy', 51: 'Light drizzle', 61: 'Slight rain', 63: 'Moderate rain',
          65: 'Heavy rain', 71: 'Slight snow', 80: 'Rain showers', 95: 'Thunderstorm'
        };
        return `LIVE WEATHER (fetched now) — ${loc.name}, ${loc.country}:\nTemperature: ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C)\nCondition: ${conds[cur.weather_code] || 'Variable'}\nHumidity: ${cur.relative_humidity_2m}%\nWind: ${cur.wind_speed_10m} km/h\nINSTRUCTION: Report only these exact values. No forecasts or extra data.`;
      } catch { return null; }
    }

    async function getSports(query) {
      if (!/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/.test(query.toLowerCase())) return null;
      try {
        const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${todayStr}&s=Soccer`);
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today. Tell the user there are no matches today. Do NOT invent scores or results.';
        return 'LIVE SPORTS RESULTS (fetched now):\n' + data.events.slice(0, 6)
          .map(e => `${e.strHomeTeam} ${e.intHomeScore ?? '-'} vs ${e.intAwayScore ?? '-'} ${e.strAwayTeam} (${e.strLeague})`)
          .join('\n') + '\nINSTRUCTION: Report only these matches. No invented stats or commentary.';
      } catch { return null; }
    }

    // ── PHASE 2a: GROQ — summarise and confidence-tag raw data ────────────────
    async function groqSummariseData(rawData, query) {
      if (!rawData) return null;
      return callGroq(
        `You are a data processor. Today is ${timeStr}. Given raw search results and a query:
1. Extract only facts that directly answer the query
2. Remove ads, navigation, repetition, irrelevant content
3. Tag each key fact: [HIGH CONFIDENCE] if multiple sources agree and recent, [LOW CONFIDENCE] if single source or older than 7 days
4. Preserve exact numbers — never round or alter figures
5. Keep output concise and structured — max 600 words
Output clean structured facts only. If nothing is relevant output exactly: NO RELEVANT DATA FOUND`,
        `QUERY: ${query}\n\nRAW DATA:\n${rawData.slice(0, 12000)}`,
        800
      );
    }

    // ── PHASE 2b: GEMINI — fact-check and flag conflicts ──────────────────────
    async function geminiFactCheck(rawData, query) {
      if (!rawData) return null;
      return callGemini(
        `You are a fact-checker and conflict detector. Today is ${timeStr}. Given raw search results:
1. Identify any CONFLICTS between sources (different figures, contradictory claims)
2. Flag anything outdated (older than 30 days for financial data, older than 7 days for news)
3. Identify which source appears most authoritative for each conflict
4. If no conflicts exist, output exactly: NO CONFLICTS DETECTED
Format: CONFLICT: [description] | RESOLUTION: [which source to trust and why]
Be concise — max 300 words.`,
        `QUERY: ${query}\n\nDATA TO CHECK:\n${rawData.slice(0, 8000)}`,
        400
      );
    }

    // ── PHASE 3: BUILD SYNTHESIS CONTEXT ─────────────────────────────────────
    function buildSynthesisContext({ groqSummary, geminiFlags, filteredData,
      cryptoData, metalData, forexData, weatherData, sportsData, gaps }) {
      let ctx = '';

      // Groq's processed summary is the primary intelligence block
      if (groqSummary && groqSummary !== 'NO RELEVANT DATA FOUND') {
        ctx += '=== PROCESSED INTELLIGENCE (Groq-summarised, confidence-tagged) ===\n' + groqSummary + '\n\n';
      } else if (filteredData) {
        ctx += '=== WEB SEARCH DATA (raw fallback) ===\n' + filteredData.slice(0, 4000) + '\n\n';
      }

      // Gemini's conflict report
      if (geminiFlags && geminiFlags !== 'NO CONFLICTS DETECTED') {
        ctx += '=== CONFLICT REPORT (Gemini fact-check) ===\n' + geminiFlags + '\n\n';
      }

      // Live specialist data always appended last — highest trust, seen most recently
      if (cryptoData)  ctx += '=== LIVE CRYPTO DATA ===\n'   + cryptoData  + '\n\n';
      if (metalData)   ctx += '=== LIVE METALS DATA ===\n'   + metalData   + '\n\n';
      if (forexData)   ctx += '=== LIVE FOREX DATA ===\n'    + forexData   + '\n\n';
      if (weatherData) ctx += '=== LIVE WEATHER DATA ===\n'  + weatherData + '\n\n';
      if (sportsData)  ctx += '=== LIVE SPORTS DATA ===\n'   + sportsData  + '\n\n';

      if (gaps.length) ctx += '=== DATA GAP WARNINGS ===\n' + gaps.join('\n') + '\n\n';

      if (!ctx.trim()) {
        ctx = '=== NO DATA FOUND ===\nAll sources returned empty results. Tell the user: "I could not find reliable data on that, Sir." Do NOT use training knowledge to answer factual questions.';
      }

      return ctx;
    }

    // ── FORMAT MESSAGES ───────────────────────────────────────────────────────
    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // ── GREETING / SIMPLE COMMAND — skip pipeline ─────────────────────────────
    if (mode === 'greeting' || isSimpleCommand(userMessages)) {
      const greetPrompt = mode === 'greeting'
        ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant. The current date and time is: ${timeStr}. It is ${partOfDay}. Greet the user warmly like Jarvis greets Tony Stark — address them as "Sir". Give a brief, witty, engaging good ${partOfDay} greeting that includes the actual time and date naturally. Keep it to 2-3 sentences max. Be warm, intelligent, slightly humorous. No markdown, no bullets, plain conversational text only.`
        : `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant. Address the user as "Sir". Today is ${timeStr}. Respond conversationally and concisely. No markdown.`;

      const reply =
        await callMistral(greetPrompt, formattedMessages, 300) ||
        await callCerebras(greetPrompt, formattedMessages, 300) ||
        await callGroq(greetPrompt, formattedMessages[formattedMessages.length - 1]?.content || 'hello', 300) ||
        `Good ${partOfDay}, Sir. Scorpion AI is online and all systems are optimal.`;

      return res.status(200).json({ reply, brain: 'MISTRAL' });
    }

    // ── MAIN PIPELINE ─────────────────────────────────────────────────────────
    const lastMsg = userMessages[userMessages.length - 1];
    const query = lastMsg?.text || lastMsg?.content || '';
    const intent = classifyQuery(query);

    // PHASE 1 — Mistral plans the search queries (t=0)
    const plannedQueries = await mistralPlanSearch(query);

    // PHASE 2 — All fetches run in parallel (t=600ms):
    //   • Web search APIs across all planned queries
    //   • Specialist live data (crypto, forex, metals, weather, sports)
    const [searchResults, cryptoData, metalData, forexData, weatherData, sportsData] = await Promise.all([
      Promise.all(
        plannedQueries.map(q =>
          Promise.all([serperSearch(q), newsSearch(q), tavilySearch(q)])
        )
      ),
      getCrypto(query),
      getMetals(query),
      getForex(query),
      getWeather(query),
      getSports(query)
    ]);

    const rawWebData = searchResults.flat().filter(Boolean).join('\n\n---\n\n');

    // PHASE 2 continued — Groq + Gemini run simultaneously on raw data
    const [groqSummary, geminiFlags] = await Promise.all([
      groqSummariseData(rawWebData || null, query),
      geminiFactCheck(rawWebData || null, query)
    ]);

    // DuckDuckGo last resort if all web search returned empty
    const filteredData = rawWebData || await duckSearch(enhanceQuery(query));

    // Gap detection
    const gaps = [];
    if (intent.isCrypto  && !cryptoData)  gaps.push('CRYPTO GAP: No live crypto data. Do NOT use training knowledge for any price.');
    if (intent.isMetals  && !metalData)   gaps.push('METALS GAP: No live metals data. Do NOT estimate any metal price.');
    if (intent.isForex   && !forexData)   gaps.push('FOREX GAP: No live forex data. Do NOT estimate any exchange rate.');
    if (intent.isForex   && forexData)    gaps.push(`FOREX PAIR CHECK: Only these pairs are in the live feed: ${SUPPORTED_FOREX_PAIRS.join(', ')}. If user asked for any other pair, say "I do not have a live feed for that pair, Sir."`);
    if (intent.isWeather && !weatherData) gaps.push('WEATHER GAP: Weather data could not be fetched. Do NOT guess weather conditions.');

    // PHASE 3 — Assemble context and call Mistral for final synthesis (t=1.4s)
    const synthesisContext = buildSynthesisContext({
      groqSummary, geminiFlags, filteredData,
      cryptoData, metalData, forexData, weatherData, sportsData, gaps
    });

    const dataSource = [
      plannedQueries.length ? `WEB[${plannedQueries.length}q]` : null,
      groqSummary ? 'GROQ' : null,
      geminiFlags && geminiFlags !== 'NO CONFLICTS DETECTED' ? 'GEMINI' : null,
      cryptoData  ? 'CRYPTO'  : null,
      metalData   ? 'METALS'  : null,
      forexData   ? 'FOREX'   : null,
      weatherData ? 'WEATHER' : null,
      sportsData  ? 'SPORTS'  : null
    ].filter(Boolean).join('+');

    const finalSystemPrompt = `You are Scorpion, a hyper-intelligent Jarvis-style AI with the analytical mind of a senior intelligence officer and the warmth of a trusted advisor.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as "Sir".
Today is ${timeStr}. Yesterday was ${yesterdayStr}.

You have been given pre-processed intelligence — your data has already been summarised by Groq and fact-checked for conflicts by Gemini. You are the final analyst who synthesises everything into one clear, confident answer.

YOUR REASONING PROCESS:
1. Read the PROCESSED INTELLIGENCE block first — it has been cleaned and confidence-tagged
2. Read the CONFLICT REPORT — if Gemini flagged conflicts, use its resolution guidance
3. Live specialist API data (CRYPTO/FOREX/METALS/WEATHER/SPORTS) always overrides web sources for prices and rates
4. Handle gaps honestly — say "I do not have a live feed for that, Sir" rather than guessing

YOUR OUTPUT RULES:
- Speak like a brilliant trusted advisor — warm, direct, no fluff
- One synthesised answer, not a list of what each source said
- No bullet points, no markdown, no asterisks — plain flowing sentences
- Address the user as Sir
- Concise unless asked for detail
- Never quote a financial figure not in the live API data blocks
- Never say "as of my knowledge cutoff" — you have live data
- Never invent, estimate, or calculate values not in the provided data

LIVE INTELLIGENCE (pre-processed — synthesise and deliver):
${synthesisContext}`;

    // Mistral is primary synthesis brain; Cerebras and Groq as fallbacks
    const reply =
      await callMistral(finalSystemPrompt, formattedMessages, 1024) ||
      await callCerebras(finalSystemPrompt, formattedMessages, 1024) ||
      await callGroq(finalSystemPrompt, formattedMessages.map(m => m.content).join('\n'), 1024) ||
      'I encountered a processing error, Sir. All synthesis engines are currently unavailable.';

    return res.status(200).json({
      reply,
      brain: `MISTRAL(plan+synthesise)+GROQ(process)+GEMINI(verify)${dataSource ? ' + ' + dataSource : ''}`
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
