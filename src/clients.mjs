// Live transports: Tavily (search + extract) and an OpenAI-compatible chat endpoint serving Nemotron.
// Nebius Token Factory is the default; NVIDIA_API_KEY (build.nvidia.com) is a drop-in fallback for local dev.
const TAVILY = 'https://api.tavily.com';

export function llmConfig(env = process.env) {
  if (env.NEBIUS_API_KEY) {
    return {
      provider: 'nebius', key: env.NEBIUS_API_KEY,
      base: env.LLM_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1',
      model: env.LLM_MODEL ?? 'nvidia/Nemotron-3-Ultra-550b-a55b',
    };
  }
  if (env.NVIDIA_API_KEY) {
    return {
      provider: 'nvidia', key: env.NVIDIA_API_KEY,
      base: env.LLM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
      model: env.LLM_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b',
    };
  }
  return null;
}

async function post(url, body, headers, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export function liveExec(env = process.env) {
  return async (op, input) => {
    if (op === 'tavily.search' || op === 'tavily.extract') {
      if (!env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not set (or use --replay).');
      const path = op === 'tavily.search' ? '/search' : '/extract';
      return post(TAVILY + path, input, { Authorization: `Bearer ${env.TAVILY_API_KEY}` }, 90_000);
    }
    if (op === 'llm.chat') {
      const cfg = llmConfig(env);
      if (!cfg) throw new Error('Set NEBIUS_API_KEY (Token Factory) or NVIDIA_API_KEY (or use --replay).');
      const r = await post(`${cfg.base}/chat/completions`, { model: cfg.model, ...input },
        { Authorization: `Bearer ${cfg.key}` }, 240_000);
      return { model: r.model ?? cfg.model, provider: cfg.provider, content: r.choices?.[0]?.message?.content ?? '' };
    }
    throw new Error(`unknown op ${op}`);
  };
}
