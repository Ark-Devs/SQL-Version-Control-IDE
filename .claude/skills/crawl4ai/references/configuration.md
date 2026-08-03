# Configuration reference

Three config classes. `BrowserConfig` is per crawler session, `CrawlerRunConfig` is per
`arun()`/`arun_many()` call, `LLMConfig` is passed to whichever strategy needs a model.

Both `BrowserConfig` and `CrawlerRunConfig` support `.clone(**overrides)` — use it instead of
rebuilding configs, so you never drop a setting by accident.

## BrowserConfig — how the browser launches

```python
BrowserConfig(
    browser_type="chromium",     # "chromium" | "firefox" | "webkit"
    headless=True,               # False is easier to debug and less detectable
    browser_mode="dedicated",    # "dedicated" | "builtin" | "custom" | "docker"
    use_managed_browser=False,   # CDP-based control
    cdp_url=None,                # e.g. "ws://localhost:9222/devtools/browser/"
    debugging_port=9222,
    host="localhost",
    proxy_config=None,           # ProxyConfig or {"server","username","password"}
    viewport_width=1080,
    viewport_height=600,
    device_scale_factor=1.0,     # 2.0 → retina-quality screenshots
    use_persistent_context=False,# keep cookies/localStorage across runs
    user_data_dir=None,          # profile folder for the above
    cookies=None,                # [{"name","value","domain"}]
    headers=None,
    user_agent=None,
    user_agent_mode="",          # "random" to randomize
    text_mode=False,             # skip images — big speedup for text-only crawls
    light_mode=False,            # disable background features
    avoid_ads=False,             # block known ad/tracker domains
    avoid_css=False,             # skip stylesheet loading
    enable_stealth=False,        # playwright-stealth fingerprint patches
    extra_args=None,             # raw browser flags, e.g. ["--disable-extensions"]
    verbose=True,
)
```

`text_mode=True` plus `avoid_ads=True` is a cheap, large win when only text matters.

## CrawlerRunConfig — how one crawl behaves

```python
CrawlerRunConfig(
    # content shaping
    word_count_threshold=200,    # blocks under this word count are dropped — lower for listings
    css_selector=None,           # narrows the ENTIRE crawl to this subtree
    target_elements=None,        # narrows only markdown/extraction; links+media stay page-wide
    excluded_tags=None,          # ["nav","footer","header","form"]
    exclude_external_links=False,
    keep_data_attributes=False,
    remove_forms=False,
    process_iframes=False,
    remove_overlay_elements=False,  # kill cookie banners / modals
    flatten_shadow_dom=False,       # required for Web Component sites (Lit, Stencil, …)
    table_score_threshold=7,        # lower → more tables detected into result.tables

    # output
    markdown_generator=None,     # DefaultMarkdownGenerator(...)
    extraction_strategy=None,    # JsonCss / JsonXPath / Regex / LLM strategy
    chunking_strategy=RegexChunking(),
    screenshot=False,
    force_viewport_screenshot=False,  # visible viewport only — faster, smaller
    pdf=False,
    capture_mhtml=False,
    capture_network_requests=False,
    capture_console_messages=False,
    fetch_ssl_certificate=False,

    # navigation and interaction
    js_code=None,                # runs AFTER wait_for
    js_code_before_wait=None,    # runs BEFORE wait_for — use to trigger the loading it waits on
    c4a_script=None,
    wait_for=None,               # "css:.loaded" or "js:() => window.ready === true"
    wait_until="domcontentloaded",   # or "networkidle"
    page_timeout=60000,          # MILLISECONDS
    delay_before_return_html=0.1,# seconds
    scan_full_page=False,        # scroll the page to trigger lazy loading
    scroll_delay=0.2,            # seconds between scrolls
    virtual_scroll_config=None,  # VirtualScrollConfig(...) for recycling feeds
    session_id=None,             # reuse the same tab across calls
    js_only=False,               # continue in an existing session without re-navigating

    # identity and network
    locale=None,                 # "en-US"
    timezone_id=None,            # "America/New_York"
    geolocation=None,            # GeolocationConfig(latitude=..., longitude=...)
    proxy_config=None,           # ProxyConfig or list[ProxyConfig] (tried in order)
    proxy_rotation_strategy=None,
    max_retries=0,               # retry rounds when blocking is detected
    fallback_fetch_function=None,# async fn(url) -> raw HTML, last resort

    # caching, batching
    cache_mode=CacheMode.BYPASS, # ENABLED | BYPASS | DISABLED | READ_ONLY | WRITE_ONLY
    stream=False,                # streaming results from arun_many()
    url_matcher=None,            # glob/function/list — per-URL configs in arun_many()
    match_mode=MatchMode.OR,
    deep_crawl_strategy=None,
    scraping_strategy=None,      # e.g. LXMLWebScrapingStrategy()
    verbose=True,
)
```

### css_selector vs target_elements

This distinction causes real bugs. `css_selector` scopes the whole pipeline — anything
outside the selector is invisible, including links and images you may still want.
`target_elements` scopes only markdown generation and extraction, leaving link/media
collection across the full page. Default to `target_elements` unless you deliberately want
the page truncated.

### Cache modes

`ENABLED` (read+write), `BYPASS` (default — always fetch fresh, still writes), `DISABLED`
(no cache at all), `READ_ONLY`, `WRITE_ONLY`. Turn on `ENABLED` while iterating on selectors
so you aren't re-fetching a site dozens of times.

## LLMConfig

```python
LLMConfig(
    provider="openai/gpt-4o-mini",   # LiteLLM-style: openai/… anthropic/… gemini/… ollama/… groq/…
    api_token=None,                  # or "env:GROQ_API_KEY"; inferred from env per provider
    base_url=None,                   # custom endpoints
    backoff_base_delay=2,            # seconds before first retry on rate limit
    backoff_max_attempts=3,
    backoff_exponential_factor=2,
)
```

Every strategy that takes an `llm_config` honors the same backoff policy.

## Class-level defaults

For servers where every config needs the same base settings:

```python
BrowserConfig.set_defaults(cache_cdp_connection=True, create_isolated_context=True)
CrawlerRunConfig.set_defaults(verbose=False)
BrowserConfig.get_defaults()
BrowserConfig.reset_defaults()             # all
BrowserConfig.reset_defaults("verbose")    # named only
```

Explicit constructor arguments still win over class defaults. Defaults live in process
memory and are per-class.

Source: https://docs.crawl4ai.com/core/browser-crawler-config/, /api/parameters/
