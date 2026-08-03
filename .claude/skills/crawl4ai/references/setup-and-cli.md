# Setup, CLI, and deployment

## Install

```bash
pip install crawl4ai        # Python 3.10+
crawl4ai-setup             # installs Playwright browsers and OS-level deps
crawl4ai-doctor            # diagnostics: Python version, Playwright, env conflicts
```

`crawl4ai-setup` is not optional — a fresh `pip install` alone leaves you with no browser
binaries and a confusing `TargetClosedError` or "executable doesn't exist" on first crawl.
If a crawl fails right after install, run `crawl4ai-doctor` before debugging your own code.

Optional extras, each significantly heavier:

```bash
pip install crawl4ai[torch]        # semantic/cosine chunking and clustering
pip install crawl4ai[transformer]  # Hugging Face-based strategies
pip install crawl4ai[all]
crawl4ai-download-models           # pre-cache large models (only if you need them)
```

Upgrade path: `pip install -U crawl4ai && crawl4ai-doctor`.

### Install troubleshooting

- **Playwright can't find a browser** → rerun `crawl4ai-setup`; on Linux it also installs the
  system libraries Chromium needs.
- **Sandboxed/CI containers** → run headless (`BrowserConfig(headless=True)`) and consider
  `extra_args=["--no-sandbox"]` when running as root in a container.
- **Windows `TargetClosedError`** → fixed in v0.9.1 (the default `channel='chromium'` was
  making Playwright hunt for a system Chrome). Upgrade rather than working around it.
- **HTTP-only mode timeouts behaving oddly** → `page_timeout` was passed to aiohttp as
  seconds instead of milliseconds before v0.9.1. Upgrade.

## CLI (`crwl`)

Installed with the library. Good for reconnaissance before writing a script — look at what a
page actually yields before deciding on selectors.

```bash
crwl https://example.com                          # crawl, default output
crwl https://example.com -o markdown              # markdown to stdout
crwl https://example.com -o markdown-fit          # filtered markdown
crwl https://example.com -o json -v --bypass-cache
crwl --example                                    # built-in usage examples
```

Config comes from YAML files or inline key=value pairs:

```bash
crwl https://example.com -B browser.yml -C crawler.yml
crwl https://example.com -b "headless=true,viewport_width=1280,user_agent_mode=random"
crwl https://example.com -c "css_selector=#main,scan_full_page=true,delay_before_return_html=2"
```

```yaml
# browser.yml
headless: true
viewport_width: 1280
user_agent_mode: "random"
ignore_https_errors: true

# crawler.yml
cache_mode: "bypass"
wait_until: "networkidle"
page_timeout: 30000
word_count_threshold: 100
scan_full_page: true
remove_overlay_elements: true
```

Extraction from the CLI — `-e` picks the strategy config, `-s` the schema:

```bash
crwl https://example.com -e extract_css.yml -s css_schema.json -o json
crwl https://example.com -e extract_llm.yml -s llm_schema.json -o json
```

```yaml
# extract_css.yml
type: "json-css"
params:
  verbose: true

# extract_llm.yml
type: "llm"
provider: "openai/gpt-4o-mini"
instruction: "Extract all articles with their titles and links"
api_token: "your-token"
params:
  temperature: 0.3
```

Content filters (`-f`) and Q&A (`-q`):

```yaml
# filter_bm25.yml
type: "bm25"
query: "target content"
threshold: 1.0
```

```bash
crwl https://example.com -f filter_bm25.yml -o markdown-fit
crwl https://example.com -q "What are the pros and cons mentioned?"
```

Output formats: `all`, `json`, `markdown`/`md`, `markdown-fit`/`md-fit`.

LLM provider and token are prompted for on first `-q` use and stored in
`~/.crawl4ai/global.yml`. Provider strings follow LiteLLM naming
(`openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet-20240620`, `ollama/llama3.3`, …);
Ollama needs no token.

## Docker / server mode

Crawl4AI ships a Docker image exposing an HTTP API plus a playground and monitor dashboard —
useful when the crawler should be a service rather than a library import:

```bash
docker pull unclecode/crawl4ai
docker run -p 11235:11235 unclecode/crawl4ai
```

Then POST crawl requests to the server (`/crawl`). Auth (JWT), rate limiting, Redis, and
GPU builds are all configurable; the deployment surface changes faster than the library API,
so check the upstream `core/self-hosting` docs before designing around it. If a JWT auth gate
is enabled, requests to the dashboard and playground need a Bearer token.

Source: https://docs.crawl4ai.com/core/installation/, /core/cli/, /core/self-hosting/
