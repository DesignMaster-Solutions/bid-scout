# Bid Scout

Small businesses lose public contracts they could win because nobody has time to read solicitations. Bid Scout reads them.

Give it a company profile (services, region, facts it may claim, things it cannot do). It:

1. searches the live web with **Tavily** for open RFPs, RFQs and bids that match each service and region;
2. reads each solicitation in full with **Tavily Extract**;
3. asks **NVIDIA Nemotron** (served by **Nebius Token Factory**) to judge it: is it really an open solicitation, what is the due date, how well does this company fit, what are the gaps (bonding, certifications, local presence) and which sentences on the page prove each claim;
4. **checks every quoted sentence against the page text**. Quotes that are not on the page are dropped, and a fit with no verified quote is capped at 30, so a hallucinated "great fit" cannot reach the top;
5. drops closed bids, ranks the rest, and drafts a response for the best one using only the company's facts. Anything the facts do not cover (references, insurance, pricing) comes out as `[CONFIRM: ...]` instead of being invented.

Built by Design Master Solutions LLC, a Massachusetts web and app agency, for its own pipeline. The sample profile in `profiles/` is ours and only lists true facts from our site.

## Demo video

2:30 walkthrough of the recorded run, the quote check and the tests: [`docs/demo.mp4`](docs/demo.mp4).

## Sample run (29 Oct 2026, recorded on Nebius Token Factory)

Live web, `nvidia/Nemotron-3-Ultra-550b-a55b` served by Nebius Token Factory: 3 Tavily searches, 6 solicitations read, 4 dismissed (a road reconstruction and a landscape/engineering RFP that are off-trade and past due, a LinkedIn post that is not a solicitation, and a 41-site website RFP capped at 30 because none of its 8 model quotes were on the page), 2 ranked: the Town of Chilhowie website RFP at 72 and a Massachusetts administrative services RFP at 55, each with verified quotes. 19 model quotes across the six were dropped because they were not on the page. Full output: [`docs/sample-brief.md`](docs/sample-brief.md). `npm run demo` replays it from `fixtures/`.

## Run it

Node 22+, no dependencies.

```bash
# reproduce the recorded demo without any key
npm run demo

# live: Nebius Token Factory (default) + Tavily
export NEBIUS_API_KEY=...        # Token Factory, OpenAI-compatible
export TAVILY_API_KEY=...
node src/cli.mjs --profile profiles/design-master-solutions.json

# record fresh fixtures for the demo
node src/cli.mjs --profile profiles/design-master-solutions.json --record
```

Options: `--max N` solicitations to read (default 6), `--today YYYY-MM-DD`, `--json` for the full trace.

Model and endpoint: `NEBIUS_API_KEY` uses `https://api.tokenfactory.nebius.com/v1` with a Nemotron model (`LLM_MODEL` to change it). For local development without Token Factory, `NVIDIA_API_KEY` from build.nvidia.com is a drop-in fallback serving the same open Nemotron weights. `LLM_BASE_URL` overrides either.

## How it is built

| File | What it does |
|---|---|
| `src/scout.mjs` | the agent: queries, solicitation filter, assessment prompt, quote verification, open/closed filter, ranking, draft |
| `src/clients.mjs` | Tavily search/extract and the OpenAI-compatible chat call |
| `src/runner.mjs` | record/replay of every external call (fixtures are keyed by a hash of the request) |
| `test/` | `npm test`: offline tests with a fake runner, including the hallucinated-quote cap |

## License

MIT
