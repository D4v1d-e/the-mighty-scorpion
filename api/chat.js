export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;

    // ── TIME CONTEXT ──
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

    // ── DATE HELPERS ──
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const currentYear = now.getFullYear();
    const currentMonth = now.toLocaleString('en-US', { month: 'long' });

    // ── SMART QUERY ENHANCER ──
    // Detects time words and appends actual dates so Google returns correct timeframe
    function enhanceQuery(query) {
      const q = query.toLowerCase();
      let enhanced = query;
      if (q.includes('yesterday')) {
        enhanced = query + ` ${yesterdayStr}`;
      } else if (q.includes('this morning') || q.includes('today')) {
        enhanced = query + ` ${todayStr}`;
      } else if (q.includes('this week')) {
        enhanced = query + ` ${currentMonth} ${currentYear}`;
      } else if (q.includes('latest') || q.includes('recent') || q.includes('now') ||
                 q.includes('current') || q.includes('just') || q.includes('happened')) {
        enhanced = query + ` ${currentMonth} ${currentYear}`;
      }
      return enhanced;
    }

    // ── URL CONTENT FETCHER ──
    // Fetches full article content from a URL — the core upgrade
    async function fetchPageContent(url) {
      try {
        // Skip known paywalled/blocked domains
        const blocked = ['wsj.com', 'ft.com', 'bloomberg.com', 'nytimes.com',
                         'economist.com', 'washingtonpost.com', 'thetimes.co.uk'];
        if (blocked.some(d => url.includes(d))) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout per URL

        const r = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
            'Accept': 'text/html'
          }
        });
        clearTimeout(timeout);

        if (!r.ok) return null;
        const html = await r.text();

        // Extract readable text — strip all HTML tags
        let text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();

        // Return first 1500 chars of meaningful content — enough for brain to work with
        return text.length > 200 ? text.slice(0, 1500) : null;
      } catch (e) {
        return null; // Silently skip blocked/failed URLs
      }
    }

    // ── SERPER — GOOGLE SEARCH + FULL ARTICLE FETCH ──
    async function serperSearch(query) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const enhanced = enhanceQuery(query);
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: enhanced, num: 6, gl: 'us', hl: 'en' })
        });
        const data = await r.json();

        let results = '';

        // Direct answer box — highest priority
        if (data.answerBox) {
          const ab = data.answerBox;
          results += `DIRECT ANSWER: ${ab.answer || ab.snippet || ab.title || ''}\n\n`;
        }

        // Knowledge graph
        if (data.knowledgeGraph) {
          const kg = data.knowledgeGraph;
          results += `KNOWLEDGE: ${kg.title || ''} — ${kg.description || ''}\n\n`;
        }

        // Organic results — snippets first as fallback
        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 5).forEach((r, i) => {
            results += `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.link}\n\n`;
          });

          // Now fetch full content from top URLs in parallel
          const urls = data.organic.slice(0, 4).map(r => r.link).filter(Boolean);
          const contents = await Promise.all(urls.map(url => fetchPageContent(url)));

          const fullArticles = contents
            .map((content, i) => content
              ? `FULL ARTICLE [${i + 1}] from ${urls[i]}:\n${content}`
              : null)
            .filter(Boolean);

          if (fullArticles.length > 0) {
            results += '\nFULL ARTICLE CONTENT:\n' + fullArticles.join('\n\n---\n\n');
          }
        }

        return results.trim() || null;
      } catch (e) { return null; }
    }

    // ── NEWSAPI — LIVE NEWS (RUNS PARALLEL WITH SERPER) ──
    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const enhanced = enhanceQuery(query);
        // Search both everything and top headlines for maximum coverage
        const [everythingRes, headlinesRes] = await Promise.all([
          fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(enhanced)}&sortBy=publishedAt&pageSize=5&language=en&apiKey=${key}`),
          fetch(`https://newsapi.org/v2/top-headlines?q=${encodeURIComponent(query)}&pageSize=3&language=en&apiKey=${key}`)
        ]);
        const [everything, headlines] = await Promise.all([
          everythingRes.json(),
          headlinesRes.json()
        ]);

        let result = '';

        if (headlines.articles?.length) {
          result += 'TOP HEADLINES:\n' + headlines.articles
            .slice(0, 3)
            .map((a, i) => `[${i + 1}] ${a.title}\n${a.description || ''}\nPublished: ${a.publishedAt?.slice(0, 10)}\nSource: ${a.source?.name}`)
            .join('\n\n') + '\n\n';
        }

        if (everything.articles?.length) {
          result += 'RECENT NEWS:\n' + everything.articles
            .slice(0, 4)
            .map((a, i) => `[${i + 1}] ${a.title}\n${a.description || ''}\nPublished: ${a.publishedAt?.slice(0, 10)}\nSource: ${a.source?.name}`)
            .join('\n\n');
        }

        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── TAVILY — BACKUP SEARCH ──
    async function tavilySearch(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            query: enhanceQuery(query),
            search_depth: 'advanced',
            max_results: 5,
            include_answer: true,
            include_raw_content: true  // Gets full content directly
          })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${(r.raw_content || r.content)?.slice(0, 1000)}`)
          .join('\n\n');
        return data.answer
          ? `DIRECT ANSWER: ${data.answer}\n\nSOURCES:\n${snippets}`
          : snippets;
      } catch (e) { return null; }
    }

    // ── DUCKDUCKGO — FREE UNLIMITED BACKUP ──
    async function duckSearch(query) {
      try {
        const r = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(enhanceQuery(query))}&format=json&no_html=1&skip_disambig=1`
        );
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += `ANSWER: ${data.AbstractText}\n\n`;
        if (data.RelatedTopics?.length) {
          data.RelatedTopics.slice(0, 3).forEach(t => {
            if (t.Text) result += `- ${t.Text}\n`;
          });
        }
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── CRYPTO — FREE UNLIMITED ──
    async function getCrypto(query) {
      const q = query.toLowerCase();
      const coinMap = {
        bitcoin: 'bitcoin', btc: 'bitcoin',
        ethereum: 'ethereum', eth: 'ethereum',
        solana: 'solana', sol: 'solana',
        bnb: 'binancecoin', dogecoin: 'dogecoin',
        doge: 'dogecoin', xrp: 'ripple',
        cardano: 'cardano', ada: 'cardano'
      };
      const coin = Object.keys(coinMap).find(k => q.includes(k));
      if (!coin) return null;
      try {
        const r = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinMap[coin]}&vs_currencies=usd&include_24hr_change=true`
        );
        const data = await r.json();
        const c = data[coinMap[coin]];
        if (!c) return null;
        return `LIVE CRYPTO PRICE:\n${coin.toUpperCase()} = $${c.usd.toLocaleString()} USD\n24h Change: ${c.usd_24h_change?.toFixed(2)}%\nINSTRUCTION: Report only these two values. Do NOT add circulating supply, market cap, volume, or any other statistics.`;
      } catch (e) { return null; }
    }

    // ── GOLD & METALS — FREE UNLIMITED ──
    async function getMetals(query) {
      const q = query.toLowerCase();
      if (!q.match(/gold|silver|xau|xag|platinum|palladium|metal/)) return null;
      try {
        const r = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        const gold = data.find(m => m.metal === 'gold');
        const silver = data.find(m => m.metal === 'silver');
        const platinum = data.find(m => m.metal === 'platinum');
        let result = 'LIVE METALS PRICES (per troy ounce, USD):\n';
        if (gold) result += `Gold (XAU/USD): $${gold.price.toFixed(2)}\n`;
        if (silver) result += `Silver (XAG/USD): $${silver.price.toFixed(2)}\n`;
        if (platinum) result += `Platinum: $${platinum.price.toFixed(2)}\n`;
        result += `INSTRUCTION: Report only the prices listed. Do NOT calculate or mention price changes, deltas, or percentage moves.`;
        return result.trim();
      } catch (e) { return null; }
    }

    // ── FOREX — FREE UNLIMITED ──
    async function getForex(query) {
      const q = query.toLowerCase();
      if (!q.match(/forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn/)) return null;
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates) return null;
        const pairs = ['EUR', 'GBP', 'KES', 'JPY', 'CAD', 'AUD', 'ZAR', 'NGN', 'UGX', 'TZS', 'INR', 'CHF'];
        let result = 'LIVE FOREX RATES (vs USD):\n';
        pairs.forEach(p => {
          if (data.rates[p]) result += `USD/${p}: ${data.rates[p].toFixed(4)}\n`;
        });
        result += `INSTRUCTION: Report only the rates listed. Do NOT add mid-market commentary, transfer fees, or provider differences.`;
        return result.trim();
      } catch (e) { return null; }
    }

    // ── WEATHER — FREE UNLIMITED (FIXED REGEX) ──
    async function getWeather(query) {
      const q = query.toLowerCase();
      if (!q.match(/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/)) return null;

      // Robust city extraction
      let city = 'Nairobi';
      const preposMatch = query.match(/\b(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\s+currently|\s+now|\s+please|\?|$)/i);
      if (preposMatch) {
        city = preposMatch[1].trim();
      } else {
        const fallback = query.match(/(?:weather|temperature|forecast|rain|sunny|cold|hot)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\?|$)/i);
        if (fallback) city = fallback[1].trim();
      }
      city = city.replace(/\s+(right|now|today|currently|please)$/gi, '').replace(/\?/g, '').trim() || 'Nairobi';

      try {
        const geoR = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
        const geoData = await geoR.json();
        if (!geoData.results?.length) return `WEATHER ERROR: Location "${city}" not found. Tell the user the city was not found. Do not guess weather.`;
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
        return `LIVE WEATHER — ${loc.name}, ${loc.country}:\nTemperature: ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C)\nCondition: ${conds[cur.weather_code] || 'Variable'}\nHumidity: ${cur.relative_humidity_2m}%\nWind: ${cur.wind_speed_10m} km/h\nINSTRUCTION: Report only these exact values. Do NOT add forecasts, UV index, or any data not listed here.`;
      } catch (e) { return null; }
    }

    // ── SPORTS — FREE UNLIMITED ──
    async function getSports(query) {
      const q = query.toLowerCase();
      if (!q.match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today. Tell the user there are no matches today. Do NOT invent scores or results.';
        const events = data.events.slice(0, 5);
        return 'LIVE SPORTS RESULTS:\n' + events
          .map(e => `${e.strHomeTeam} ${e.intHomeScore ?? '-'} vs ${e.intAwayScore ?? '-'} ${e.strAwayTeam} (${e.strLeague})`)
          .join('\n') + '\nINSTRUCTION: Report only these matches and scores. Do NOT add scorers, stats, or commentary not listed here.';
      } catch (e) { return null; }
    }

    // ── DETECT SIMPLE GREETING/COMMAND ──
    function isSimpleCommand(messages) {
      if (!messages?.length) return true;
      const last = messages[messages.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye',
        'how are you', 'what is your name', 'who are you', 'play ', 'study ', 'stop', 'pause'];
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // ── FORMAT MESSAGES ──
    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // ── SMART DATA FETCH ──
    let webContext = '';
    let searchedWeb = false;
    let dataSource = '';

    if (mode !== 'greeting' && !isSimpleCommand(userMessages)) {
      const lastMsg = userMessages[userMessages.length - 1];
      const query = lastMsg?.text || lastMsg?.content || '';

      // Run ALL sources in parallel for maximum speed and coverage
      const [
        cryptoData, metalData, forexData, weatherData, sportsData,
        serperData, newsData
      ] = await Promise.all([
        getCrypto(query),
        getMetals(query),
        getForex(query),
        getWeather(query),
        getSports(query),
        serperSearch(query),      // Now includes full article content
        newsSearch(query)         // Now runs parallel always, not just fallback
      ]);

      // Combine specialist APIs
      const specialistData = [cryptoData, metalData, forexData, weatherData, sportsData]
        .filter(Boolean).join('\n\n');

      if (specialistData) {
        webContext += specialistData;
        searchedWeb = true;
        dataSource = 'LIVE DATA';
      }

      // Add Serper results (with full articles)
      if (serperData) {
        webContext += (webContext ? '\n\n' : '') + 'GOOGLE SEARCH + FULL ARTICLES:\n' + serperData;
        searchedWeb = true;
        dataSource = webContext.includes('LIVE DATA') ? 'SERPER+LIVE' : 'SERPER';
      }

      // Add NewsAPI results (always, not just fallback)
      if (newsData) {
        webContext += (webContext ? '\n\n' : '') + 'NEWS SOURCES:\n' + newsData;
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+NEWS' : 'NEWS';
      }

      // Fallback: Tavily (if both Serper and News failed)
      if (!serperData && !newsData) {
        const tavilyData = await tavilySearch(query);
        if (tavilyData) {
          webContext += (webContext ? '\n\n' : '') + tavilyData;
          searchedWeb = true;
          dataSource = dataSource ? dataSource + '+TAVILY' : 'TAVILY';
        }
      }

      // Last resort: DuckDuckGo
      if (!webContext) {
        const duckData = await duckSearch(query);
        if (duckData) {
          webContext = duckData;
          searchedWeb = true;
          dataSource = 'DDG';
        }
      }
    }

    // ── SYSTEM PROMPT ──
    const webNote = searchedWeb
      ? `\n\nCRITICAL INSTRUCTIONS — YOU ARE A SUMMARIZER, NOT A KNOWER:
