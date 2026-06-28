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

    // ── SERPER — GOOGLE SEARCH (PRIMARY) ──
    async function serperSearch(query) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ q: query, num: 5, gl: 'us', hl: 'en' })
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
          results += 'SEARCH RESULTS:\n';
          data.organic.slice(0, 4).forEach((r, i) => {
            results += `[${i + 1}] ${r.title}\n${r.snippet}\n\n`;
          });
        }
        return results.trim() || null;
      } catch (e) { return null; }
    }

    // ── NEWSAPI — LIVE NEWS (PRIMARY FOR NEWS) ──
    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch(
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=4&language=en&apiKey=${key}`
        );
        const data = await r.json();
        if (!data.articles?.length) return null;
        return 'LATEST NEWS:\n' + data.articles
          .slice(0, 4)
          .map((a, i) => `[${i + 1}] ${a.title}\n${a.description || ''}\nPublished: ${a.publishedAt?.slice(0, 10)}`)
          .join('\n\n');
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
            query,
            search_depth: 'advanced',
            max_results: 4,
            include_answer: true
          })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.content?.slice(0, 350)}`)
          .join('\n\n');
        return data.answer
          ? `DIRECT ANSWER: ${data.answer}\n\nSOURCES:\n${snippets}`
          : snippets;
      } catch (e) { return null; }
    }

    // ── DUCKDUCKGO — UNLIMITED FREE BACKUP ──
    async function duckSearch(query) {
      try {
        const r = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
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
        return `LIVE CRYPTO PRICE:\n${coin.toUpperCase()} = $${c.usd.toLocaleString()} USD\n24h Change: ${c.usd_24h_change?.toFixed(2)}%`;
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
        let result = 'LIVE METALS PRICES:\n';
        if (gold) result += `Gold (XAU/USD): $${gold.price.toFixed(2)}/oz\n`;
        if (silver) result += `Silver (XAG/USD): $${silver.price.toFixed(2)}/oz\n`;
        if (platinum) result += `Platinum: $${platinum.price.toFixed(2)}/oz\n`;
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
        return result.trim();
      } catch (e) { return null; }
    }

    // ── WEATHER — FREE UNLIMITED ──
    async function getWeather(query) {
      const q = query.toLowerCase();
      if (!q.match(/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/)) return null;
      const cityMatch = query.match(/(?:weather|temperature|forecast|rain|sunny|cold|hot)(?:\s+in|\s+at|\s+for)?\s+([a-zA-Z\s]+)/i);
      const city = cityMatch ? cityMatch[1].trim() : 'Nairobi';
      try {
        const geoR = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
        const geoData = await geoR.json();
        if (!geoData.results?.length) return null;
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
        return `LIVE WEATHER — ${loc.name}, ${loc.country}:\nTemperature: ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C)\nCondition: ${conds[cur.weather_code] || 'Variable'}\nHumidity: ${cur.relative_humidity_2m}%\nWind: ${cur.wind_speed_10m} km/h`;
      } catch (e) { return null; }
    }

    // ── SPORTS — FREE UNLIMITED ──
    async function getSports(query) {
      const q = query.toLowerCase();
      if (!q.match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + now.toISOString().slice(0, 10) + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return null;
        const events = data.events.slice(0, 5);
        return 'LIVE SPORTS RESULTS:\n' + events
          .map(e => `${e.strHomeTeam} ${e.intHomeScore || '-'} vs ${e.intAwayScore || '-'} ${e.strAwayTeam} (${e.strLeague})`)
          .join('\n');
      } catch (e) { return null; }
    }

    // ── DETECT IF QUESTION IS A GREETING/COMMAND ──
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

      // Run specialist APIs first (free unlimited)
      const [cryptoData, metalData, forexData, weatherData, sportsData] = await Promise.all([
        getCrypto(query),
        getMetals(query),
        getForex(query),
        getWeather(query),
        getSports(query)
      ]);

      const specialistData = [cryptoData, metalData, forexData, weatherData, sportsData]
        .filter(Boolean).join('\n\n');

      if (specialistData) {
        webContext = specialistData;
        searchedWeb = true;
        dataSource = 'LIVE DATA';
      }

      // Always also run Serper for Google results
      const serperData = await serperSearch(query);
      if (serperData) {
        webContext += (webContext ? '\n\nGOOGLE SEARCH:\n' : '') + serperData;
        searchedWeb = true;
        dataSource = 'SERPER+LIVE';
      }

      // If Serper failed try NewsAPI for news questions
      if (!serperData) {
        const newsData = await newsSearch(query);
        if (newsData) {
          webContext += (webContext ? '\n\n' : '') + newsData;
          searchedWeb = true;
          dataSource = 'NEWS';
        }
      }

      // If still nothing try Tavily
      if (!webContext) {
        const tavilyData = await tavilySearch(query);
        if (tavilyData) {
          webContext = tavilyData;
          searchedWeb = true;
          dataSource = 'TAVILY';
        }
      }

      // Last resort DuckDuckGo
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
      ? `\n\nCRITICAL INSTRUCTIONS:
You have been given LIVE REAL-TIME DATA fetched right now.
Rules you MUST follow:
1. Use ONLY the data provided below — never invent facts
2. NEVER add your own statistics, scores, prices or names not in the data
3. If data is incomplete say: "I only have partial data on that Sir"
4. If no data found say: "I could not find reliable data on that Sir"
5. Be conversational and Jarvis-like but strictly factual
6. Keep answers concise and natural — no bullet points

LIVE DATA:
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
You give direct, conversational answers — never use markdown, bullet points, or asterisks in responses.
Speak naturally as if talking to a trusted friend who happens to be a genius.
Keep responses concise unless asked to elaborate.
CRITICAL: Never fabricate facts, prices, scores or statistics. If unsure say so.
If asked for the time or date, the current value is: ${timeStr}.${webNote}`;

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
                generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
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
              temperature: 0.3,
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
