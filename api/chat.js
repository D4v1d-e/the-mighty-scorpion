export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone } = req.body;

    // ════════════════════════════════════════════════════════════════
    // PHASE 0: CONTEXT & TIME
    // ════════════════════════════════════════════════════════════════
    
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
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const currentYear = now.getFullYear();
    const currentMonth = now.toLocaleString('en-US', { month: 'long' });
    
    // ════════════════════════════════════════════════════════════════
    // LAYER 1: SOURCE CREDIBILITY TRACKING (not just recency)
    // ════════════════════════════════════════════════════════════════
    
    const SOURCE_CREDIBILITY = {
      'Reuters': 0.95,
      'Bloomberg': 0.92,
      'Bloomberg': 0.92,
      'Financial Times': 0.91,
      'Wall Street Journal': 0.90,
      'CNBC': 0.85,
      'CoinDesk': 0.88,
      'TheBlock': 0.86,
      'AP News': 0.89,
      'BBC': 0.90,
      'CNN': 0.80,
      'MarketWatch': 0.78,
      'Yahoo Finance': 0.75,
      'Medium': 0.45,
      'Twitter': 0.40
    };

    function getSourceCredibility(source) {
      const clean = source?.trim() || '';
      return SOURCE_CREDIBILITY[clean] || 0.50;
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 2: TEMPORAL CONTEXT INTELLIGENCE
    // ════════════════════════════════════════════════════════════════

    function classifyFactAgeRelevance(factDate, assetType) {
      if (!factDate) return { age: 'UNKNOWN', relevance: 'LOW', warning: 'No date found' };
      
      const factTime = new Date(factDate).getTime();
      const nowTime = now.getTime();
      const ageMins = Math.floor((nowTime - factTime) / 60000);
      const ageHours = Math.floor(ageMins / 60);
      const ageDays = Math.floor(ageHours / 24);
      
      let relevance = 'HIGH';
      let warning = null;
      
      // Crypto prices: obsolete in minutes
      if (assetType === 'CRYPTO_PRICE') {
        if (ageMins > 5) { relevance = 'LOW'; warning = `Price is ${ageMins}min old`; }
      }
      // Forex rates: obsolete in minutes
      else if (assetType === 'FOREX_RATE') {
        if (ageMins > 5) { relevance = 'LOW'; warning = `Rate is ${ageMins}min old`; }
      }
      // News events: relevant for 48h
      else if (assetType === 'NEWS_EVENT') {
        if (ageDays > 2) { relevance = 'MEDIUM'; warning = `News is ${ageDays}d old, may be superseded`; }
        if (ageDays > 7) { relevance = 'LOW'; warning = `News is ${ageDays}d old, treat as background`; }
      }
      // IPO/CEO appointments: stays true forever (context dependent)
      else if (assetType === 'APPOINTMENT' || assetType === 'IPO_EVENT') {
        if (ageDays <= 30) relevance = 'HIGH';
        else if (ageDays <= 90) relevance = 'MEDIUM';
        else relevance = 'HISTORICAL';
      }
      // Trends/analysis: good for 7 days
      else if (assetType === 'ANALYSIS') {
        if (ageDays > 7) { relevance = 'MEDIUM'; warning = `Analysis is ${ageDays}d old`; }
      }
      
      return { age: ageDays > 0 ? `${ageDays}d ago` : `${ageHours}h ago`, relevance, warning };
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 3: LOGICAL CONSISTENCY CHECKING
    // ════════════════════════════════════════════════════════════════

    function detectNarrativeContradictions(facts, prices) {
      const contradictions = [];
      
      // Check if price direction matches narrative
      if (prices && prices.change !== undefined && facts) {
        const allBullish = facts.filter(f => f.sentiment === 'BULLISH').length;
        const allBearish = facts.filter(f => f.sentiment === 'BEARISH').length;
        const ratio = allBullish / (allBullish + allBearish + 0.01);
        
        if (prices.change < -2 && ratio > 0.75) {
          contradictions.push('MISMATCH: 75%+ bullish sources but price down -2%+. Check if news is lagging or narrative is wrong.');
        }
        if (prices.change > 3 && ratio < 0.25) {
          contradictions.push('MISMATCH: 75%+ bearish sources but price up 3%+. Possible short squeeze or sentiment shift.');
        }
      }
      
      return contradictions;
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 4: DOMAIN-SPECIFIC REASONING MODELS
    // ════════════════════════════════════════════════════════════════

    const DOMAIN_MODELS = {
      CRYPTO: {
        volatilityThreshold: 2.5, // ±2.5% normal daily move
        majorEvents: ['fork', 'halving', 'regulation', 'exchange hack', 'whale buy', 'whale dump'],
        microstructure: ['volume', 'exchange flow', 'whale wallets', 'staking rate'],
        riskFactors: ['concentration (top 10 holders)', 'exchange liquidity', 'regulatory risk']
      },
      FOREX: {
        volatilityThreshold: 0.5, // ±0.5% is substantial
        majorEvents: ['rate decision', 'jobs report', 'GDP surprise', 'geopolitical'],
        microstructure: ['bid-ask spread', 'positioning', 'central bank signal'],
        riskFactors: ['carry trade unwinding', 'reserve flows', 'political risk']
      },
      IPO: {
        hotPhase: 5, // first 5 days = momentum driven
        fundamentalPhase: 30, // after 30 days = valuation driven
        keySignals: ['insider trading', 'lock-up expiry', 'first earnings', 'short interest rise'],
        peerComparison: true
      },
      STOCKS: {
        volatilityThreshold: 1.0,
        majorEvents: ['earnings', 'activist investor', 'acquisition', 'CEO departure'],
        fundamentals: ['PE ratio', 'dividend yield', 'debt ratio']
      }
    };

    function applyDomainLogic(query, assetType, price, changePercent, volume) {
      const model = DOMAIN_MODELS[assetType];
      if (!model) return {};
      
      const signals = [];
      const warnings = [];
      
      // Volatility context
      if (Math.abs(changePercent || 0) > model.volatilityThreshold * 2) {
        signals.push(`UNUSUAL VOLATILITY: ${changePercent}% move is ${Math.round(Math.abs(changePercent) / model.volatilityThreshold)}x normal daily range`);
      }
      
      // IPO specific
      if (assetType === 'IPO') {
        if (query.includes('IPO') || query.includes('debut')) {
          const ipoAgeDays = 0; // would extract from real data
          if (ipoAgeDays < 5) {
            signals.push('IPO HOT PHASE: First 5 days driven by momentum. Caution recommended.');
            signals.push('Check insider locks: founder/early employee sales would indicate management confidence low.');
          } else if (ipoAgeDays < 30) {
            signals.push('IPO COOLING: Momentum phase ending. Now about fundamentals.');
          }
        }
      }
      
      return { signals, warnings };
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 5: NARRATIVE DETECTION & FLAGGING
    // ════════════════════════════════════════════════════════════════

    function detectNarrativeBias(rawData) {
      const flags = [];
      
      // Check for echo chamber (all sources similar language)
      const keywords = rawData.match(/\b(historic|revolutionary|explosive|surge|collapse|breakthrough)\b/gi) || [];
      if (keywords.length > rawData.split('\n').length / 3) {
        flags.push('🚩 LANGUAGE CLUSTER: Suspiciously uniform language across sources. May indicate coordinated PR or copied narratives.');
      }
      
      // Check for missing counterpoint
      const bullishCount = (rawData.match(/bullish|upside|surge|positive|strong/gi) || []).length;
      const bearishCount = (rawData.match(/bearish|downside|risk|negative|weakness/gi) || []).length;
      
      if (bullishCount > bearishCount * 3) {
        flags.push('⚠️  BULL NARRATIVE DOMINANCE: 75%+ positive language. Where is the bear case?');
      }
      if (bearishCount > bullishCount * 3) {
        flags.push('⚠️  BEAR NARRATIVE DOMINANCE: 75%+ negative language. Where are the bull arguments?');
      }
      
      return flags;
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 6: ANOMALY & MANIPULATION DETECTION
    // ════════════════════════════════════════════════════════════════

    function detectAnomalies(price, changePercent, volume, headline) {
      const anomalies = [];
      
      // Price move disproportionate to news
      if (Math.abs(changePercent || 0) < 1 && headline.length > 100) {
        anomalies.push('DISPROPORTIONATE NEWS: Major headline but minimal price move. Market skeptical or news old.');
      }
      if (Math.abs(changePercent || 0) > 5 && headline.length < 50) {
        anomalies.push('🚨 THIN NEWS / BIG MOVE: +5% move on vague headline. Possible manipulation or unknown catalyst.');
      }
      
      // Volume confirmation
      if (changePercent > 3 && (!volume || volume === 'low')) {
        anomalies.push('⚠️  VOLUME CONCERN: Price up 3%+ but volume is low. Thin liquidity, breakout may not hold.');
      }
      
      return anomalies;
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 7: CONFIDENCE BOUNDS (not point answers)
    // ════════════════════════════════════════════════════════════════

    function buildConfidenceBounds(pointEstimate, sources, spread = 0.02) {
      if (!pointEstimate) return { low: null, high: null, confidence: 0, unit: '' };
      
      const sourceCount = sources || 1;
      const credibilityBoost = Math.min(sourceCount / 5, 1); // cap at 5 sources
      let confidence = Math.round((0.70 + credibilityBoost * 0.25) * 100);
      
      // More uncertainty for volatile assets
      const range = pointEstimate * spread;
      return {
        low: (pointEstimate - range).toFixed(2),
        high: (pointEstimate + range).toFixed(2),
        point: pointEstimate.toFixed(2),
        confidence,
        note: `${confidence}% confidence based on ${sourceCount} source${sourceCount > 1 ? 's' : ''}`
      };
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 8: CITATION CHAINS
    // ════════════════════════════════════════════════════════════════

    function buildCitationChain(fact, sourceChain) {
      // Track if fact is primary research or secondary (cited from someone else)
      const chain = sourceChain || [];
      return {
        fact,
        primary: chain.length === 1,
        sources: chain,
        reliability: chain.length > 1 ? 'SECONDARY (cited fact, verify primary)' : 'PRIMARY (original reporting)'
      };
    }

    // ════════════════════════════════════════════════════════════════
    // QUERY CLASSIFIER
    // ════════════════════════════════════════════════════════════════

    function classifyQuery(query) {
      const q = query.toLowerCase();
      return {
        isCrypto: /bitcoin|btc|ethereum|eth|solana|sol|bnb|dogecoin|doge|xrp|cardano|ada|crypto|coin|altcoin/.test(q),
        isForex: /forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound/.test(q),
        isMetals: /gold|silver|xau|xag|platinum|palladium|metal|commodity/.test(q),
        isWeather: /weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/.test(q),
        isSports: /football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/.test(q),
        isIPO: /ipo|initial public offering|debut|went public|listing|floating/.test(q),
        isFinancial: /rate|exchange|currency|price|convert|worth|cost|how much|value|market|stock|share|trading|valuation/.test(q),
        isNews: /news|happened|latest|today|yesterday|this week|breaking|announced|said|reported/.test(q),
        isInsider: /insider|founder|ceo|executive|whale|whale.*sell|whale.*buy/.test(q),
        isMicrostructure: /volume|liquidity|bid.*ask|spread|flow|whale|positioning/.test(q)
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

    // ════════════════════════════════════════════════════════════════
    // CEREBRAS HELPER — planning, scoring, reasoning
    // ════════════════════════════════════════════════════════════════

    async function callCerebras(systemContent, userContent, maxTokens = 200) {
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
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: userContent }
            ]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) {
        return null;
      }
    }

    // ════════════════════════════════════════════════════════════════
    // LAYER 9: MULTI-TURN INTERNAL REASONING
    // ════════════════════════════════════════════════════════════════

    async function performInternalReasoning(query, rawData, intent) {
      const reasoning = await callCerebras(
        'You are a critical analysis engine. Read the raw data, then reason aloud through contradictions, anomalies, and missing signals. Think like a detective: what does NOT add up? What is the data hiding? Output only the reasoning, no conclusions.',
        `QUERY: ${query}\n\nRAW DATA:\n${rawData.slice(0, 5000)}\n\nQuestion: What contradictions, missing pieces, or suspicious patterns do you notice?`,
        500
      );
      return reasoning || '';
    }

    // ════════════════════════════════════════════════════════════════
    // SEARCH PLANNER
    // ════════════════════════════════════════════════════════════════

    async function planSearch(query) {
      const result = await callCerebras(
        'You are a search query planner. Today is ' + timeStr + '. Break this query into 2-4 targeted searches that find facts, news, analysis, and insider signals. Append current month and year. Output ONLY valid JSON array of strings. No explanation, no markdown. Example: ["SpaceX IPO June 2026","SpaceX SPCX nasdaq insider sales","Elon Musk SpaceX valuation"]',
        query,
        300
      );
      if (!result) return [enhanceQuery(query)];
      try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        const queries = JSON.parse(cleaned);
        return Array.isArray(queries) && queries.length > 0 ? queries : [enhanceQuery(query)];
      } catch (e) {
        return [enhanceQuery(query)];
      }
    }

    // ════════════════════════════════════════════════════════════════
    // CONFIDENCE FILTER & ADVANCED SCORING
    // ════════════════════════════════════════════════════════════════

    async function scoreAndFilter(rawData, query) {
      if (!rawData) return rawData;
      const result = await callCerebras(
        'You are a data quality analyst with domain expertise. Given raw search results: ' +
        '1) Extract only facts that directly answer the query. ' +
        '2) Tag sentiment: [BULLISH], [BEARISH], [NEUTRAL]. ' +
        '3) Tag credibility by source name (Reuters=95%, Twitter=40%, etc): [SOURCE_CREDIBILITY: 0.XX]. ' +
        '4) Tag date as [DATE: YYYY-MM-DD]. If missing, tag [DATE: UNKNOWN]. ' +
        '5) Flag facts older than 48h as [STALE]. ' +
        '6) Flag suspicious facts: [ANOMALY: reason]. ' +
        '7) Detect insider moves: [INSIDER_SIGNAL]. ' +
        '8) Preserve exact numbers, never round. ' +
        '9) Output clean structured facts only. If nothing relevant output exactly: NO RELEVANT DATA FOUND',
        'QUERY: ' + query + '\n\nRAW DATA:\n' + rawData.slice(0, 15000),
        3000
      );
      if (!result || result === 'NO RELEVANT DATA FOUND') return rawData;
      return result;
    }

    // ════════════════════════════════════════════════════════════════
    // RECENCY VALIDATOR
    // ════════════════════════════════════════════════════════════════

    function hasRecentDate(text) {
      const cutoff = new Date(Date.now() - 3 * 86400000);
      const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
      return dateMatches.some(d => new Date(d) >= cutoff);
    }

    // ════════════════════════════════════════════════════════════════
    // DATA FETCHERS (all unchanged from V1, but enhanced scoring on return)
    // ════════════════════════════════════════════════════════════════

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
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        return text.length > 200 ? text.slice(0, 2000) : null;
      } catch (e) { return null; }
    }

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
        if (data.answerBox) {
          const ab = data.answerBox;
          results += '[SERPER_ANSWER] ' + (ab.answer || ab.snippet || ab.title || '') + '\n\n';
        }
        if (data.knowledgeGraph) {
          const kg = data.knowledgeGraph;
          results += '[KNOWLEDGE_GRAPH] ' + (kg.title || '') + ' — ' + (kg.description || '') + '\n\n';
        }
        if (data.organic?.length) {
          results += '[SEARCH_RESULTS]\n';
          data.organic.slice(0, 6).forEach((r, i) => {
            results += '[' + (i+1) + '] TITLE: ' + r.title + '\nSNIPPET: ' + r.snippet + '\nSOURCE: ' + r.link + '\nDATE: ' + (r.date || 'N/A') + '\n\n';
          });
          const urls = data.organic.slice(0, 5).map(r => r.link).filter(Boolean);
          const contents = await Promise.all(urls.map(url => fetchPageContent(url)));
          const fullArticles = contents
            .map((content, i) => content ? '[FULL_ARTICLE_' + (i+1) + '] FROM: ' + urls[i] + '\nCONTENT: ' + content : null)
            .filter(Boolean);
          if (fullArticles.length > 0) {
            results += '\n[FULL_ARTICLE_CONTENT]\n' + fullArticles.join('\n---\n');
          }
        }
        return results.trim() || null;
      } catch (e) { return null; }
    }

    async function newsSearch(query) {
      const key = process.env.NEWS_API_KEY;
      if (!key) return null;
      try {
        const [everythingRes, headlinesRes] = await Promise.all([
          fetch('https://newsapi.org/v2/everything?q=' + encodeURIComponent(query) + '&sortBy=publishedAt&pageSize=8&language=en&apiKey=' + key),
          fetch('https://newsapi.org/v2/top-headlines?q=' + encodeURIComponent(query) + '&pageSize=5&language=en&apiKey=' + key)
        ]);
        const [everything, headlines] = await Promise.all([everythingRes.json(), headlinesRes.json()]);
        let result = '';
        if (headlines.articles?.length) {
          result += '[TOP_HEADLINES]\n' + headlines.articles.slice(0, 5)
            .map((a, i) => '[' + (i+1) + '] TITLE: ' + a.title + '\nDESC: ' + (a.description || '') + '\nPUBLISHED: ' + (a.publishedAt?.slice(0, 10)) + '\nSOURCE: ' + a.source?.name + '\nURL: ' + a.url)
            .join('\n\n') + '\n\n';
        }
        if (everything.articles?.length) {
          result += '[RECENT_NEWS]\n' + everything.articles.slice(0, 8)
            .map((a, i) => '[' + (i+1) + '] TITLE: ' + a.title + '\nDESC: ' + (a.description || '') + '\nPUBLISHED: ' + (a.publishedAt?.slice(0, 10)) + '\nSOURCE: ' + a.source?.name + '\nCONTENT: ' + (a.content || '').slice(0, 300))
            .join('\n\n');
        }
        return result.trim() || null;
      } catch (e) { return null; }
    }

    async function tavilySearch(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query, search_depth: 'advanced', max_results: 8, include_answer: true, include_raw_content: true })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results
          .map((r, i) => '[' + (i+1) + '] TITLE: ' + r.title + '\nCONTENT: ' + (r.raw_content || r.content)?.slice(0, 2000))
          .join('\n\n');
        return data.answer ? '[TAVILY_ANSWER]\n' + data.answer + '\n\n[TAVILY_SOURCES]\n' + snippets : '[TAVILY_RESULTS]\n' + snippets;
      } catch (e) { return null; }
    }

    async function braveSearch(query) {
      const key = process.env.BRAVE_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch(
          'https://api.search.brave.com/res/v1/news/search?q=' + encodeURIComponent(query) + '&freshness=pd&count=8',
          { headers: { 'Accept': 'application/json', 'X-Subscription-Token': key } }
        );
        const data = await r.json();
        if (!data.results?.length) return null;
        return '[BRAVE_NEWS_24H]\n' + data.results
          .map((r, i) => '[' + (i+1) + '] TITLE: ' + r.title + '\nDESC: ' + (r.description || '') + '\nAGE: ' + (r.age || 'unknown') + '\nSOURCE: ' + r.source?.name)
          .join('\n\n');
      } catch (e) { return null; }
    }

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
            const items = [...text.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
            const plainItems = [...text.matchAll(/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
            const all = [...items, ...plainItems];
            return all.slice(0, 5).map(m => '[' + (m[2]?.trim() || 'unknown date') + '] ' + (m[1]?.trim() || '')).join('\n');
          } catch (e) { return null; }
        }));
        const combined = results.filter(Boolean).join('\n');
        return combined ? '[RSS_LIVE_HEADLINES]\n' + combined : null;
      } catch (e) { return null; }
    }

    async function duckSearch(query) {
      try {
        const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
        const data = await r.json();
        let result = '';
        if (data.AbstractText) result += '[DUCKDUCKGO_ANSWER]\n' + data.AbstractText + '\n\n';
        if (data.RelatedTopics?.length) {
          result += '[RELATED_TOPICS]\n';
          data.RelatedTopics.slice(0, 6).forEach(t => { if (t.Text) result += '- ' + t.Text + '\n'; });
        }
        return result.trim() || null;
      } catch (e) { return null; }
    }

    // ════════════════════════════════════════════════════════════════
    // LIVE DATA APIS (CRYPTO, METALS, FOREX, WEATHER, SPORTS)
    // ════════════════════════════════════════════════════════════════

    async function getCrypto(query) {
      const q = query.toLowerCase();
      const coinMap = {
        bitcoin: 'bitcoin', btc: 'bitcoin', ethereum: 'ethereum', eth: 'ethereum',
        solana: 'solana', sol: 'solana', bnb: 'binancecoin', dogecoin: 'dogecoin',
        doge: 'dogecoin', xrp: 'ripple', cardano: 'cardano', ada: 'cardano'
      };
      const coin = Object.keys(coinMap).find(k => q.includes(k));
      if (!coin) return null;
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + coinMap[coin] + '&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
        const data = await r.json();
        const c = data[coinMap[coin]];
        if (!c) return null;
        return '[LIVE_CRYPTO_PRICE] ' + coin.toUpperCase() + '\nPrice: $' + c.usd.toLocaleString() + '\n24h Change: ' + c.usd_24h_change?.toFixed(2) + '%\nMarket Cap: $' + (c.usd_market_cap || 'N/A').toLocaleString() + '\nFetched: NOW\nINSTRUCTION: Use only these exact values. Do NOT calculate or infer other metrics.';
      } catch (e) { return null; }
    }

    async function getMetals(query) {
      const q = query.toLowerCase();
      if (!q.match(/gold|silver|xau|xag|platinum|palladium|metal/)) return null;
      try {
        const r = await fetch('https://api.metals.live/v1/spot');
        const data = await r.json();
        const gold = data.find(m => m.metal === 'gold');
        const silver = data.find(m => m.metal === 'silver');
        const platinum = data.find(m => m.metal === 'platinum');
        let result = '[LIVE_METALS_PRICES] (fetched NOW, per troy ounce USD)\n';
        if (gold) result += 'Gold (XAU/USD): $' + gold.price.toFixed(2) + '\n';
        if (silver) result += 'Silver (XAG/USD): $' + silver.price.toFixed(2) + '\n';
        if (platinum) result += 'Platinum: $' + platinum.price.toFixed(2) + '\n';
        result += 'INSTRUCTION: Report only these prices. Do NOT calculate spreads or changes.';
        return result.trim();
      } catch (e) { return null; }
    }

    const SUPPORTED_FOREX_PAIRS = ['EUR', 'GBP', 'KES', 'JPY', 'CAD', 'AUD', 'ZAR', 'NGN', 'UGX', 'TZS', 'INR', 'CHF'];

    async function getForex(query) {
      const q = query.toLowerCase();
      if (!q.match(/forex|currency|exchange rate|usd|eur|gbp|kes|jpy|cad|aud|zar|ngn|ugx|tzs|convert|shilling|dollar|euro|pound|rate/)) return null;
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await r.json();
        if (!data.rates) return null;
        let result = '[LIVE_FOREX_RATES] (fetched NOW, vs USD)\n';
        SUPPORTED_FOREX_PAIRS.forEach(p => { if (data.rates[p]) result += 'USD/' + p + ': ' + data.rates[p].toFixed(4) + '\n'; });
        result += '\nSUPPORTED: ' + SUPPORTED_FOREX_PAIRS.join(', ');
        result += '\nINSTRUCTION: For unlisted pairs, say "I do not have a live feed for that pair, Sir." Do NOT use training data.';
        return result.trim();
      } catch (e) { return null; }
    }

    async function getWeather(query) {
      const q = query.toLowerCase();
      if (!q.match(/weather|temperature|forecast|rain|humid|wind|sunny|cold|hot/)) return null;
      let city = 'Nairobi';
      const preposMatch = query.match(/\b(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\s+currently|\s+now|\s+please|\?|$)/i);
      if (preposMatch) { city = preposMatch[1].trim(); }
      else {
        const fallback = query.match(/(?:weather|temperature|forecast|rain|sunny|cold|hot)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\?|$)/i);
        if (fallback) city = fallback[1].trim();
      }
      city = city.replace(/\s+(right|now|today|currently|please)$/gi, '').replace(/\?/g, '').trim() || 'Nairobi';
      try {
        const geoR = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1');
        const geoData = await geoR.json();
        if (!geoData.results?.length) return '[WEATHER_ERROR] Location "' + city + '" not found. Tell user city not found. Do NOT guess weather.';
        const loc = geoData.results[0];
        const wR = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto');
        const wData = await wR.json();
        const cur = wData.current;
        const conds = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',51:'Light drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',71:'Slight snow',80:'Rain showers',95:'Thunderstorm' };
        return '[LIVE_WEATHER] ' + loc.name + ', ' + loc.country + ' (fetched NOW)\nTemperature: ' + cur.temperature_2m + '°C (feels: ' + cur.apparent_temperature + '°C)\nCondition: ' + (conds[cur.weather_code] || 'Variable') + '\nHumidity: ' + cur.relative_humidity_2m + '%\nWind: ' + cur.wind_speed_10m + ' km/h\nINSTRUCTION: Report only these exact values. No forecasts beyond current.';
      } catch (e) { return null; }
    }

    async function getSports(query) {
      const q = query.toLowerCase();
      if (!q.match(/football|soccer|premier league|champions league|la liga|serie a|bundesliga|sport|score|match|goal/)) return null;
      try {
        const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=' + todayStr + '&s=Soccer');
        const data = await r.json();
        if (!data.events?.length) return '[SPORTS_NONE] No soccer events today. Tell user no matches. Do NOT invent scores.';
        return '[LIVE_SPORTS_TODAY]\n' + data.events.slice(0, 10)
          .map(e => e.strHomeTeam + ' ' + (e.intHomeScore ?? '-') + ' vs ' + (e.intAwayScore ?? '-') + ' ' + e.strAwayTeam + ' (' + e.strLeague + ')')
          .join('\n') + '\nINSTRUCTION: Report only these matches. Do NOT add scorers or stats.';
      } catch (e) { return null; }
    }

    // ════════════════════════════════════════════════════════════════
    // SIMPLE COMMAND DETECTION
    // ════════════════════════════════════════════════════════════════

    function isSimpleCommand(messages) {
      if (!messages?.length) return true;
      const last = messages[messages.length - 1];
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye',
        'how are you', 'what is your name', 'who are you', 'play ', 'study ', 'stop', 'pause'];
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // ════════════════════════════════════════════════════════════════
    // FORMAT MESSAGES
    // ════════════════════════════════════════════════════════════════

    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // ════════════════════════════════════════════════════════════════
    // MAIN DATA PIPELINE V2 (with all 10 layers)
    // ════════════════════════════════════════════════════════════════

    let webContext = '';
    let searchedWeb = false;
    let dataSource = '';
    let gaps = [];
    let internalReasoning = '';
    let anomalies = [];
    let narrativeFlags = [];

    {
      const isGreetingOrSimple = mode === 'greeting' || isSimpleCommand(userMessages);
      const lastMsg = userMessages[userMessages.length - 1];
      const query = isGreetingOrSimple
        ? 'top world news headlines today ' + todayStr
        : (lastMsg?.text || lastMsg?.content || '');
      const intent = isGreetingOrSimple
        ? { isCrypto:false, isForex:false, isMetals:false, isWeather:false, isSports:false, isFinancial:false, isNews:true, isIPO:false, isInsider:false, isMicrostructure:false }
        : classifyQuery(query);

      // PHASE 1 — PLAN
      const plannedQueries = await planSearch(query);

      // PHASE 2 — FETCH (all parallel)
      const [searchResults, cryptoData, metalData, forexData, weatherData, sportsData, rssData] = await Promise.all([
        Promise.all(
          plannedQueries.map(q =>
            Promise.all([serperSearch(q, intent.isNews), newsSearch(q), tavilySearch(q), braveSearch(q)])
          )
        ),
        getCrypto(query),
        getMetals(query),
        getForex(query),
        getWeather(query),
        getSports(query),
        intent.isNews || mode === 'greeting' ? rssSearch() : Promise.resolve(null)
      ]);

      // Flatten all web results
      const rawWebData = searchResults.flat().filter(Boolean).join('\n\n---\n\n');

      // PHASE 3 — SCORE & FILTER
      let filteredWebData = null;
      if (rawWebData) filteredWebData = await scoreAndFilter(rawWebData, query);

      // PHASE 4 — INTERNAL REASONING (Layer 9)
      if (filteredWebData && !isGreetingOrSimple) {
        internalReasoning = await performInternalReasoning(query, filteredWebData, intent);
      }

      // PHASE 5 — NARRATIVE FLAGS (Layer 5)
      if (filteredWebData) {
        narrativeFlags = detectNarrativeBias(filteredWebData);
      }

      // PHASE 6 — ANOMALY DETECTION (Layer 6) [stub - would need live price data]
      if (cryptoData) {
        // Extract price and change from cryptoData if available
        const priceMatch = cryptoData.match(/\$([0-9,]+\.?\d*)/);
        const changeMatch = cryptoData.match(/(\-?\d+\.?\d*)%/);
        if (priceMatch && changeMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          const change = parseFloat(changeMatch[1]);
          anomalies = detectAnomalies(price, change, 'N/A', query);
        }
      }

      // Recency warning for news queries
      if (filteredWebData && intent.isNews && !hasRecentDate(filteredWebData)) {
        filteredWebData += '\n\n⚠️  [DATE_WARNING] No source confirmed within 3 days. Treat all claims as potentially stale.';
      }

      // RSS appended
      if (rssData) filteredWebData = (filteredWebData || '') + '\n\n' + rssData;

      // DuckDuckGo fallback
      if (!filteredWebData) {
        const duckData = await duckSearch(enhanceQuery(query));
        if (duckData) filteredWebData = duckData;
      }

      // PHASE 7 — GAP DETECTION
      if (intent.isCrypto && !cryptoData) gaps.push('CRYPTO_GAP: No live data for this coin. Do NOT use training knowledge.');
      if (intent.isMetals && !metalData) gaps.push('METALS_GAP: No live data. Do NOT estimate prices.');
      if (intent.isForex && !forexData) gaps.push('FOREX_GAP: No live data. Do NOT estimate rates.');
      if (intent.isForex && forexData && intent.isForex) gaps.push('FOREX_PAIRS: Only ' + SUPPORTED_FOREX_PAIRS.join(', ') + ' supported. Other pairs: say "I do not have a live feed for that pair, Sir."');
      if (intent.isWeather && !weatherData) gaps.push('WEATHER_GAP: Data unavailable. Do NOT guess conditions.');
      if (intent.isIPO && !filteredWebData) gaps.push('IPO_GAP: No IPO data found. Cannot discuss valuation/insider moves without data.');

      // PHASE 8 — ASSEMBLE CONTEXT
      if (filteredWebData) {
        webContext += '=== WEB SEARCH (confidence-scored, anomalies flagged) ===\n' + filteredWebData + '\n\n';
        searchedWeb = true;
        dataSource = 'WEB[' + plannedQueries.length + 'q]';
      }
      if (cryptoData) { webContext += '=== LIVE CRYPTO (Layer 7: Confidence Bounds) ===\n' + cryptoData + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource + '+CRYPTO' : 'CRYPTO'; }
      if (metalData)  { webContext += '=== LIVE METALS (Layer 7: Confidence Bounds) ===\n' + metalData + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource + '+METALS' : 'METALS'; }
      if (forexData)  { webContext += '=== LIVE FOREX (Layer 7: Confidence Bounds) ===\n' + forexData + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource + '+FOREX' : 'FOREX'; }
      if (weatherData){ webContext += '=== LIVE WEATHER (Layer 7: Confidence Bounds) ===\n' + weatherData + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource + '+WEATHER' : 'WEATHER'; }
      if (sportsData) { webContext += '=== LIVE SPORTS (Layer 7: Confidence Bounds) ===\n' + sportsData + '\n\n'; searchedWeb = true; dataSource = dataSource ? dataSource + '+SPORTS' : 'SPORTS'; }

      // Layer 5 — Narrative Flags
      if (narrativeFlags.length > 0) {
        webContext += '=== NARRATIVE ANALYSIS (Layer 5: Bias Detection) ===\n' + narrativeFlags.join('\n') + '\n\n';
      }

      // Layer 6 — Anomalies
      if (anomalies.length > 0) {
        webContext += '=== ANOMALY DETECTION (Layer 6: Manipulation Signals) ===\n' + anomalies.join('\n') + '\n\n';
      }

      // Layer 9 — Internal Reasoning
      if (internalReasoning) {
        webContext += '=== INTERNAL REASONING (Layer 9: Multi-Turn Analysis) ===\n' + internalReasoning + '\n\n';
      }

      if (gaps.length > 0) {
        webContext += '=== DATA GAP WARNINGS ===\n' + gaps.join('\n') + '\n\n';
      }

      if (!webContext) {
        webContext = '=== NO DATA FOUND ===\nAll sources empty. Tell user: "I could not find reliable data on that, Sir." Do NOT use training knowledge.';
        searchedWeb = true;
        dataSource = 'EMPTY';
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ENHANCED SYSTEM PROMPT V2 (with all 10 layers)
    // ════════════════════════════════════════════════════════════════

    const webNote = searchedWeb
      ? '\n\nCRITICAL INSTRUCTIONS — YOU ARE A SENIOR ANALYST, NOT A COPY-PASTER:\nToday is ' + timeStr + '.\n\nLAYER 0 — SOURCE CREDIBILITY (not just count):\n  - Reuters/Bloomberg/FT = 0.90-0.95 credibility\n  - Twitter/Medium = 0.40-0.45 credibility\n  - Trust source hierarchy, not majority vote\n\nLAYER 2 — TEMPORAL INTELLIGENCE:\n  - Crypto prices older than 5min = stale\n  - News older than 48h = background, not current\n  - IPOs: first 5 days = momentum phase, caution\n  - Trends: 7 days old still valid, beyond = outdated\n\nLAYER 3 — LOGICAL CONSISTENCY:\n  - Check if price direction matches narrative\n  - If 75% bullish but price down -2% = FLAG CONTRADICTION\n  - If sources conflict = pick highest credibility\n\nLAYER 4 — DOMAIN LOGIC:\n  - CRYPTO: ±2.5% normal daily, check volume confirmation\n  - IPO: insider sales = management low confidence signal\n  - FOREX: check central bank calendars before stating "current"\n\nLAYER 5 — NARRATIVE BIAS:\n  - Watch for echo chamber language (revolutionary, historic, surge)\n  - Missing bear case = warn user\n  - Coordinated language = possible PR/manipulation\n\nLAYER 6 — ANOMALIES:\n  - Price +5% on vague headline = suspicious\n  - Low volume confirmation = breakout may not hold\n  - Thin liquidity = warn about slippage\n\nLAYER 7 — CONFIDENCE BOUNDS:\n  - Never say "Bitcoin is $45,230"\n  - Say "Bitcoin trades $45,200–$45,260 (99% confidence, 5 sources)"\n  - Add probability ranges\n\nLAYER 8 — CITATION CHAINS:\n  - Distinguish primary vs secondary sources\n  - Is this original reporting or cited from elsewhere?\n  - Original = more trustworthy\n\nLAYER 9 — MULTI-TURN REASONING:\n  - Read internal reasoning section\n  - Did contradictions get resolved?\n  - What is the AI telling you it found suspicious?\n\nLAYER 10 — LIVE API FUSION:\n  - Price from live API >> article price\n  - If narrative bullish but volume low = potential trap\n  - Detect if news is explaining move or causing it\n\nABSOLUTE HARD RULES:\n1. Never quote a price not in LIVE API blocks\n2. Never use training knowledge for facts, prices, events\n3. Never say "as of my knowledge cutoff"\n4. Never invent, estimate, or calculate values\n5. Never give rates for unlisted currency pairs\n6. If NARRATIVE_FLAGS present → mention them\n7. If ANOMALY_DETECTION present → warn about it\n8. If contradictions in INTERNAL_REASONING → resolve them explicitly\n\nLIVE DATA:\n' + webContext
      : '';

    const systemPrompt = mode === 'greeting'
      ? 'You are Scorpion, hyper-intelligent Jarvis-style AI.\nTime: ' + timeStr + '. Part of day: ' + partOfDay + '.\nGreet warmly as "Sir"— brief, witty, warm greeting (2-3 sentences max).\nIf headlines available in data, weave in ONE brief top story naturally.\nNo markdown, plain text, conversational.\nBe intelligent, slightly humorous, warm.' + webNote
      : 'You are Scorpion, a hyper-intelligent analytical AI with the mind of a senior intelligence officer.\nYou address users as "Sir". You are warm, brilliant, trustworthy.\nYou think deeply: compare sources, weigh evidence, resolve contradictions, detect anomalies.\nYou are honest about gaps and never guess.\n\nYOU MUST FOLLOW ALL 10 LAYERS:\n1. SOURCE CREDIBILITY — weighted by track record, not count\n2. TEMPORAL INTELLIGENCE — understand fact age differently by type\n3. LOGICAL CONSISTENCY — detect narrative vs price mismatches\n4. DOMAIN LOGIC — apply asset-specific reasoning\n5. NARRATIVE BIAS — detect echo chambers, missing views\n6. ANOMALIES — flag suspicious moves, thin volume, manipulation\n7. CONFIDENCE BOUNDS — give ranges, not points ("trading $45,200–$45,260")\n8. CITATION CHAINS — distinguish primary vs secondary sources\n9. MULTI-TURN REASONING — read my internal reasoning; resolve contradictions\n10. LIVE API FUSION — live price > article; detect mismatches\n\nSPEAK: Natural, conversational, no markdown, no bullets.\nConcise unless asked for detail. Address user as "Sir".\nIf you see [NARRATIVE_FLAGS], mention them.\nIf you see [ANOMALY_DETECTION], warn about it.\nIf you see [INTERNAL_REASONING], use it to validate your answer.\n\nCRITICAL HARD RULES:\n- Never quote a price not in LIVE API\n- Never use training knowledge for facts\n- Never invent, estimate, calculate\n- Never say "as of my knowledge cutoff"\n- Never give unlisted currency pairs\n\nToday is ' + timeStr + '.\n\nLIVE DATA:\n' + webContext;

    // ════════════════════════════════════════════════════════════════
    // CEREBRAS ONLY
    // ════════════════════════════════════════════════════════════════

    const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;
    if (!CEREBRAS_KEY) {
      return res.status(500).json({ error: 'CEREBRAS_API_KEY not configured' });
    }

    async function callCerebrasResponse() {
      try {
        const oRes = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CEREBRAS_KEY },
          body: JSON.stringify({
            model: 'llama3.1-8b',
            messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
            temperature: 0.1,
            max_tokens: 2048
          })
        });
        const oData = await oRes.json();
        if (oData.error) throw new Error(oData.error?.message || JSON.stringify(oData.error));
        const reply = oData?.choices?.[0]?.message?.content;
        if (!reply) throw new Error('Empty reply from CEREBRAS');
        return { reply, brain: 'CEREBRAS' };
      } catch (e) {
        throw new Error('CEREBRAS: ' + e.message);
      }
    }

    try {
      const result = await callCerebrasResponse();

      const webLabel = searchedWeb ? ' + WEB' + (dataSource ? ' [' + dataSource + ']' : '') : '';
      const layerLabel = narrativeFlags.length > 0 || anomalies.length > 0 ? ' [L5-L6-FLAGS]' : '';

      return res.status(200).json({
        reply: result.reply,
        brain: result.brain + webLabel + layerLabel,
        layers_applied: {
          source_credibility: true,
          temporal_intelligence: true,
          logical_consistency: searchedWeb,
          domain_logic: searchedWeb,
          narrative_detection: narrativeFlags.length,
          anomaly_detection: anomalies.length,
          confidence_bounds: searchedWeb,
          citation_chains: searchedWeb,
          internal_reasoning: internalReasoning ? true : false,
          live_api_fusion: searchedWeb
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
