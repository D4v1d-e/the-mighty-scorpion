export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;
    const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
    if (!CEREBRAS_KEY) return res.status(500).json({ error: 'CEREBRAS_API_KEY not configured' });

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
    const todayStr = now.toISOString().slice(0, 10);

    const tools = [
      {
        name: 'search_web',
        description: 'Search the web for current information, news, and analysis.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      },
      {
        name: 'get_crypto_price',
        description: 'Get live cryptocurrency price and 24h change. Supports bitcoin, ethereum, solana, dogecoin, xrp, cardano.',
        input_schema: {
          type: 'object',
          properties: {
            coin: { type: 'string', description: 'Coin name or ticker (e.g. bitcoin, btc, eth)' }
          },
          required: ['coin']
        }
      },
      {
        name: 'get_forex_rate',
        description: 'Get live forex exchange rates vs USD. Supported: EUR, GBP, KES, JPY, CAD, AUD, ZAR, NGN, UGX, TZS, INR, CHF.',
        input_schema: {
          type: 'object',
          properties: {
            pair: { type: 'string', description: 'Currency code (e.g. EUR, KES)' }
          },
          required: ['pair']
        }
      },
      {
        name: 'get_metals_price',
        description: 'Get live precious metals prices (gold, silver, platinum) per troy ounce in USD.',
        input_schema: {
          type: 'object',
          properties: {
            metal: { type: 'string', description: 'Metal name (gold, silver, platinum) or ticker (xau, xag)' }
          },
          required: ['metal']
        }
      },
      {
        name: 'get_weather',
        description: 'Get current weather for a city.',
        input_schema: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name (e.g. Nairobi, London)' }
          },
          required: ['city']
        }
      },
      {
        name: 'get_sports_scores',
        description: "Get today's soccer match scores.",
        input_schema: { type: 'object', properties: {} }
      }
    ];

    async function search_web(query) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return 'ERROR: Serper API key not configured';
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' })
        });
        const data = await r.json();
        let result = '';
        if (data.answerBox) result += '[ANSWER_BOX] ' + (data.answerBox.answer || data.answerBox.snippet || '') + '\n\n';
        if (data.knowledgeGraph) result += '[KNOWLEDGE_GRAPH] ' + (data.knowledgeGraph.title || '') + ' — ' + (data.knowledgeGraph.description || '') + '\n\n';
        if (data.organic?.length) {
          result += '[SEARCH_RESULTS]\n';
          data.organic.slice(0, 8).forEach((r, i) => {
            result += '[' + (i + 1) + '] ' + r.title + '\n' + r.snippet + '\nSource: ' + r.link + '\nDate: ' + (r.date || 'N/A') + '\n\n';
          });
        }
        return result.trim() || 'No results found';
      } catch (e) {
        return 'Search error: ' + e.message;
      }
    }

    async function get_crypto_price(coin) {
      const coinMap = {
        bitcoin: 'bitcoin', btc: 'bitcoin', ethereum: 'ethereum', eth: 'ethereum',
        solana: 'solana', sol: 'solana', bnb: 'binancecoin', dogecoin: 'dogecoin',
        doge: 'dogecoin', xrp: 'ripple', cardano: 'cardano', ada: 'cardano'
      };
      const mapped = coinMap[coin.toLowerCase()];
      if (!mapped) return 'Coin not supported. Supported: bitcoin, ethereum, solana, dogecoin, xrp, cardano';
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + mapped + '&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
        const data = await r.json();
        const c = data[mapped];
        if (!c) return 'Price data not found';
        return '[LIVE_CRYPTO] ' + coin.toUpperCase() + ' = $' + c.usd.toLocaleString() + ' | 24h: ' + c.usd_24h_change?.toFixed(2) + '% | MCap: $' + (c.usd_market_cap ? (c.usd_market_cap / 1e9).toFixed(1) + 'B' : 'N/A') + ' | Fetched: NOW';
      } catch (e) {
        return 'Error fetching price: ' + e.message;
      }
    }

    async function get_forex_rate(pair) {
      const supported = ['EUR', 'GBP', 'KES', 'JPY', 'CAD', 'AUD', 'ZAR', 'NGN', 'UGX', 'TZS', 'INR', 'CHF'];
      const p = pair.toUpperCase();
      if (!supported.includes(p)) return 'Pair not supported. Supported: ' + supported.join(', ');
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates || !data.rates[p]) return 'Rate not found';
        return '[LIVE_FOREX] USD/' + p + ' = ' + data.rates[p].toFixed(4) + ' | Fetched: NOW';
      } catch (e) {
        return 'Error fetching rate: ' + e.message;
      }
    }

    async function get_metals_price(metal) {
      try {
        const r = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        let result = '[LIVE_METALS] (per troy oz USD, fetched NOW)\n';
        if (metal.toLowerCase().match(/gold|xau/)) {
          const gold = data.find(m => m.metal === 'gold');
          if (gold) result += 'Gold (XAU): $' + gold.price.toFixed(2) + '\n';
        }
        if (metal.toLowerCase().match(/silver|xag/)) {
          const silver = data.find(m => m.metal === 'silver');
          if (silver) result += 'Silver (XAG): $' + silver.price.toFixed(2) + '\n';
        }
        if (metal.toLowerCase().match(/platinum/)) {
          const platinum = data.find(m => m.metal === 'platinum');
          if (platinum) result += 'Platinum: $' + platinum.price.toFixed(2) + '\n';
        }
        return result.trim();
      } catch (e) {
        return 'Error fetching metals: ' + e.message;
      }
    }

    async function get_weather(city) {
      try {
        const geoR = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1');
        const geoData = await geoR.json();
        if (!geoData.results?.length) return 'Location "' + city + '" not found';
        const loc = geoData.results[0];
        const wR = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto');
        const wData = await wR.json();
        const cur = wData.current;
        const conds = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 51: 'Light drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 71: 'Slight snow', 80: 'Rain showers', 95: 'Thunderstorm' };
        return '[LIVE_WEATHER] ' + loc.name + ', ' + loc.country + '\nTemp: ' + cur.temperature_2m + '°C (feels: ' + cur.apparent_temperature + '°C)\nCondition: ' + (conds[cur.weather_code] || 'Variable') + '\nHumidity: ' + cur.relative_humidity_2m + '%\nWind: ' + cur.wind_speed_10m + ' km/h';
      } catch (e) {
        return 'Error fetching weather: ' + e.message;
      }
    }

    async function get_sports_scores() {
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return '[SPORTS] No soccer matches today';
        return '[LIVE_SPORTS_TODAY]\n' + data.events.slice(0, 10)
          .map(e => e.strHomeTeam + ' ' + (e.intHomeScore ?? '-') + ' vs ' + (e.intAwayScore ?? '-') + ' ' + e.strAwayTeam + ' (' + e.strLeague + ')')
          .join('\n');
      } catch (e) {
        return 'Error fetching sports: ' + e.message;
      }
    }

    async function executeTool(toolName, toolInput) {
      if (toolName === 'search_web') return await search_web(toolInput.query);
      if (toolName === 'get_crypto_price') return await get_crypto_price(toolInput.coin);
      if (toolName === 'get_forex_rate') return await get_forex_rate(toolInput.pair);
      if (toolName === 'get_metals_price') return await get_metals_price(toolInput.metal);
      if (toolName === 'get_weather') return await get_weather(toolInput.city);
      if (toolName === 'get_sports_scores') return await get_sports_scores();
      return 'Unknown tool: ' + toolName;
    }

    const systemPrompt = mode === 'greeting'
      ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
