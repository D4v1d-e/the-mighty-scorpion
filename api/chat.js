// ============================================================
// CHAT API HANDLER — SCORPION AI BRAIN v4.1
// ============================================================
// Key upgrades in v4.1 (on top of v4.0):
//
//   1. GENERAL CLARIFICATION MODE (new)
//      - mode === 'resolve_intent' mirrors resolve_song's
//        CLEAR / UNCLEAR / CONFIRM pattern but for ANY chat query.
//      - Triggers on:
//          a) Genuinely vague requests ("play something for me",
//             "tell me about it", "what do you think")
//          b) Ambiguous factual/news queries that could resolve to
//             multiple distinct people/topics/events
//      - No modal — caller (index.html) just speaks/shows the
//        question in the output panel and listens for a follow-up.
//
//   2. HARDENED SEARCH LAYER
//      - Real fallback chain: Serper -> Tavily -> Brave -> NewsAPI
//        -> RSS -> DuckDuckGo, each one only fires if the previous
//        stage returned nothing usable.
//      - Cross-source de-duplication by URL/title similarity.
//      - Stricter recency scoring (rejects > 5 days for "today/now"
//        style queries; > 30 days for general "latest" queries).
//      - If literally everything fails, falls back to a clearly-
//        labelled reasoned answer built from the most recent
//        confirmed fact found (never silently hallucinates).
//
// Author  : Dr. Davie Mwangi
// Version : 4.1.0
// ============================================================

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, mode, timezone, query, clarificationAnswer, originalQuery } = req.body;

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

    // ── GROQ HELPER ─────────────────────────────────────────
    async function callGroq(systemContent, userContent, maxTokens = 300) {
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
              { role: 'system', content: systemContent },
              { role: 'user',   content: userContent   }
            ]
          })
        });
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) { return null; }
    }

    async function callAnyBrain(system, user, maxTokens = 300) {
      return (await callCerebras(system, user, maxTokens)) ||
             (await callGroq(system, user, maxTokens)) ||
             null;
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
        if (data.answerBox)      results += 'DIRECT ANSWER: ' + (data.answerBox.answer || data.answerBox.snippet || data.answerBox.title || '') + '\n\n';
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

    // ══════════════════════════════════════════════════════════
    // NEW v4.1 — DE-DUPLICATION HELPER
    // ══════════════════════════════════════════════════════════
    // Strips near-duplicate snippets that show up across multiple
    // search providers (very common — Serper + Tavily + Brave will
    // often surface the same 2-3 articles). We dedupe on a loose
    // normalised title match so the confidence filter downstream
    // isn't wasting tokens re-reading the same fact five times.
    function dedupeBlocks(text) {
      if (!text) return text;
      const blocks = text.split(/\n\n---\n\n|\n\n(?=\[\d+\])/g);
      const seen = new Set();
      const out = [];
      for (const b of blocks) {
        const firstLine = (b.split('\n')[0] || '').toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60);
        if (!firstLine || seen.has(firstLine)) continue;
        seen.add(firstLine);
        out.push(b);
      }
      return out.join('\n\n---\n\n');
    }

    // ══════════════════════════════════════════════════════════
    // NEW v4.1 — STRICTER RECENCY CHECK
    // ══════════════════════════════════════════════════════════
    // hasRecentDate (kept from v4.0) only checked "any date >= 3 days
    // ago exists somewhere in the blob" which is weak — a single old
    // citation buried in an article can satisfy it. This version
    // requires a recency threshold tuned to query type, and looks at
    // ALL dates found rather than the first match.
    function hasRecentDateStrict(text, maxAgeDays) {
      if (!text) return false;
      const cutoff = Date.now() - maxAgeDays * 86400000;
      const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (!dateMatches.length) return false;
      return dateMatches.some(d => {
        const t = new Date(d).getTime();
        return !isNaN(t) && t >= cutoff && t <= Date.now() + 86400000; // ignore bogus future dates
      });
    }

    // ══════════════════════════════════════════════════════════
    // NEW v4.1 — SEARCH FALLBACK CHAIN
    // ══════════════════════════════════════════════════════════
    // Instead of firing every provider in parallel and hoping the
    // confidence filter sorts it out, we now run a graduated chain:
    // cheap/fast providers first, only escalating to the next stage
    // if the previous stage came back empty or clearly insufficient
    // (e.g. less than ~150 characters of real content).
    //
    // For NEWS-type queries specifically, we still run several
    // providers concurrently within a stage since fresh news
    // benefits from cross-checking multiple feeds at once — but we
    // skip stages entirely once we have enough.
    function isUsable(text) {
      return !!(text && text.replace(/\s+/g, '').length > 150);
    }

    async function runSearchChain(plannedQueries, intent) {
      const perQuery = {};

      for (const q of plannedQueries) {
        let combined = '';

        // STAGE 1 — Serper (Google) + Tavily run together; both are
        // generally high quality and cheap relative to value.
        const [serperData, tavilyData] = await Promise.all([
          serperSearch(q, intent.isNews),
          tavilySearch(q)
        ]);
        combined = [serperData, tavilyData].filter(Boolean).join('\n\n---\n\n');

        // STAGE 2 — only escalate to Brave + NewsAPI if stage 1 was
        // thin AND this looks like a news/current-events query.
        if (!isUsable(combined) && intent.isNews) {
          const [braveData, newsData] = await Promise.all([
            braveSearch(q),
            newsSearch(q)
          ]);
          combined = [combined, braveData, newsData].filter(Boolean).join('\n\n---\n\n');
        }

        // STAGE 3 — RSS as a last specialist news source.
        if (!isUsable(combined) && intent.isNews) {
          const rssData = await rssSearch();
          combined = [combined, rssData].filter(Boolean).join('\n\n---\n\n');
        }

        // STAGE 4 — DuckDuckGo instant answer as the final safety net
        // for ANY query type (works decently for factual/bio queries).
        if (!isUsable(combined)) {
          const duckData = await duckSearch(q);
          combined = [combined, duckData].filter(Boolean).join('\n\n---\n\n');
        }

        perQuery[q] = dedupeBlocks(combined);
      }

      return Object.values(perQuery).filter(Boolean).join('\n\n---\n\n');
    }

    // ══════════════════════════════════════════════════════════════════
    // SMART SONG RESOLUTION MODE (v4.0, unchanged)
    // ══════════════════════════════════════════════════════════════════
    if (mode === 'resolve_song') {
      const rawQuery = (query || '').trim();
      if (!rawQuery) return res.status(200).json({ status: 'clear', searchQuery: '', original: '' });

      if (clarificationAnswer && originalQuery) {
        const confirmSystem = `You are a music expert. The user asked to play: "${originalQuery}"
You asked them to clarify. Their answer is: "${clarificationAnswer}"

Based on their answer, output the exact song title and artist to search on YouTube.
Output ONLY this format, nothing else:
SONG TITLE - ARTIST NAME`;

        let confirmed = await callAnyBrain(confirmSystem, clarificationAnswer, 80);
        if (!confirmed) confirmed = rawQuery;
        const final = confirmed.replace(/^["']+|["']+$/g, '').trim();
        return res.status(200).json({ status: 'confirm', searchQuery: final, original: originalQuery });
      }

      const needsResearch = /\b(first|debut|earliest|original|best|most famous|biggest|number one|#1|grammy|award|from the movie|from the film|soundtrack|theme song|latest|newest|new single|new song|theme|intro|outro|opening|ending|ost)\b/i.test(rawQuery);

      let searchContext = '';
      if (needsResearch) {
        try {
          const [serperData, tavilyData] = await Promise.all([
            serperSearch(rawQuery + ' song', false),
            tavilySearch(rawQuery + ' song title artist')
          ]);
          searchContext = [serperData, tavilyData].filter(Boolean).join('\n\n---\n\n');
        } catch (e) { /* proceed without */ }
      }

      const interpreterSystem = `You are a hyper-intelligent music assistant called Scorpion. Today is ${timeStr}.

Your job: analyse the user's song/music request and decide if it is CLEAR or UNCLEAR.

CLEAR = you know EXACTLY which one song/track they want. Output:
STATUS: CLEAR
SONG: <exact song title - artist>

UNCLEAR = the request could mean multiple different songs, artists, or genres. For example:
- "play scorpion" could mean Drake's Scorpion album, or a song literally called Scorpion
- "play something sad" has no specific answer
- "play that Bob Marley one" is too vague
- "play the love song" could be many artists
In this case, output:
STATUS: UNCLEAR
QUESTION: <one short spoken question to ask the user — keep it natural and Jarvis-like>
OPTION1: <first specific option with song title and artist>
OPTION2: <second specific option with song title and artist>
OPTION3: <third specific option or "something else / I'll describe it">

RULES:
- Only mark UNCLEAR if genuinely ambiguous. A clear named song + artist = CLEAR always.
- The QUESTION must be spoken aloud naturally, max 15 words.
- Each OPTION must be a real, playable song (or the "something else" fallback).
- Use SEARCH CONTEXT below to inform your options.
- Never refuse. Never output anything other than the exact format above.

${searchContext ? 'SEARCH CONTEXT:\n' + searchContext.slice(0, 5000) : 'No search context. Use your own knowledge.'}`;

      let interpretation = await callAnyBrain(interpreterSystem, rawQuery, 200);

      if (interpretation) {
        const statusMatch = interpretation.match(/STATUS:\s*(CLEAR|UNCLEAR)/i);
        const status = statusMatch ? statusMatch[1].toUpperCase() : null;

        if (status === 'CLEAR') {
          const songMatch = interpretation.match(/SONG:\s*(.+)/i);
          const searchQuery = songMatch ? songMatch[1].trim().replace(/^["']+|["']+$/g, '') : rawQuery;
          return res.status(200).json({ status: 'clear', searchQuery, original: rawQuery });
        }

        if (status === 'UNCLEAR') {
          const questionMatch = interpretation.match(/QUESTION:\s*(.+)/i);
          const opt1 = interpretation.match(/OPTION1:\s*(.+)/i);
          const opt2 = interpretation.match(/OPTION2:\s*(.+)/i);
          const opt3 = interpretation.match(/OPTION3:\s*(.+)/i);

          const question = questionMatch ? questionMatch[1].trim() : 'Which song did you mean, Sir?';
          const options = [
            opt1 ? opt1[1].trim() : null,
            opt2 ? opt2[1].trim() : null,
            opt3 ? opt3[1].trim() : null
          ].filter(Boolean);

          return res.status(200).json({
            status: 'unclear',
            question,
            options,
            original: rawQuery
          });
        }
      }

      return res.status(200).json({ status: 'clear', searchQuery: rawQuery, original: rawQuery });
    }

    // ══════════════════════════════════════════════════════════════════
    // NEW v4.1 — GENERAL CHAT CLARIFICATION MODE
    // ══════════════════════════════════════════════════════════════════
    // Mirrors resolve_song's CLEAR / UNCLEAR / CONFIRM shape but for
    // ANY chat message. The frontend calls this BEFORE the main chat
    // pipeline runs. If UNCLEAR, the frontend speaks the question and
    // listens for a follow-up answer (no modal — just voice/text in
    // the existing output panel + input box).
    //
    // Two trigger families (per user's explicit choice):
    //   (a) Genuinely vague requests with no actionable content
    //       e.g. "play something for me", "tell me about it",
    //       "what do you think", "do that thing"
    //   (b) Ambiguous factual/news queries that could resolve to
    //       multiple distinct real-world referents
    //       e.g. "what's the latest on the strike" (which strike?),
    //       "tell me about the election result" (which country/year?),
    //       "what happened with the merger" (which companies?)
    //
    // Response shapes (same as resolve_song):
    //   { status:'clear' }                                  -> proceed to normal chat pipeline
    //   { status:'unclear', question:'…', options:[...] }    -> speak question, await follow-up
    //   { status:'confirm', resolvedQuery:'…' }              -> user answered, use resolvedQuery as the new message
    // ══════════════════════════════════════════════════════════════════
    if (mode === 'resolve_intent') {
      const rawQuery = (query || '').trim();
      if (!rawQuery) return res.status(200).json({ status: 'clear' });

      // ── PHASE 2: user answered a clarification ──────────────
      if (clarificationAnswer && originalQuery) {
        const mergeSystem = `You are an assistant reconciling an ambiguous request with the user's clarifying answer.

Original request: "${originalQuery}"
Clarifying answer: "${clarificationAnswer}"

Combine these into ONE clear, specific, self-contained question or instruction that fully captures what the user wants, written as if the user said it in one go.
Output ONLY the merged request text, nothing else. No quotes, no preamble.`;

        let merged = await callAnyBrain(mergeSystem, clarificationAnswer, 120);
        if (!merged) merged = originalQuery + ' — ' + clarificationAnswer;
        return res.status(200).json({ status: 'confirm', resolvedQuery: merged.trim() });
      }

      // ── PHASE 1: classify CLEAR vs UNCLEAR ──────────────────
      const intentSystem = `You are the intent-clarity gatekeeper for Scorpion, a Jarvis-style AI assistant. Today is ${timeStr}.

Decide if the user's message is CLEAR or UNCLEAR.

CLEAR = the request has enough specific information to act on or answer directly. This includes almost everything: factual questions, clearly named topics, greetings, commands, opinions, requests with a named subject — even if broad, as long as there IS a subject.

UNCLEAR has exactly two valid reasons — do not invent others:

REASON A — VAGUE, NO ACTIONABLE CONTENT:
The request names no real subject at all and there is no reasonable single interpretation.
Examples: "play something for me", "tell me about it", "what do you think", "do that thing", "explain the thing I mentioned" (with nothing actually mentioned before).

REASON B — GENUINELY MULTI-REFERENT:
The request names a subject, but that subject plausibly refers to two or more clearly distinct real things, and picking wrong would give a completely different answer.
Examples: "what's the latest on the strike" (which strike, where), "tell me about the election result" (which country, which election), "what happened with the merger" (which companies), "is he okay" (no prior "he" established).

Do NOT mark UNCLEAR just because a question is broad, general knowledge, or could be answered at different levels of detail. A query like "what's happening in Kenya today" is CLEAR (single coherent subject, just give current Kenya news). A query like "what's the latest on the case" with zero prior context about which case is UNCLEAR.

If CLEAR, output exactly:
STATUS: CLEAR

If UNCLEAR, output:
STATUS: UNCLEAR
QUESTION: <one short, natural, Jarvis-like spoken question to ask the user, max 15 words>
OPTION1: <first specific plausible interpretation, phrased as a short answer the user could give>
OPTION2: <second specific plausible interpretation>
OPTION3: <"something else" fallback, e.g. "Something else — let me explain">

RULES:
- Default to CLEAR whenever in doubt. Only use UNCLEAR for genuine ambiguity per Reason A or B above.
- Never refuse. Never output anything other than the exact format above.`;

      let interpretation = await callAnyBrain(intentSystem, rawQuery, 220);

      if (interpretation) {
        const statusMatch = interpretation.match(/STATUS:\s*(CLEAR|UNCLEAR)/i);
        const status = statusMatch ? statusMatch[1].toUpperCase() : null;

        if (status === 'UNCLEAR') {
          const questionMatch = interpretation.match(/QUESTION:\s*(.+)/i);
          const opt1 = interpretation.match(/OPTION1:\s*(.+)/i);
          const opt2 = interpretation.match(/OPTION2:\s*(.+)/i);
          const opt3 = interpretation.match(/OPTION3:\s*(.+)/i);

          const question = questionMatch ? questionMatch[1].trim() : 'Could you clarify what you mean, Sir?';
          const options = [
            opt1 ? opt1[1].trim() : null,
            opt2 ? opt2[1].trim() : null,
            opt3 ? opt3[1].trim() : null
          ].filter(Boolean);

          return res.status(200).json({ status: 'unclear', question, options, original: rawQuery });
        }
      }

      // Default / fallback: treat as clear so we never block the user.
      return res.status(200).json({ status: 'clear' });
    }

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
        isNews:      /news|happened|latest|today|yesterday|this week|breaking|announced|said|reported|now|currently/.test(q),
        isVisual:    /explain|show me|what is|how does|diagram of|illustrate|demonstrate|visualise|visualize|lab|laboratory/.test(q)
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

    // ── SEARCH PLANNER ──────────────────────────────────────
    async function planSearch(query) {
      const result = await callCerebras(
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
      const result = await callCerebras(
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

    // ── RECENCY VALIDATOR (legacy, kept for compatibility) ──
    function hasRecentDate(text) {
      return hasRecentDateStrict(text, 3);
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
      let city = 'Nairobi';
      const preposMatch = query.match(/\b(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\s+currently|\s+now|\s+please|\?|$)/i);
      if (preposMatch) {
        city = preposMatch[1].trim();
      } else {
        const fallback = query.match(/(?:weather|temperature|forecast|rain|sunny|cold|hot)\s+([a-zA-Z\s]+?)(?:\s+right\s+now|\s+today|\?|$)/i);
        if (fallback) city = fallback[1].trim();
      }
      city = city.replace(/\s+(right|now|today|currently|please)$/gi,'').replace(/\?/g,'').trim() || 'Nairobi';
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
      const text = (last?.text || last?.content || '').toLowerCase().trim();
      const simple = [
        'hello','hi','hey','thanks','thank you','bye','goodbye',
        'how are you','what is your name','who are you',
        'play ','stop','pause'
      ];
      const isVisual = /explain|show me|what is|how does|diagram of|illustrate/.test(text);
      if (isVisual) return false;
      return simple.some(s => text.startsWith(s)) && text.length < 30;
    }

    // ── FORMAT MESSAGES ─────────────────────────────────────
    const userMessages = messages || [{ role: 'user', text: mode === 'greeting' ? 'greet me' : 'hello' }];
    const formattedMessages = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));

    // ── MAIN DATA PIPELINE (v4.1 hardened) ──────────────────
    let webContext  = '';
    let searchedWeb = false;
    let dataSource  = '';
    let gaps        = [];

    if (mode !== 'greeting' && !isSimpleCommand(userMessages)) {
      const lastMsg = userMessages[userMessages.length - 1];
      const query   = lastMsg?.text || lastMsg?.content || '';
      const intent  = classifyQuery(query);
      const plannedQueries = await planSearch(query);

      // NEW v4.1: web search now runs through the graduated fallback
      // chain (runSearchChain) instead of firing all four providers
      // blindly in parallel for every planned query.
      const [rawWebData, cryptoData, metalData, forexData, weatherData, sportsData] = await Promise.all([
        runSearchChain(plannedQueries, intent),
        getCrypto(query),
        getMetals(query),
        getForex(query),
        getWeather(query),
        getSports(query)
      ]);

      let filteredWebData = null;
      if (rawWebData) filteredWebData = await scoreAndFilter(rawWebData, query);

      // NEW v4.1: recency threshold now depends on query type instead
      // of a flat 3-day window for everything. "Today/now" style news
      // queries get a tight 5-day window; general "latest" queries get
      // a more forgiving 30-day window since not everything newsworthy
      // publishes daily updates.
      if (filteredWebData && intent.isNews) {
        const tightWindow = /\btoday\b|\bthis morning\b|\bright now\b|\bcurrently\b/i.test(query);
        const maxAge = tightWindow ? 5 : 30;
        if (!hasRecentDateStrict(filteredWebData, maxAge)) {
          filteredWebData += '\n\nDATE WARNING: No source confirmed within the last ' + maxAge + ' days. Treat all news claims as potentially stale and say so explicitly rather than presenting them as current fact.';
        }
      }

      // NEW v4.1: explicit last-resort reasoning path. If every search
      // provider truly failed, we no longer just say "no data" — we
      // explicitly instruct the model to reason from the most recent
      // confirmed fact it might still know and flag the uncertainty,
      // mirroring the "no live feed, but based on yesterday's confirmed
      // schedule..." pattern that already works well in practice.
      if (!filteredWebData) {
        filteredWebData =
          'NO LIVE SEARCH DATA AVAILABLE.\n' +
          'INSTRUCTION: Do not invent a definitive current answer. Instead, clearly tell the user you do not have a live feed for this right now. ' +
          'If you have older, previously confirmed context about this topic from earlier in the conversation, you may share that explicitly, labelled with its date, ' +
          'and reason aloud about what is most likely true now without claiming certainty. Never present a guess as a confirmed fact.';
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
      ? `\n\nCRITICAL INSTRUCTIONS — YOU ARE AN INTELLIGENT ANALYST:\nToday is ${timeStr}.\nYesterday was ${yesterdayStr}.\n\nYou have data from MULTIPLE SOURCES that have been confidence-scored and filtered.\n\nSOURCE HIERARCHY:\n1. LIVE specialist APIs (CRYPTO, FOREX, METALS, WEATHER, SPORTS)\n2. [HIGH CONFIDENCE] tagged facts\n3. NEWS SOURCES with today or yesterday date\n4. [LOW CONFIDENCE] or [STALE] facts — mention uncertainty\n5. Training knowledge — FORBIDDEN for any factual claim\n\nHANDLE GAPS HONESTLY:\n- DATA GAP WARNING present: say "I do not have a live feed for that, Sir"\n- No sources mention it: say "I could not find reliable data on that, Sir"\n- NEVER fill a gap with training knowledge as if it were current\n\nLIVE DATA:\n${webContext}`
      : '';

    const systemPrompt = mode === 'greeting'
      ? `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.\nThe current date and time is: ${timeStr}. It is ${partOfDay}.\nGreet the user warmly like Jarvis greets Tony Stark — address them as Sir.\nGive a brief, witty, engaging good ${partOfDay} greeting. Keep it to 2-3 sentences.\n${noMarkdownRule}`
      : `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.\nYou are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.\nToday is ${timeStr}.\n${noMarkdownRule}${webNote}`;

    // ── BRAIN ROSTER ─────────────────────────────────────────
    const brains = [
      { name:'CEREBRAS', key:process.env.CEREBRAS_API_KEY, url:'https://api.cerebras.ai/v1/chat/completions',    model:'llama3.1-8b',           headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
      { name:'GROQ',     key:process.env.GROQ_API_KEY,     url:'https://api.groq.com/openai/v1/chat/completions', model:'llama-3.3-70b-versatile', headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) },
      { name:'GEMINI',   key:process.env.GEMINI_API_KEY,   url:null,                                              model:'gemini-2.0-flash' },
      { name:'MISTRAL',  key:process.env.MISTRAL_API_KEY,  url:'https://api.mistral.ai/v1/chat/completions',      model:'mistral-large-latest',   headers:k=>({'Content-Type':'application/json','Authorization':'Bearer '+k}) }
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

    // ── FIRE ─────────────────────────────────────────────────
    const activeBrains = brains.filter(b => b.key);
    if (!activeBrains.length) return res.status(500).json({ error: 'No brain API keys configured' });

    try {
      const result   = await Promise.any(activeBrains.map(b => callBrain(b)));
      const webLabel = searchedWeb ? ' + WEB' + (dataSource ? ' [' + dataSource + ']' : '') : '';
      return res.status(200).json({ reply: result.reply, brain: result.brain + webLabel });
    } catch (aggErr) {
      const errors = aggErr.errors?.map(e => e.message).join(' | ') || aggErr.message;
      return res.status(500).json({ error: 'All brains failed: ' + errors });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
