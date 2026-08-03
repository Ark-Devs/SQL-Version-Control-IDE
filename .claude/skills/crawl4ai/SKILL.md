---
name: crawl4ai
description: Crawl and scrape the web with Crawl4AI (Python) — convert pages to LLM-ready markdown, pull structured JSON out of HTML with CSS/XPath/regex/LLM schemas, crawl many URLs concurrently, follow links with deep crawling, and handle JS-heavy or bot-protected sites. Use this skill whenever a task involves programmatic web page fetching or scraping — "scrape this site", "get the markdown/text of these pages", building a dataset or RAG corpus from the web, extracting product/article/table data, screenshotting or PDF-ing pages, crawling docs, or whenever code imports `crawl4ai` / `AsyncWebCrawler` or shells out to the `crwl` CLI. Also reach for it when someone is about to hand-roll a scraper with Playwright, Selenium, requests, or BeautifulSoup and Crawl4AI would do the job with far less code.
---

# Crawl4AI

Crawl4AI is an async, Playwright-backed crawler whose default output is clean markdown
built for LLM consumption. The mental model is small: one crawler object, two config
objects, one result object.

```
AsyncWebCrawler(config=BrowserConfig(...))   # how the browser launches — once per session
  └─ .arun(url, config=CrawlerRunConfig(...)) # how this crawl behaves — per call
       └─ CrawlResult                          # markdown, html, links, media, extracted_content...
```

Everything else — extraction strategies, content filters, dispatchers, deep crawling — plugs
into `CrawlerRunConfig`. When you know which knob you need, jump to the matching reference
file rather than guessing at parameter names; the API surface is wide and the names are
specific.

## Setup

```bash
pip install crawl4ai     # Python 3.10+
crawl4ai-setup           # installs Playwright browsers + OS deps (required, easy to forget)
crawl4ai-doctor          # diagnose a broken install
```

Skip `crawl4ai[torch]` / `[transformer]` / `[all]` unless semantic chunking or clustering is
actually needed — they pull in multi-gigabyte models. Details, CLI usage, and Docker/server
mode: `references/setup-and-cli.md`.

## The pattern that covers most tasks

```python
import asyncio
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

async def main():
    browser_cfg = BrowserConfig(headless=True, text_mode=True)  # text_mode skips images
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        excluded_tags=["nav", "footer", "header", "form"],
        exclude_external_links=True,
        page_timeout=60_000,   # milliseconds, not seconds
    )

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        result = await crawler.arun("https://example.com", config=run_cfg)
        if not result.success:
            print("failed:", result.status_code, result.error_message)
            return
        print(result.markdown)

asyncio.run(main())
```

Two habits worth keeping: always branch on `result.success` (a failed crawl returns a result
object, it does not raise), and open the crawler **once** for the whole job. Re-entering
`async with AsyncWebCrawler()` per URL relaunches a browser each time and is the single most
common reason a Crawl4AI script is slow.

## Picking an approach

| The task | What to use | Reference |
|---|---|---|
| One page → markdown/text | `arun()` + markdown generator | this file, `references/markdown-and-filtering.md` |
| A known list of URLs | `arun_many()` with a dispatcher | `references/scale-and-crawling.md` |
| Repeating structure (products, listings, tables) | `JsonCssExtractionStrategy` / `JsonXPathExtractionStrategy` | `references/extraction.md` |
| Emails, prices, dates, IDs in prose | `RegexExtractionStrategy` | `references/extraction.md` |
| Messy or one-off page structure | `LLMExtractionStrategy` | `references/extraction.md` |
| Follow links across a site | `deep_crawl_strategy` (BFS/DFS/BestFirst) | `references/scale-and-crawling.md` |
| Grab every URL a site already publishes | `AsyncUrlSeeder` (sitemap / Common Crawl) | `references/scale-and-crawling.md` |
| "Research until I know enough" | `AdaptiveCrawler.digest()` | `references/scale-and-crawling.md` |
| Content behind clicks, infinite scroll, login | `js_code`, `wait_for`, `session_id`, virtual scroll, hooks | `references/dynamic-pages.md` |
| Blocked, 403s, Cloudflare | stealth → undetected adapter → proxies | `references/anti-bot.md` |
| Every field on the result object | `CrawlResult` | `references/crawl-result.md` |
| Full parameter lists for the config classes | `BrowserConfig` / `CrawlerRunConfig` / `LLMConfig` | `references/configuration.md` |

Prefer schema-based extraction over LLM extraction whenever page structure repeats: it is
faster, free, deterministic, and reusable across thousands of pages. LLM extraction earns its
cost on irregular pages — or use an LLM once via `JsonCssExtractionStrategy.generate_schema()`
to *write* the schema, then run that schema forever without further LLM calls.

## Reading the result

```python
result.markdown                     # markdown; str-like, with attributes below
result.markdown.raw_markdown        # straight HTML→markdown conversion
result.markdown.fit_markdown        # filtered version — only populated if a content filter ran
result.markdown.markdown_with_citations
result.extracted_content            # JSON *string* from an extraction strategy — json.loads it
result.links["internal"] / ["external"]
result.media["images"]
result.tables                       # [{headers, rows, caption, summary}]
result.cleaned_html, result.html
result.screenshot                   # base64 PNG when screenshot=True
result.pdf                          # bytes when pdf=True
```

`fit_markdown` being empty almost always means no content filter was configured, not that
filtering failed. `extracted_content` is a JSON string, never a parsed object.

## Sharp edges

These come up repeatedly and cost real debugging time:

- **`cache_mode` defaults to `BYPASS`** (fresh fetch every run). Set `CacheMode.ENABLED`
  explicitly while iterating so you stop re-hitting the site — and be deliberate about it
  when content freshness matters.
- **`word_count_threshold` defaults to 200**, so short blocks get dropped. Lower it to ~10
  for listing pages, link lists, or anything with terse items, or content will silently
  vanish from the markdown.
- **Streaming `arun_many` returns an awaitable generator**:
  `async for r in await crawler.arun_many(urls, config=cfg.clone(stream=True))` — the `await`
  before `crawler.arun_many` is required.
- **Deep crawling makes `arun()` return a list**, not a single result.
- **Timeouts are milliseconds** (`page_timeout=60000`); `scroll_delay` and
  `delay_before_return_html` are seconds.
- **`markdown_v2`, and top-level `fit_markdown` / `fit_html` on `CrawlResult`, were removed in
  v0.5.** Use `result.markdown` and its attributes.
- **`css_selector` shrinks the whole crawl to that subtree** (links and media included);
  `target_elements` limits only what markdown/extraction see while leaving link and media
  collection page-wide. Reach for `target_elements` unless the narrower behavior is wanted.
- **Config objects are meant to be cloned**: `cfg.clone(stream=True)` beats rebuilding
  a config from scratch and losing a setting.

## Being a good citizen

Crawling is outward-facing: it consumes someone else's bandwidth and can get an IP banned.
Default to modest concurrency (`max_session_permit≈5-10`) with a `RateLimiter`, and reach for
the anti-bot escalation path only when a site the user is authorized to crawl blocks an
otherwise well-behaved crawler. If a task looks like scraping personal data at scale,
defeating a paywall, or hammering a site, raise it with the user before writing the crawler.