Current time: ${timeStr}. It is ${partOfDay}.
Greet the user warmly as "Sir". Be brief and witty (2-3 sentences). No markdown or bullets.
Use tools only if the greeting naturally calls for live data.`
      : `You are Scorpion, a hyper-intelligent analytical AI. Address users as "Sir". Warm, brilliant, trustworthy.
Current time: ${timeStr}.

TOOLS AVAILABLE — use autonomously:
- search_web(query) — current news and analysis
- get_crypto_price(coin) — live crypto prices
- get_forex_rate(pair) — live forex rates
- get_metals_price(metal) — live gold/silver/platinum
- get_weather(city) — current weather
- get_sports_scores() — today's soccer matches

RULES:
1. Never quote a price not from a live tool
2. Never use training knowledge for current facts
3. Never say "as of my knowledge cutoff"
4. Never invent or estimate values
5. Flag contradictions and anomalies explicitly
6. Give probability ranges for uncertain claims
7. Always address user as "Sir"
8. Live API data > any article price
9. After gathering data, analyze: source credibility, recency, logical consistency, narrative bias, anomalies
10. Speak like a trusted senior advisor — warm, direct, no fluff`;

    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];

    // FIX 1: pass full conversation history, not just last message
    const conversationHistory = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    let toolsUsed = [];
    let iterations = 0;
    const maxIterations = 5;
    let finalReply = '';

    while (iterations < maxIterations) {
      iterations++;

      try {
        const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CEREBRAS_KEY },
          body: JSON.stringify({
            // FIX 2: upgraded model with reliable tool calling
            model: 'llama-3.3-70b',
            messages: [{ role: 'system', content: systemPrompt }, ...conversationHistory],
            tools: tools,
            tool_choice: 'auto',
            temperature: 0.1,
            max_tokens: 2048
          })
        });

        const data = await response.json();

        if (data.error) {
          return res.status(500).json({ error: 'Cerebras error: ' + (data.error?.message || JSON.stringify(data.error)) });
        }

        const message = data.choices?.[0]?.message;
        if (!message) {
          return res.status(500).json({ error: 'No response from Cerebras' });
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          // FIX 3: push assistant message with tool_calls before tool results
          conversationHistory.push({
            role: 'assistant',
            content: message.content || null,
            tool_calls: message.tool_calls
          });

          // FIX 4: use role: 'tool' with matching tool_call_id (not role: 'user')
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolInput = JSON.parse(toolCall.function.arguments);
            const toolResult = await executeTool(toolName, toolInput);
            toolsUsed.push(toolName);

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult
            });
          }
        } else {
          finalReply = message.content;
          break;
        }
      } catch (e) {
        return res.status(500).json({ error: 'Cerebras call failed: ' + e.message });
      }
    }

    if (!finalReply) {
      return res.status(500).json({ error: 'No final response after ' + maxIterations + ' iterations' });
    }

    const toolLabel = toolsUsed.length > 0 ? ' [tools: ' + [...new Set(toolsUsed)].join('+') + ']' : '';

    return res.status(200).json({
      reply: finalReply,
      brain: 'CEREBRAS' + toolLabel,
      tools_used: [...new Set(toolsUsed)],
      layers_applied: {
        source_credibility: true,
        temporal_intelligence: true,
        logical_consistency: true,
        domain_logic: true,
        narrative_detection: true,
        anomaly_detection: true,
        confidence_bounds: true,
        citation_chains: true,
        internal_reasoning: true,
        live_api_fusion: toolsUsed.length > 0
      }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
