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

    // ── QUERY CLASSIFIER ──
    // Determines what kind of data the query needs so we can flag gaps accurately
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

    // ── SMART QUERY ENHANCER ──
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

    // ── SERPER — GOOGLE SEARCH + FULL ARTICLE FETCH ──
    async function serperSearch(query) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const enhanced = enhanceQuery(query);
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: enhanced, num: 8, gl: 'us', hl: 'en' })
        });
        const data = await r.json();

        let results = '';

        if (data.answerBox) {
          const ab = data.answerBox;
          results += `DIRECT ANSWER: ${ab.answer || ab.snippet || ab.title || ''}\n\n`;
        }

        if (data.knowledgeGraph) {
          const kg = data.knowledgeGraph;
          results += `KNOWLEDGE: ${kg.title || ''} — ${kg.description || ''}\n\n`;
        }

        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 6).forEach((r, i) => {
            results += `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.link}\n\n`;
          });

          // Fetch full content from top URLs in parallel
          const urls = data.organic.slice(0, 5).map(r => r.link).filter(Boolean);
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

    // ── NEWSAPI — LIVE NEWS ──
    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const enhanced = enhanceQuery(query);
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
            .slice(0, 5)
            .map((a, i) => `[${i + 1}] ${a.title}\n${a.description || ''}\nPublished: ${a.publishedAt?.slice(0, 10)}\nSource: ${a.source?.name}`)
            .join('\n\n');
        }

        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── TAVILY — DEEP SEARCH ──
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
            max_results: 6,
            include_answer: true,
            include_raw_content: true
          })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${(r.raw_content || r.content)?.slice(0, 1500)}`)
          .join('\n\n');
        return data.answer
          ? `DIRECT ANSWER: ${data.answer}\n\nSOURCES:\n${snippets}`
          : snippets;
      } catch (e) { return null; }
    }

    // ── DUCKDUCKGO — FREE FALLBACK ──
    async function duckSearch(query) {
      try {
        const r = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(enhanceQuery(query))}&format=json&no_html=1&skip_disambig=1`
        );
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += `ANSWER: ${data.AbstractText}\n\n`;
        if (data.RelatedTopics?.length) {
          data.RelatedTopics.slice(0, 4).forEach(t => {
            if (t.Text) result += `- ${t.Text}\n`;
          });
        }
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ── CRYPTO — LIVE PRICES ONLY ──
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
        return `LIVE CRYPTO PRICE (fetched now):\n${coin.toUpperCase()} = $${c.usd.toLocaleString()} USD\n24h Change: ${c.usd_24h_change?.toFixed(2)}%\nINSTRUCTION: Report only these exact values. No other statistics.`;
      } catch (e) { return null; }
    }

    // ── METALS — LIVE PRICES ONLY ──
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
        if (gold) result += `Gold (XAU/USD): $${gold.price.toFixed(2)}\n`;
        if (silver) result += `Silver (XAG/USD): $${silver.price.toFixed(2)}\n`;
        if (platinum) result += `Platinum: $${platinum.price.toFixed(2)}\n`;
        result += `INSTRUCTION: Report only prices listed. Do NOT calculate changes or add any extra data.`;
        return result.trim();
      } catch (e) { return null; }
    }

    // ── FOREX — SUPPORTED PAIRS ONLY, EXPLICIT UNSUPPORTED LIST ──
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
          if (data.rates[p]) result += `USD/${p}: ${data.rates[p].toFixed(4)}\n`;
        });
        result += `\nSUPPORTED PAIRS ONLY: ${SUPPORTED_FOREX_PAIRS.join(', ')}`;
        result += `\nINSTRUCTION: If the user asked for a pair NOT in this list, tell them "I do not have a live feed for that pair, Sir." Do NOT estimate or use training data for any unlisted pair.`;
        return result.trim();
      } catch (e) { return null; }
    }

    // ── WEATHER — LIVE ──
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
        return `LIVE WEATHER (fetched now) — ${loc.name}, ${loc.country}:\nTemperature: ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C)\nCondition: ${conds[cur.weather_code] || 'Variable'}\nHumidity: ${cur.relative_humidity_2m}%\nWind: ${cur.wind_speed_10m} km/h\nINSTRUCTION: Report only these exact values. No forecasts or extra data.`;
      } catch (e) { return null; }
    }

    // ── SPORTS — LIVE ──
    async function getSports(query) {
      const q = query.toLowerCase();
      if (!q.match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return 'SPORTS: No soccer events found for today. Tell the user there are no matches today. Do NOT invent scores or results.';
        const events = data.events.slice(0, 6);
        return 'LIVE SPORTS RESULTS (fetched now):\n' + events
          .map(e => `${e.strHomeTeam} ${e.intHomeScore ?? '-'} vs ${e.intAwayScore ?? '-'} ${e.strAwayTeam} (${e.strLeague})`)
          .join('\n') + '\nINSTRUCTION: Report only these matches. No scorers, stats, or commentary not listed here.';
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

    // ── MAIN DATA FETCH — SEARCH FIRST, SPECIALISTS SECOND ──
    let webContext = '';
    let searchedWeb = false;
    let dataSource = '';
    let gaps = []; // tracks what was queried but not found

    if (mode !== 'greeting' && !isSimpleCommand(userMessages)) {
      const lastMsg = userMessages[userMessages.length - 1];
      const query = lastMsg?.text || lastMsg?.content || '';
      const intent = classifyQuery(query);

      // STEP 1 — Web search always runs first, all sources in parallel
      const [serperData, newsData, tavilyData] = await Promise.all([
        serperSearch(query),
        newsSearch(query),
        tavilySearch(query)
      ]);

      // STEP 2 — Specialist APIs for structured live data, all in parallel
      const [cryptoData, metalData, forexData, weatherData, sportsData] = await Promise.all([
        getCrypto(query),
        getMetals(query),
        getForex(query),
        getWeather(query),
        getSports(query)
      ]);

      // STEP 3 — Detect financial gaps where specialist returned nothing
      // This prevents the brain from filling gaps with training knowledge
      if (intent.isCrypto && !cryptoData) {
        gaps.push('CRYPTO GAP: The crypto API returned no data for this coin. Do NOT use training knowledge for any price. Tell the user the coin is not in the live feed.');
      }
      if (intent.isMetals && !metalData) {
        gaps.push('METALS GAP: The metals API returned no data. Do NOT estimate any metal price. Tell the user live metals data is unavailable.');
      }
      if (intent.isForex && !forexData) {
        gaps.push('FOREX GAP: The forex API returned no data. Do NOT estimate any exchange rate. Tell the user you could not fetch live forex data.');
      }
      if (intent.isForex && forexData) {
        // Even when forex data exists, flag if the specific pair asked about may not be supported
        gaps.push(`FOREX PAIR CHECK: Only these pairs are in the live feed: ${SUPPORTED_FOREX_PAIRS.join(', ')}. If the user asked for any other pair, tell them "I do not have a live feed for that pair, Sir." Do NOT estimate unlisted pairs.`);
      }
      if (intent.isWeather && !weatherData) {
        gaps.push('WEATHER GAP: Weather data could not be fetched. Do NOT guess weather conditions. Tell the user weather data is unavailable.');
      }

      // STEP 4 — Build context block: web search first, then specialists on top
      // Web search provides the broad context; specialists provide precise live numbers

      if (serperData) {
        webContext += '=== GOOGLE SEARCH + FULL ARTICLES ===\n' + serperData + '\n\n';
        searchedWeb = true;
        dataSource = 'SERPER';
      }

      if (newsData) {
        webContext += '=== NEWS SOURCES ===\n' + newsData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+NEWS' : 'NEWS';
      }

      if (tavilyData) {
        webContext += '=== TAVILY DEEP SEARCH ===\n' + tavilyData + '\n\n';
        searchedWeb = true;
        dataSource = dataSource ? dataSource + '+TAVILY' : 'TAVILY';
      }

      // Specialist live data — highest priority, always placed last so brain sees it most recently
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

      // STEP 5 — Append gap warnings so brain knows what it cannot answer
      if (gaps.length > 0) {
        webContext += '=== DATA GAP WARNINGS ===\n' + gaps.join('\n') + '\n\n';
      }

      // STEP 6 — Last resort DuckDuckGo if all web searches failed
      if (!serperData && !newsData && !tavilyData) {
        const duckData = await duckSearch(query);
        if (duckData) {
          webContext += '=== DUCKDUCKGO RESULTS ===\n' + duckData + '\n\n';
          searchedWeb = true;
          dataSource = dataSource ? dataSource + '+DDG' : 'DDG';
        }
      }

      // STEP 7 — If absolutely nothing was found, force brain to admit it
      if (!webContext && !gaps.length) {
        webContext = '=== NO DATA FOUND ===\nAll search sources returned empty results for this query. You must tell the user: "I could not find reliable data on that, Sir." Do NOT use training knowledge to answer factual questions.';
        searchedWeb = true;
        dataSource = 'EMPTY';
      }
    }

    // ── SYSTEM PROMPT ──
    const webNote = searchedWeb
      ? `\n\nCRITICAL INSTRUCTIONS — YOU ARE AN INTELLIGENT ANALYST, NOT A COPY-PASTER:
Today is ${timeStr}.
Yesterday was ${yesterdayStr}.

You have been given data from MULTIPLE SOURCES fetched right now — web articles, news feeds, and live specialist APIs.
Your job is to THINK like a senior analyst: compare the sources, resolve conflicts, trust the freshest and most authoritative data, then give the user one clear confident answer.

HOW TO REASON THROUGH THE DATA:

STEP 1 — SOURCE HIERARCHY (trust in this order, highest first):
  a) LIVE specialist APIs (CRYPTO, FOREX, METALS, WEATHER, SPORTS) — these are real-time feeds, most trusted for prices and rates
  b) NEWS SOURCES with a publication date from today or yesterday — trusted for recent events
  c) GOOGLE SEARCH direct answer box or knowledge graph — trusted for facts
  d) Full article content published within the last 7 days — trusted for context
  e) Snippets and articles older than 7 days — use only for background context, never for prices or current facts
  f) Your training knowledge — FORBIDDEN for any factual claim, treat as worthless

STEP 2 — COMPARE SOURCES:
  - If two or more sources agree on a fact → state it confidently
  - If sources conflict → pick the one higher in the hierarchy above, mention the conflict briefly
  - If a live API gives a price but an article gives a different price → always use the live API price
  - If an article is dated and contains a financial figure → ignore that figure, use live API only
  - If all sources give the same story but with slightly different details → synthesize the most complete version

STEP 3 — DETECT AND HANDLE GAPS:
  - If a DATA GAP WARNING is present for something the user asked → say "I do not have a live feed for that, Sir" — do NOT estimate
  - If no sources mention something the user asked → say "I could not find reliable data on that, Sir"
  - If data is partial → say "I have partial information on that, Sir" then give what you have
  - NEVER fill a gap with training knowledge — a confident wrong answer is worse than admitting uncertainty

STEP 4 — DELIVER THE ANSWER:
  - Speak like a brilliant trusted advisor — warm, direct, no fluff
  - One clear answer, not a list of what each source said
  - If you used a live API for a price, just give the price — do not explain where it came from unless asked
  - If sources conflicted and you had to choose, briefly mention it only if it matters to the user
  - No bullet points, no markdown, no asterisks — plain flowing sentences only
  - Address the user as Sir
  - Keep it concise unless the user asked for detail

ABSOLUTE HARD RULES — ZERO EXCEPTIONS:
1. Never quote a financial figure (price, rate, percentage) that is not in the live API data blocks
2. Never use training knowledge for any current fact, price, event, or statistic
3. Never say "as of my knowledge cutoff" — you have live data, use it
4. Never invent, estimate, or calculate values not explicitly in the data
5. Never give a currency rate for a pair not listed in the LIVE FOREX DATA block

LIVE DATA AND ARTICLES (your sources — analyse and synthesise these):
${webContext}`
      : '';

    const systemPrompt = mode === 'greeting'
      ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
The current date and time is: ${timeStr}. It is ${partOfDay}.
Greet the user warmly like Jarvis greets Tony Stark — address them as "Sir".
Give a brief, witty, engaging good ${partOfDay} greeting that includes the actual time and date naturally.
Keep it to 2-3 sentences max. Be warm, intelligent, slightly humorous.
No markdown, no bullets, plain conversational text only.`

      : `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant with the analytical mind of a senior intelligence officer and the warmth of a trusted advisor.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as "Sir".
You think before you speak — you compare sources, weigh evidence, and deliver one clear confident answer rather than hedging or listing options.
You are wise enough to know when you do not have enough data, and honest enough to say so rather than guess.
You give direct, conversational answers — never use markdown, bullet points, or asterisks.
Speak naturally like a genius trusted friend who has done their research.
Keep responses concise unless asked to elaborate.
Today is ${timeStr}.
CRITICAL: Your training data is outdated. For any factual or current question, rely ONLY on the live data provided — analyse it, compare it, and summarise the truth from it.
CRITICAL: Never fabricate facts, prices, scores, or statistics. A confident wrong answer is worse than honest uncertainty.${webNote}`;

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
