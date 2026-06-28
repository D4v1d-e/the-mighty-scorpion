export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;

    // TIME CONTEXT
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

    // DATE HELPERS
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const currentYear = now.getFullYear();
    const currentMonth = now.toLocaleString('en-US', { month: 'long' });

    // QUERY CLASSIFIER
    function classifyQuery(query) {
      const q = query.toLowerCase();
      return {
        isCrypto: /bitcoin|btc|ethereum|eth|solana|sol|bnb|dogecoin|doge|xrp|cardano|ada|crypto|coin/.test(q),
        isForex: /forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound/.test(q),
        isMetals: /gold|silver|xau|xag|platinum|palladium|metal/.test(q),
        isWeather: /weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/.test(q),
        isSports: /football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/.test(q),
        isFinancial: /rate|exchange|currency|price|convert|worth|cost|how much|value|market|stock|share|trading/.test(q),
        isNews: /news|happened|latest|today|yesterday|this week|breaking|announced|said|reported/.test(q)
      };
    }

    // SMART QUERY ENHANCER
    function enhanceQuery(query) {
      const q = query.toLowerCase();
      let enhanced = query;
      if (q.includes('yesterday')) {
        enhanced = query + ' ' + yesterdayStr;
      } else if (q.includes('this morning') || q.includes('today')) {
        enhanced = query + ' ' + todayStr;
      } else if (q.includes('this week')) {
        enhanced = query + ' ' + currentMonth + ' ' + currentYear;
      } else if (q.includes('latest') || q.includes('recent') || q.includes('now') ||
                 q.includes('current') || q.includes('just') || q.includes('happened')) {
        enhanced = query + ' ' + currentMonth + ' ' + currentYear;
      }
      return enhanced;
    }

    // SEARCH PLANNER — brain decides what to search for
    // Breaks a vague user query into 2-3 precise targeted searches
    async function planSearch(query) {
      const key = process.env.GROQ_API_KEY || process.env.CEREBRAS_API_KEY;
      if (!key) return [enhanceQuery(query)];
      const url = process.env.GROQ_API_KEY
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.cerebras.ai/v1/chat/completions';
      const model = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'llama3.1-8b';
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 200,
            messages: [
              {
                role: 'system',
                content: 'You are a search query planner. Today is ' + timeStr + '. Given a user question, output 2-3 specific targeted search queries that would find the most accurate and current information. Each query should target a different angle — facts, news, analysis. Always append current month and year to queries about recent events. Output ONLY a valid JSON array of strings. No explanation, no markdown. Example: ["SpaceX IPO price June 2026","SpaceX SPCX Nasdaq debut","Elon Musk trillionaire 2026"]'
              },
              { role: 'user', content: query }
            ]
          })
        });
        const data = await r.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        const cleaned = text?.replace(/```json|```/g, '').trim();
        const queries = JSON.parse(cleaned);
        return Array.isArray(queries) && queries.length > 0 ? queries : [enhanceQuery(query)];
      } catch (e) {
        return [enhanceQuery(query)];
      }
    }

    // CONFIDENCE FILTER — scores and cleans raw search data before brain sees it
    // Extracts only relevant facts, tags confidence level, removes noise
    async function scoreAndFilter(rawData, query) {
      const key = process.env.GROQ_API_KEY || process.env.CEREBRAS_API_KEY;
      if (!key || !rawData) return rawData;
      const url = process.env.GROQ_API_KEY
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.cerebras.ai/v1/chat/completions';
      const model = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'llama3.1-8b';
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 2000,
            messages: [
              {
                role: 'system',
                content: 'You are a data quality analyst. Today is ' + timeStr + '. Given raw search results and a query: 1) Extract only facts that directly answer the query. 2) Remove irrelevant content, ads, navigation, repetition. 3) Tag each key fact as [HIGH CONFIDENCE] if multiple sources agree and it is recent, or [LOW CONFIDENCE] if single source or older than 7 days. 4) For financial figures note the source and date. 5) Preserve exact numbers — never round or alter figures. 6) Output clean structured facts only. If nothing is relevant output exactly: NO RELEVANT DATA FOUND'
              },
              {
                role: 'user',
                content: 'QUERY: ' + query + '\n\nRAW DATA:\n' + rawData.slice(0, 10000)
              }
            ]
          })
        });
        const data = await r.json();
        const filtered = data.choices?.[0]?.message?.content?.trim();
        if (!filtered || filtered === 'NO RELEVANT DATA FOUND') return rawData;
        return filtered;
      } catch (e) {
        return rawData;
      }
    }

    // URL CONTENT FETCHER
    async function fetchPageContent(url) {
      try {
        const blocked = ['wsj.com', 'ft.com', 'bloomberg.com', 'nytimes.com',
                         'economist.com', 'washingtonpost.com', 'thetimes.co.uk'];
        if (blocked.some(d => url.includes(d))) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

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
      } catch (e) {
        return null;
      }
    }

    // SERPER — GOOGLE SEARCH + FULL ARTICLE FETCH
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
          const ab = data.answerBox;
          results += 'DIRECT ANSWER: ' + (ab.answer || ab.snippet || ab.title || '') + '\n\n';
        }

        if (data.knowledgeGraph) {
          const kg = data.knowledgeGraph;
          results += 'KNOWLEDGE: ' + (kg.title || '') + ' — ' + (kg.description || '') + '\n\n';
        }

        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 6).forEach((r, i) => {
            results += '[' + (i+1) + '] ' + r.title + '\n' + r.snippet + '\nSource: ' + r.link + '\n\n';
          });

          const urls = data.organic.slice(0, 5).map(r => r.link).filter(Boolean);
          const contents = await Promise.all(urls.map(url => fetchPageContent(url)));

          const fullArticles = contents
            .map((content, i) => content ? 'FULL ARTICLE [' + (i+1) + '] from ' + urls[i] + ':\n' + content : null)
            .filter(Boolean);

          if (fullArticles.length > 0) {
            results += '\nFULL ARTICLE CONTENT:\n' + fullArticles.join('\n\n---\n\n');
          }
        }

        return results.trim() || null;
      } catch (e) { return null; }
    }

    // NEWSAPI — LIVE NEWS
    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const [everythingRes, headlinesRes] = await Promise.all([
          fetch('https://newsapi.org/v2/everything?q=' + encodeURIComponent(query) + '&sortBy=publishedAt&pageSize=5&language=en&apiKey=' + key),
          fetch('https://newsapi.org/v2/top-headlines?q=' + encodeURIComponent(query) + '&pageSize=3&language=en&apiKey=' + key)
        ]);
        const [everything, headlines] = await Promise.all([
          everythingRes.json(),
          headlinesRes.json()
        ]);

        let result = '';

        if (headlines.articles?.length) {
          result += 'TOP HEADLINES:\n' + headlines.articles
            .slice(0, 3)
            .map((a, i) => '[' + (i+1) + '] ' + a.title + '\n' + (a.description || '') + '\nPublished: ' + (a.publishedAt?.slice(0, 10)) + '\nSource: ' + a.source?.name)
            .join('\n\n') + '\n\n';
        }

        if (everything.articles?.length) {
          result += 'RECENT NEWS:\n' + everything.articles
            .slice(0, 5)
            .map((a, i) => '[' + (i+1) + '] ' + a.title + '\n' + (a.description || '') + '\nPublished: ' + (a.publishedAt?.slice(0, 10)) + '\nSource: ' + a.source?.name)
            .join('\n\n');
        }

        return result.trim() || null;
      } catch (e) { return null; }
    }

    // TAVILY — DEEP SEARCH
    async function tavilySearch(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            query: query,
            search_depth: 'advanced',
            max_results: 6,
            include_answer: true,
            include_raw_content: true
          })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((r, i) => '[' + (i+1) + '] ' + r.title + '\n' + (r.raw_content || r.content)?.slice(0, 1500))
          .join('\n\n');
        return data.answer
          ? 'DIRECT ANSWER: ' + data.answer + '\n\nSOURCES:\n' + snippets
          : snippets;
      } catch (e) { return null; }
    }

    // DUCKDUCKGO — FREE FALLBACK
    async function duckSearch(query) {
      try {
        const r = await fetch(
          'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1'
        );
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += 'ANSWER: ' + data.AbstractText + '\n\n';
        if (data.RelatedTopics?.length) {
          data.RelatedTopics.slice(0, 4).forEach(t => {
            if (t.Text) result += '- ' + t.Text + '\n';
          });
        }
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // CRYPTO — LIVE PRICES ONLY
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
          'https://api.coingecko.com/api/v3/simple/price?ids=' + coinMap[coin] + '&vs_currencies=usd&include_24hr_change=true'
        );
        const data = await r.json();
        const c = data[coinMap[coin]];
        if (!c) return null;
        return 'LIVE CRYPTO PRICE (fetched now):\n' + coin.toUpperCase() + ' = $' + c.usd.toLocaleString() + ' USD\n24h Change: ' + c.usd_24h_change?.toFixed(2) + '%\nINSTRUCTION: Report only these exact values. No other statistics.';
      } catch (e) { return null; }
    }

    // METALS — LIVE PRICES ONLY
    async function getMetals(query) {
      const q = query.toLowerCase();
      if (!q.match(/gold|silver|xau|xag|platinum|palladium|metal/)) return null;
      try {
        const r = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        const gold = data.find(m => m.metal === 'gold');
        const silver = data.find(m => m.metal === 'silver');
        const platinum = data.find(m => m.metal === 'platinum');
        let result = 'LIVE METALS PRICES (fetched now, per troy ounce, USD):\n';
        if (gold) result += 'Gold (XAU/USD): $' + gold.price.toFixed(2) + '\n';
        if (silver) result += 'Silver (XAG/USD): $' + silver.price.toFixed(2) + '\n';
        if (platinum) result += 'Platinum: $' + platinum.price.toFixed(2) + '\n';
        result += 'INSTRUCTION: Report only prices listed. Do NOT calculate changes or add any extra data.';
        return result.trim();
      } catch (e) { return null; }
    }

    // FOREX — SUPPORTED PAIRS ONLY
    const SUPPORTED_FOREX_PAIRS = ['EUR', 'GBP', 'KES', 'JPY', 'CAD', 'AUD', 'ZAR', 'NGN', 'UGX', 'TZS', 'INR', 'CHF'];

    async function getForex(query) {
      const q = query.toLowerCase();
      if (!q.match(/forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound|rate/)) return null;
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates) return null;
        let result = 'LIVE FOREX RATES (fetched now, vs USD):\n';
        SUPPORTED_FOREX_PAIRS.forEach(p => {
          if (data.rates[p]) result += 'USD/' + p + ': ' + data.rates[p].toFixed(4) + '\n';
        });
        result += '\nSUPPORTED PAIRS ONLY: ' + SUPPORTED_FOREX_PAIRS.join(', ');
        result += '\nINSTRUCTION: If the user asked for a pair NOT in this list, tell them "I do not have a live feed for that pair, Sir." Do NOT estimate or use training data for any unlisted pair.';
        return result.trim();
      } catch (e) { return null; }
    }

    // WEATHER — LIVE
    async function getWeather(query) {
      const q = query.toLowerCase();
      if (!q.match(/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/)) return null;

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
        const geoR = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1');
        const geoData = await geoR.json();
        if (!geoData.results?.length) return 'WEATHER ERROR: Location "' + city + '" not found. Tell the user the city was not found. Do not guess weather.';
        const loc = geoData.results[0];
        const wR = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto'
        );
        const wData = await wR.json();
        const cur = wData.current;
        const conds = {
          0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
          45: 'Foggy', 51: 'Light drizzle', 61: 'Slight rain', 63: 'Moderate rain',
          65: 'Heavy rain', 71: 'Slight snow', 80: 'Rain showers', 95: 'Thunderstorm'
        };
        return 'LIVE WEATHER (fetched now) — ' + loc.name + ', ' + loc.country + ':\nTemperature: ' + cur.temperature_2m + '°C (feels like ' + cur.apparent_temperature + '°C)\nCondition: ' + (conds[cur.weather_code] || 'Variable') + '\nHumidity: ' + cur.relative_humidity_2m + '%\nWind: ' + cur.wind_speed_10m + ' km/h\nINSTRUCTION: Report only these exact values. No forecasts or extra data.';
      } catch (e) { return null; }
    }

    // SPORTS — LIVE
    async function getSports(query) {
      const q = query.toLowerCase();
      if (!q.match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today. Tell the user there are no matches today. Do NOT invent scores or results.';
        const events = data.events.slice(0, 6);
        return 'LIVE SPORTS RESULTS (fetched now):\n' + events
          .map(e => e.strHomeTeam + ' ' + (e.intHomeScore ?? '-') + ' vs ' + (e.intAwayScore ?? '-') + ' ' + e.strAwayTeam + ' (' + e.strLeague + ')')
          .join('\n') + '\nINSTRUCTION: Report only these matches. No scorers, stats, or commentary not listed here.';
      } catch (e) { return null; }
    }

    // DETECT SIMPLE GREETING/COMMAND
    function isSimpleCommand(messages) {
      if (!messages?.length) return true;
      const last = messages[messages.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye',
        'how are you', 'what is your name', 'who are you', 'play ', 'study ', 'stop', 'pause'];
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // FORMAT MESSAGES
    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // MAIN DATA PIPELINE
    // Phase 1: Plan → Phase 2: Fetch → Phase 3: Score → Phase 4: Specialists → Phase 5: Assemble
    let webContext = '';
    let searchedWeb = false;
    let dataSource = '';
    let gaps = [];

    if (mode !== 'greeting' && !isSimpleCommand(userMessages)) {
      const lastMsg = userMessages[userMessages.length - 1];
      const query = lastMsg?.text || lastMsg?.content || '';
      const intent = classifyQuery(query);

      // PHASE 1 — PLAN: brain generates targeted search queries
      const plannedQueries = await planSearch(query);

      // PHASE 2 — FETCH: run all planned queries + specialists in parallel
      const [searchResults, cryptoData, metalData, forexData, weatherData, sportsData] = await Promise.all([
        // Run all planned search queries in parallel across all engines
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

      // Flatten all web search results into one raw block
      const rawWebData = searchResults
        .flat()
        .filter(Boolean)
        .join('\n\n---\n\n');

      // PHASE 3 — SCORE: confidence filter cleans and rates the raw web data
      let filteredWebData = null;
      if (rawWebData) {
        filteredWebData = await scoreAndFilter(rawWebData, query);
      }

      // If all planned queries returned nothing, try DuckDuckGo as last resort
      if (!filteredWebData) {
        const duckData = await duckSearch(enhanceQuery(query));
        if (duckData) filteredWebData = duckData;
      }

      // PHASE 4 — GAP DETECTION: flag missing specialist data
      if (intent.isCrypto && !cryptoData) {
        gaps.push('CRYPTO GAP: No live crypto data found for this coin. Do NOT use training knowledge for any price. Tell the user the coin is not in the live feed.');
      }
      if (intent.isMetals && !metalData) {
        gaps.push('METALS GAP: No live metals data found. Do NOT estimate any metal price.');
      }
      if (intent.isForex && !forexData) {
        gaps.push('FOREX GAP: No live forex data found. Do NOT estimate any exchange rate.');
      }
      if (intent.isForex && forexData) {
        gaps.push('FOREX PAIR CHECK: Only these pairs are in the live feed: ' + SUPPORTED_FOREX_PAIRS.join(', ') + '. If the user asked for any other pair, tell them "I do not have a live feed for that pair, Sir." Do NOT estimate unlisted pairs.');
      }
      if (intent.isWeather && !weatherData) {
        gaps.push('WEATHER GAP: Weather data could not be fetched. Do NOT guess weather conditions.');
      }

      // PHASE 5 — ASSEMBLE: build final context block in trust-hierarchy order
      // Web search goes first as broad context
      // Specialist live data goes last so brain sees it most recently (highest weight)

      if (filteredWebData) {
        webContext += '=== WEB SEARCH (confidence-scored) ===\n' + filteredWebData + '\n\n';
        searchedWeb = true;
        dataSource = 'WEB[' + plannedQueries.length + 'queries]';
      }

      if (cryptoData) {
        webContext += '=== LIVE CRYPTO DATA ===\n' + cryptoData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+CRYPTO' : 'CRYPTO';
      }

      if (metalData) {
        webContext += '=== LIVE METALS DATA ===\n' + metalData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+METALS' : 'METALS';
      }

      if (forexData) {
        webContext += '=== LIVE FOREX DATA ===\n' + forexData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+FOREX' : 'FOREX';
      }

      if (weatherData) {
        webContext += '=== LIVE WEATHER DATA ===\n' + weatherData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+WEATHER' : 'WEATHER';
      }

      if (sportsData) {
        webContext += '=== LIVE SPORTS DATA ===\n' + sportsData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+SPORTS' : 'SPORTS';
      }

      if (gaps.length > 0) {
        webContext += '=== DATA GAP WARNINGS ===\n' + gaps.join('\n') + '\n\n';
      }

      if (!webContext) {
        webContext = '=== NO DATA FOUND ===\nAll search sources returned empty results. Tell the user: "I could not find reliable data on that, Sir." Do NOT use training knowledge to answer factual questions.';
        searchedWeb = true;
        dataSource = 'EMPTY';
      }
    }

    // SYSTEM PROMPT
    const webNote = searchedWeb
      ? '\n\nCRITICAL INSTRUCTIONS — YOU ARE AN INTELLIGENT ANALYST, NOT A COPY-PASTER:\nToday is ' + timeStr + '.\nYesterday was ' + yesterdayStr + '.\n\nYou have been given data from MULTIPLE SOURCES that have already been confidence-scored and filtered by a quality analysis pass.\nYour job is to THINK like a senior analyst: read the scored data, resolve any conflicts, trust the freshest and most authoritative sources, then give the user one clear confident answer.\n\nHOW TO REASON THROUGH THE DATA:\n\nSTEP 1 — SOURCE HIERARCHY (trust in this order, highest first):\n  a) LIVE specialist APIs (CRYPTO, FOREX, METALS, WEATHER, SPORTS) — real-time feeds, most trusted for prices and rates\n  b) [HIGH CONFIDENCE] tagged facts — multiple sources agreed, recent date\n  c) NEWS SOURCES with today or yesterday publication date — trusted for recent events\n  d) [LOW CONFIDENCE] tagged facts — use with caution, mention uncertainty if it matters\n  e) Your training knowledge — FORBIDDEN for any factual claim\n\nSTEP 2 — COMPARE AND RESOLVE:\n  - Two or more sources agree → state it confidently\n  - Sources conflict → pick the one higher in the hierarchy, briefly flag the conflict only if it matters to the user\n  - Live API gives a price but article gives a different price → always use the live API\n  - Article contains a financial figure with no date → ignore it, use live API only\n  - All sources tell the same story with slightly different detail → synthesize the most complete version\n\nSTEP 3 — HANDLE GAPS HONESTLY:\n  - DATA GAP WARNING present → say "I do not have a live feed for that, Sir"\n  - No sources mention what was asked → say "I could not find reliable data on that, Sir"\n  - Partial data → say "I have partial information on that, Sir" then give what you have\n  - NEVER fill a gap with training knowledge\n\nSTEP 4 — DELIVER THE ANSWER:\n  - Speak like a brilliant trusted advisor — warm, direct, no fluff\n  - One synthesized answer, not a list of what each source said\n  - No bullet points, no markdown, no asterisks — plain flowing sentences\n  - Address the user as Sir\n  - Concise unless asked for detail\n\nABSOLUTE HARD RULES:\n1. Never quote a financial figure not in the live API data blocks\n2. Never use training knowledge for any current fact, price, or event\n3. Never say "as of my knowledge cutoff" — you have live data\n4. Never invent, estimate, or calculate values not in the data\n5. Never give a rate for a currency pair not listed in the LIVE FOREX DATA block\n\nLIVE DATA (confidence-scored and filtered — analyse and synthesise these):\n' + webContext
      : '';

    const systemPrompt = mode === 'greeting'
      ? 'You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.\nThe current date and time is: ' + timeStr + '. It is ' + partOfDay + '.\nGreet the user warmly like Jarvis greets Tony Stark — address them as "Sir".\nGive a brief, witty, engaging good ' + partOfDay + ' greeting that includes the actual time and date naturally.\nKeep it to 2-3 sentences max. Be warm, intelligent, slightly humorous.\nNo markdown, no bullets, plain conversational text only.'

      : 'You are Scorpion, a hyper-intelligent Jarvis-style AI assistant with the analytical mind of a senior intelligence officer and the warmth of a trusted advisor.\nYou are warm, witty, loyal, and brilliantly intelligent. You address the user as "Sir".\nYou think before you speak — you compare sources, weigh evidence, and deliver one clear confident answer.\nYou are wise enough to know when you do not have enough data, and honest enough to say so rather than guess.\nYou give direct, conversational answers — never use markdown, bullet points, or asterisks.\nSpeak naturally like a genius trusted friend who has done their research.\nKeep responses concise unless asked to elaborate.\nToday is ' + timeStr + '.\nCRITICAL: Your training data is outdated. Rely ONLY on the live data provided — analyse it, compare it, synthesise the truth from it.\nCRITICAL: Never fabricate facts, prices, scores, or statistics. A confident wrong answer is worse than honest uncertainty.' + webNote;

    // BRAIN ROSTER
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

    // BRAIN FALLBACK LOOP
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
          if (gData.error) { lastError = gData.error.message; continue; }
          reply = gData?.candidates?.[0]?.content?.parts?.[0]?.text;

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