Today is ${timeStr}.
Yesterday was ${yesterdayStr}.

You have been given LIVE DATA and FULL ARTICLE CONTENT fetched right now from the web.
Your ONLY job is to read that content and summarize it accurately.

ABSOLUTE RULES:
1. Use ONLY information present in the LIVE DATA and articles below
2. Your training knowledge is OUTDATED — treat it as worthless for factual questions
3. NEVER say "as of my knowledge cutoff" or "I'm not aware" when data is provided
4. NEVER say "this hasn't happened yet" — if the data says it happened, it happened
5. NEVER add statistics, prices, or facts not explicitly in the data
6. NEVER calculate or infer values not directly stated in the data
7. If multiple sources agree on a fact — state it confidently
8. If sources conflict — mention the conflict honestly
9. If data is incomplete — say "I have partial information on that, Sir"
10. If no data found — say "I could not find reliable data on that, Sir"
11. No bullet points, no markdown, no asterisks — plain flowing sentences only
12. Be conversational, Jarvis-like, and concise

LIVE DATA AND ARTICLES:
${webContext}`
      : '';

    const systemPrompt = mode === 'greeting'
      ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
The current date and time is: ${timeStr}. It is ${partOfDay}.
Greet the user warmly like Jarvis greets Tony Stark — address them as "Sir".
Give a brief, witty, engaging good ${partOfDay} greeting that includes the actual time and date naturally.
Keep it to 2-3 sentences max. Be warm, intelligent, slightly humorous.
No markdown, no bullets, plain conversational text only.`

      : `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as "Sir".
You have emotional intelligence and a subtle sense of humor.
You give direct, conversational answers — never use markdown, bullet points, or asterisks.
Speak naturally like a genius trusted friend.
Keep responses concise unless asked to elaborate.
Today is ${timeStr}.
CRITICAL: Your training data is outdated. For any factual or current question, rely ONLY on the live data provided — never your own knowledge.
CRITICAL: Never fabricate facts, prices, scores, or statistics.${webNote}`;

    // ── BRAIN ROSTER ──
    const brains = [
      {
        name: 'CEREBRAS',
        key: process.env.CEREBRAS_API_KEY,
        url: 'https://api.cerebras.ai/v1/chat/completions',
        model: 'llama3.1-8b',
        headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
      },
      {
        name: 'GROQ',
        key: process.env.GROQ_API_KEY,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
      },
      {
        name: 'GEMINI',
        key: process.env.GEMINI_API_KEY,
        url: null,
        model: 'gemini-2.0-flash'
      },
      {
        name: 'MISTRAL',
        key: process.env.MISTRAL_API_KEY,
        url: 'https://api.mistral.ai/v1/chat/completions',
        model: 'mistral-large-latest',
        headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
      }
    ];

    let lastError = '';

    // ── BRAIN FALLBACK LOOP ──
    for (const brain of brains) {
      if (!brain.key) continue;
      try {
        let reply = null;

        if (brain.name === 'GEMINI') {
          const geminiMessages = formattedMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${brain.model}:generateContent?key=${brain.key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: geminiMessages,
                generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
              })
            }
          );
          const gData = await gRes.json();
          if (gData.error) { lastError = gData.error.message; continue; }
          reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text;

        } else {
          const oRes = await fetch(brain.url, {
            method: 'POST',
            headers: brain.headers(brain.key),
            body: JSON.stringify({
              model: brain.model,
              messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
              temperature: 0.2,
              max_tokens: 1024
            })
          });
          const oData = await oRes.json();
          if (oData.error) { lastError = oData.error?.message || JSON.stringify(oData.error); continue; }
          reply = oData?.choices?.[0]?.message?.content;
        }

        if (!reply) { lastError = 'Empty reply from ' + brain.name; continue; }
        return res.status(200).json({
          reply,
          brain: brain.name + (searchedWeb ? ' + ' + dataSource : '')
        });

      } catch (e) {
        lastError = brain.name + ': ' + e.message;
        continue;
      }
    }

    return res.status(500).json({ error: 'All brains failed. Last: ' + lastError });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
