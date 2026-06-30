// ============================================================
// CHAT API HANDLER — CORE FLOW ONLY (trimmed)
// ============================================================
// This is a stripped-down version of the handler showing ONLY
// the path that runs when the user asks a normal question:
//   1. classify the query
//   2. plan search queries
//   3. run the search (Serper + Tavily)
//   4. score/filter the results for relevance + freshness
//   5. build a system prompt with that context
//   6. ask the LLM (first brain that responds wins)
//   7. stream the answer back
//
// Removed for clarity: YouTube search, "play X" request handling,
// analyze-mode (paste-text-and-summarize), crypto/forex/metals/
// weather/sports live-data lookups, greeting mode, memory wipe.
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-scorpion-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SECRET = process.env.APP_SECRET;
  if (SECRET && req.headers['x-scorpion-key'] !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { messages, timezone } = req.body;

    // ── 0. TIME CONTEXT ───────────────────────────────────
    const now = new Date();
    const tz  = timezone || 'Africa/Nairobi';
    const timeStr = now.toLocaleString('en-US', {
      timeZone: tz, weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });

    function fetchTimestamp() {
      return new Date().toLocaleString('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
    }

    // ── LLM CALL HELPERS ───────────────────────────────────
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
      } catch (e) { return null; }
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

    // ── 1. SEARCH PROVIDERS ───────────────────────────────
    async function serperSearch(q) {
      const key = process.env.SERPER_API_KEY;
      if (!key) return null;
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, num: 8, gl: 'us', hl: 'en' })
        });
        const data = await r.json();
        let results = '';
        if (data.answerBox) results += 'DIRECT ANSWER: ' + (data.answerBox.answer || data.answerBox.snippet || '') + '\n\n';
        if (data.organic?.length) {
          results += 'SEARCH SNIPPETS:\n';
          data.organic.slice(0, 6).forEach((r, i) => {
            results += '[' + (i + 1) + '] ' + r.title + '\n' + r.snippet + '\nSource: ' + r.link + '\n\n';
          });
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
          body: JSON.stringify({ api_key: key, query: q, search_depth: 'advanced', max_results: 6, include_answer: true })
        });
        const data = await r.json();
        if (!data.results?.length) return null;
        const snippets = data.results.map((r, i) => '[' + (i + 1) + '] ' + r.title + '\n' + (r.content || '').slice(0, 1500)).join('\n\n');
        return data.answer ? 'DIRECT ANSWER: ' + data.answer + '\n\nSOURCES:\n' + snippets : snippets;
      } catch (e) { return null; }
    }

    // Runs every planned query through both providers and merges results.
    async function runSearchChain(plannedQueries) {
      const blocks = [];
      for (const q of plannedQueries) {
        const [serperData, tavilyData] = await Promise.all([serperSearch(q), tavilySearch(q)]);
        const merged = [serperData, tavilyData].filter(Boolean).join('\n\n---\n\n');
        if (merged) blocks.push(merged);
      }
      return blocks.join('\n\n---\n\n') || null;
    }

    // ── 2. QUERY PLANNING ──────────────────────────────────
    // Asks the LLM to turn one user question into 2-3 targeted
    // search queries (appending the current date for "latest/today"
    // style questions).
    async function planSearch(q) {
      const result = await callCerebras(
        'You are a search query planner. Today is ' + timeStr + '. Given a user question, output 2-3 specific targeted search queries. Output ONLY a valid JSON array of strings.',
        q, 200
      );
      if (!result) return [q];
      try {
        const cleaned = result.replace(/```json|```/g, '').trim();
        const queries = JSON.parse(cleaned);
        return Array.isArray(queries) && queries.length > 0 ? queries : [q];
      } catch (e) { return [q]; }
    }

    // ── 3. RELEVANCE / FRESHNESS SCORING ──────────────────
    // Takes raw search dump, asks the LLM to keep only facts that
    // answer the question, tag confidence, flag dates, flag stale data.
    async function scoreAndFilter(rawData, q) {
      if (!rawData) return rawData;
      const result = await callCerebras(
        'You are a data quality analyst. Today is ' + timeStr + '. Given raw search results and a query: ' +
        '1) Extract only facts that directly answer the query. ' +
        '2) Remove irrelevant content, ads, navigation, repetition. ' +
        '3) Tag each key fact as [HIGH CONFIDENCE] or [LOW CONFIDENCE]. ' +
        '4) Flag dates as [DATE: YYYY-MM-DD]. ' +
        '5) PENALIZE STALE DATA: facts older than 48 hours get [STALE]. ' +
        '6) Output clean structured facts only. If nothing relevant output: NO RELEVANT DATA FOUND',
        'QUERY: ' + q + '\n\nRAW DATA:\n' + rawData.slice(0, 10000), 2000
      );
      if (!result || result === 'NO RELEVANT DATA FOUND') return rawData;
      return result;
    }

    // ── HARD FRESHNESS CHECK ───────────────────────────────
    // Deterministic check (not LLM-judged) — looks for actual
    // YYYY-MM-DD dates in the filtered data and confirms at least
    // one falls within the allowed age window. If not, we append
    // an explicit warning the model cannot reason its way around.
    function hasRecentDateStrict(text, maxAgeDays) {
      if (!text) return false;
      const cutoff = Date.now() - maxAgeDays * 86400000;
      const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (!dateMatches.length) return false;
      return dateMatches.some(d => {
        const t = new Date(d).getTime();
        return !isNaN(t) && t >= cutoff && t <= Date.now() + 86400000;
      });
    }

    // Detects whether the query is asking about something recent/
    // current, so we know to apply the staleness check at all.
    function isRecencySensitive(q) {
      return /\b(recent|latest|today|yesterday|this week|just|now|currently|breaking)\b/i.test(q);
    }

    // ── SANITIZE OUTPUT ────────────────────────────────────
    function sanitizeReply(text) {
      return text
        .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s+/g, '')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/INSTRUCTION:[^\n]*/gi, '')
        .replace(/\n{3,}/g, '\n\n').trim();
    }

    // ══════════════════════════════════════════════════════
    // MAIN FLOW
    // ══════════════════════════════════════════════════════
    startStream();

    const userMessages      = messages || [{ role: 'user', text: 'hello' }];
    const lastMsg            = userMessages[userMessages.length - 1];
    const userQuery          = lastMsg?.text || lastMsg?.content || '';
    const formattedMessages  = userMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text || m.content || '' }));

    // STEP 1: tell the user what we're about to do
    writeChunk('thinking', 'Working out what is needed to answer this...');

    // STEP 2: plan the search queries
    writeChunk('searching', 'Planning search strategy...');
    const plannedQueries = await planSearch(userQuery);
    writeChunk('searching', 'Running ' + plannedQueries.length + ' search queries: ' + plannedQueries.join(' / '));

    // STEP 3: run the search
    writeChunk('fetching', 'Fetching web results...');
    const rawWebData = await runSearchChain(plannedQueries);
    if (rawWebData) writeChunk('fetching', 'Web search complete — ' + fetchTimestamp());

    // STEP 4: filter/score for relevance and freshness
    writeChunk('scoring', 'Analysing and scoring sources for confidence...');

    let filteredWebData = rawWebData ? await scoreAndFilter(rawWebData, userQuery) : null;
    const noDataFound = !filteredWebData || filteredWebData === 'NO RELEVANT DATA FOUND';

    // HARD FALLBACK: if scoring found nothing relevant, do NOT pass
    // through to the model as if it might still answer from training
    // knowledge — force the "no live feed" instruction every time.
    if (noDataFound) {
      filteredWebData = 'NO LIVE SEARCH DATA AVAILABLE.\nINSTRUCTION: You have NO verified data for this query. Do not invent or recall an answer from training knowledge. Tell the user directly that you do not have a confirmed live feed for this and cannot verify it right now.';
    }

    // HARD STALENESS CHECK: deterministic, not LLM self-graded.
    // For recency-sensitive queries, require at least one in-window
    // date in the surviving data — if none, append a warning the
    // model is instructed to treat as binding.
    if (!noDataFound && isRecencySensitive(userQuery)) {
      const maxAgeDays = /\btoday\b|\bthis morning\b|\bright now\b|\bcurrently\b/i.test(userQuery) ? 5 : 30;
      if (!hasRecentDateStrict(filteredWebData, maxAgeDays)) {
        filteredWebData += '\n\nDATE WARNING: No source in this data could be confirmed within the last ' + maxAgeDays + ' days. You MUST tell the user you cannot verify anything recent on this and that what you found may be outdated — do not present it as current.';
        writeChunk('scoring', 'No confirmed recent source found — flagging as potentially stale.');
      }
    }

    // STEP 5: build the system prompt with that context
    const systemPrompt = `You are Scorpion, a hyper-intelligent Jarvis-style AI assistant.
You are warm, witty, loyal, and brilliantly intelligent. You address the user as Sir.
Today is ${timeStr}.

CRITICAL OUTPUT FORMAT RULES:
- Write in plain conversational sentences only.
- NEVER use markdown.
- Address the user as Sir.
- Always state the exact fetch time and date when reporting live data.

CONFIDENCE SELF-RATING (MANDATORY): Begin your answer with exactly one of these tags, then a space, then the answer:
[CONFIDENT] — verified by fresh, on-topic sources.
[LIKELY] — supported but not fully verified or slightly dated.
[UNCERTAIN] — sources are thin, indirect, or possibly stale.
[GUESSING] — no real data backs this; you are inferring from general knowledge only.
If LIVE DATA CONTEXT contains a DATE WARNING or says NO LIVE SEARCH DATA AVAILABLE, you are NOT permitted to use [CONFIDENT] or [LIKELY] — use [UNCERTAIN] or [GUESSING] and say so plainly.

LIVE DATA CONTEXT:
=== WEB SEARCH (confidence-scored) ===
${filteredWebData}`;

    // STEP 6: ask the LLM(s), first to answer wins
    const brainRoster = [
      { name: 'CEREBRAS', key: process.env.CEREBRAS_API_KEY, url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama3.1-8b' },
      { name: 'GROQ',     key: process.env.GROQ_API_KEY,     url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' }
    ].filter(b => b.key);

    if (!brainRoster.length) {
      writeChunk('error', 'No brain API keys configured.');
      endStream();
      return;
    }

    async function callBrain(brain) {
      const r = await fetch(brain.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + brain.key },
        body: JSON.stringify({ model: brain.model, messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages], temperature: 0.1, max_tokens: 1024 })
      });
      const data = await r.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) throw new Error('Empty reply from ' + brain.name);

      // Pull the mandatory confidence tag out as metadata so it
      // doesn't get read aloud literally as "[CONFIDENT]" by TTS.
      const confMatch = reply.match(/^\s*\[(CONFIDENT|LIKELY|UNCERTAIN|GUESSING)\]/i);
      const confidence = confMatch ? confMatch[1].toUpperCase() : 'UNRATED';
      const cleanedReply = reply.replace(/^\s*\[(CONFIDENT|LIKELY|UNCERTAIN|GUESSING)\]\s*/i, '');

      return { reply: sanitizeReply(cleanedReply), brain: brain.name, confidence };
    }

    try {
      const result = await Promise.any(brainRoster.map(b => callBrain(b)));
      // STEP 7: stream the answer back
      writeChunk('answer', result.reply, { brain: result.brain, confidence: result.confidence });
    } catch (aggErr) {
      const errors = aggErr.errors?.map(e => e.message).join(' | ') || aggErr.message;
      writeChunk('error', 'All brains failed: ' + errors);
    }

    endStream();

  } catch (e) {
    try {
      res.write('data: ' + JSON.stringify({ type: 'error', content: e.message }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (_) {
      res.status(500).json({ error: e.message });
    }
  }
}
