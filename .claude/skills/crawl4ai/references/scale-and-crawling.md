# Many URLs, deep crawling, seeding, adaptive crawling

Four different answers to "more than one page", depending on whether you already know the
URLs.

| You have | Use |
|---|---|
| A list of URLs | `arun_many()` |
| A starting page, want to follow links | `deep_crawl_strategy` |
| A domain, want the URLs it already publishes | `AsyncUrlSeeder` |
| A question, want to crawl until it's answered | `AdaptiveCrawler` |

## arun_many() — known URLs, concurrently

```python
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode

cfg = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)

async with AsyncWebCrawler() as crawler:
    # batch: all results at once
    results = await crawler.arun_many(urls, config=cfg)

    # streaming: handle each as it lands (note the `await` before arun_many)
    async for result in await crawler.arun_many(urls, config=cfg.clone(stream=True)):
        if result.success:
            print(result.url, len(result.markdown.raw_markdown))
        else:
            print("failed:", result.url, result.error_message)
```

Stream when you're writing results to disk/DB incrementally or crawling thousands of URLs —
it keeps memory flat and surfaces failures early.

### Dispatchers: concurrency and politeness

```python
from crawl4ai import RateLimiter, CrawlerMonitor, DisplayMode
from crawl4ai.async_dispatcher import MemoryAdaptiveDispatcher, SemaphoreDispatcher

dispatcher = MemoryAdaptiveDispatcher(
    memory_threshold_percent=90.0,   # pause when system memory exceeds this
    check_interval=1.0,
    max_session_permit=10,           # max concurrent crawls
    memory_wait_timeout=600.0,       # raise MemoryError if stuck above threshold this long
    rate_limiter=RateLimiter(
        base_delay=(1.0, 2.0),       # random delay in this range between requests
        max_delay=30.0,
        max_retries=3,
        rate_limit_codes=[429, 503],
    ),
    monitor=CrawlerMonitor(max_visible_rows=15, display_mode=DisplayMode.DETAILED),
)

results = await crawler.arun_many(urls, config=cfg, dispatcher=dispatcher)
```

`MemoryAdaptiveDispatcher` is the default and the right choice for large jobs — it throttles
itself when the machine is under memory pressure. `SemaphoreDispatcher(max_session_permit=20)`
is a plain fixed-concurrency alternative. The `RateLimiter` handles 429/503 with exponential
backoff automatically; add one whenever you're crawling a single domain hard.

Per-result concurrency data lands in `result.dispatch_result` (memory usage, timing).

### Different configs for different URLs

```python
cfgs = [
    CrawlerRunConfig(url_matcher="*/blog/*", markdown_generator=blog_md),
    CrawlerRunConfig(url_matcher=lambda u: u.endswith(".pdf"), ...),
    CrawlerRunConfig(),   # fallback
]
results = await crawler.arun_many(urls, config=cfgs)
```

`url_matcher` takes a glob, a callable, or a list; `match_mode=MatchMode.OR|AND` controls how
multiple patterns combine.

## Deep crawling — follow links

```python
from crawl4ai import CrawlerRunConfig
from crawl4ai.deep_crawling import BFSDeepCrawlStrategy
from crawl4ai.content_scraping_strategy import LXMLWebScrapingStrategy

config = CrawlerRunConfig(
    deep_crawl_strategy=BFSDeepCrawlStrategy(
        max_depth=2,             # start page + 2 levels
        include_external=False,  # stay on-domain
        max_pages=50,            # hard cap — always set one
        score_threshold=0.3,
    ),
    scraping_strategy=LXMLWebScrapingStrategy(),
)

results = await crawler.arun("https://example.com", config=config)  # returns a LIST
for r in results:
    print(r.url, r.metadata.get("depth"))
```

Strategies: `BFSDeepCrawlStrategy` (level by level — best for coverage),
`DFSDeepCrawlStrategy` (dig one branch first), `BestFirstCrawlingStrategy` (score-ordered
frontier — best when you care about relevance and will stop early). All accept `max_depth`,
`include_external`, `max_pages`, `score_threshold`, `filter_chain`, `url_scorer`.

Setting `stream=True` in the run config makes a deep crawl yield results as pages complete
instead of returning one list at the end.

### Filters and scorers

```python
from crawl4ai.deep_crawling.filters import (
    FilterChain, URLPatternFilter, DomainFilter, ContentTypeFilter,
    SEOFilter, ContentRelevanceFilter,
)
from crawl4ai.deep_crawling.scorers import KeywordRelevanceScorer
from crawl4ai.deep_crawling import BestFirstCrawlingStrategy

filter_chain = FilterChain([
    URLPatternFilter(patterns=["*guide*", "*tutorial*"]),
    DomainFilter(allowed_domains=["docs.example.com"], blocked_domains=["old.docs.example.com"]),
    ContentTypeFilter(allowed_types=["text/html"]),
])

strategy = BestFirstCrawlingStrategy(
    max_depth=3,
    max_pages=100,
    filter_chain=filter_chain,
    url_scorer=KeywordRelevanceScorer(keywords=["async", "await", "concurrency"], weight=0.8),
)
```

Filters prune the frontier before fetching (cheap); scorers reorder it (spend your page budget
on the promising URLs first). Combine both for large sites.

## URL seeding — discover without crawling

Pulls URLs from sitemaps and Common Crawl in seconds instead of walking the site:

```python
from crawl4ai import AsyncUrlSeeder, SeedingConfig

seeder = AsyncUrlSeeder()
urls = await seeder.urls("example.com", SeedingConfig(
    source="sitemap+cc",      # "sitemap" | "cc" | "sitemap+cc"
    pattern="*/docs/*",
    extract_head=True,        # fetch <head> metadata for pre-filtering
    max_urls=1000,
))

wanted = [u["url"] for u in urls
          if u["status"] == "valid" and "tutorial" in str(u["head_data"]).lower()]
results = await crawler.arun_many(wanted, config=cfg)
```

The tradeoff versus deep crawling: seeding is far faster and lets you filter before spending
any crawl budget, but it only sees URLs the site has published and may miss very new pages.
For a documentation site or blog, seed first, then crawl the filtered list.

## Adaptive crawling — stop when you know enough

```python
from crawl4ai import AsyncWebCrawler, AdaptiveCrawler, AdaptiveConfig

config = AdaptiveConfig(
    confidence_threshold=0.8,   # stop at 80% confidence (default 0.7)
    max_pages=30,
    top_k_links=5,
    min_gain_threshold=0.05,
    strategy="statistical",     # or "embedding" for semantic coverage
)

async with AsyncWebCrawler() as crawler:
    adaptive = AdaptiveCrawler(crawler, config)
    result = await adaptive.digest(start_url="https://docs.python.org/3/",
                                   query="async context managers")
    adaptive.print_stats()
    for page in adaptive.get_relevant_content(top_k=5):
        print(page["url"], page["score"])
```

`strategy="statistical"` is offline, fast, and term-based — good for queries with specific
vocabulary. `strategy="embedding"` handles conceptual or ambiguous queries by expanding the
query and measuring semantic gaps, at the cost of an embedding model (local
sentence-transformers, or an API model via `embedding_llm_config`).

Source: https://docs.crawl4ai.com/advanced/multi-url-crawling/, /core/deep-crawling/,
/core/url-seeding/, /core/adaptive-crawling/
