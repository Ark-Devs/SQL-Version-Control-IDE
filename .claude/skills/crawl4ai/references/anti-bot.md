# Getting past blocks

Escalate in this order — each step costs more performance or money than the last, and most
sites give up well before the end. Only apply this to sites the user is authorized to crawl;
if a block looks like a deliberate access-control decision (paywall, login wall, explicit
robots policy), raise it with the user rather than routing around it.

1. Look like a normal browser (headers, viewport, locale)
2. `enable_stealth=True`
3. Persistent profile / real cookies
4. Undetected browser adapter
5. Proxies and retry escalation

## 1–2. Stealth mode

```python
from crawl4ai import AsyncWebCrawler, BrowserConfig

browser_config = BrowserConfig(
    enable_stealth=True,       # playwright-stealth fingerprint patches
    headless=False,            # headless is itself a detection signal
    user_agent_mode="random",
    viewport_width=1280, viewport_height=800,
)
```

Stealth removes `navigator.webdriver`, emulates plugins, and patches common automation leaks.
Cheap, minimal performance cost — always try it first.

## 3. Identity-based crawling

Often more effective than any evasion trick: be a returning user with real state.

```python
BrowserConfig(
    use_persistent_context=True,
    user_data_dir="/path/to/profile",      # cookies and localStorage persist across runs
    cookies=[{"name": "session", "value": "...", "domain": "example.com"}],
    headers={"Accept-Language": "en-US,en;q=0.9"},
)

CrawlerRunConfig(
    locale="en-US",
    timezone_id="America/New_York",
    geolocation=GeolocationConfig(latitude=48.8566, longitude=2.3522),
)
```

`BrowserProfiler` can create and manage these profiles interactively (log in once by hand,
reuse the profile forever). Locale/timezone/geolocation consistency also matters for
region-gated content — a US IP with a Paris timezone looks wrong.

## 4. Undetected browser adapter

For Cloudflare, DataDome, PerimeterX-class protection where stealth alone fails:

```python
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, UndetectedAdapter
from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy

browser_config = BrowserConfig(headless=False, enable_stealth=True)  # combine both
strategy = AsyncPlaywrightCrawlerStrategy(
    browser_config=browser_config,
    browser_adapter=UndetectedAdapter(),
)

async with AsyncWebCrawler(crawler_strategy=strategy, config=browser_config) as crawler:
    result = await crawler.arun("https://example.com", config=CrawlerRunConfig())
```

Same API as usual, moderate performance cost, deeper browser patches.

## 5. Proxies and automatic escalation

Crawl4AI detects blocking (403/429 with thin bodies, Cloudflare "Just a moment", CAPTCHA
injection, firewall interstitials) using structural HTML markers, then escalates:

```python
from crawl4ai.async_configs import ProxyConfig, CrawlerRunConfig

config = CrawlerRunConfig(
    max_retries=2,                       # retry rounds after a detected block (default 0)
    proxy_config=[                       # tried in order, every round
        ProxyConfig.DIRECT,              # explicitly try without a proxy first
        ProxyConfig(server="http://proxy.io:8080", username="u", password="p"),
        ProxyConfig(server="http://premium.io:9090"),
    ],
    fallback_fetch_function=my_async_fetch,   # async (url) -> raw HTML, last resort
)
```

Worst case is `(1 + max_retries) × len(proxy_config)` attempts before the fallback function
runs, so keep `max_retries` small. What actually happened is recorded on the result:

```python
result.crawl_stats
# {"attempts": 3, "retries": 1, "proxies_used": [...], 
#  "fallback_fetch_used": False, "resolved_by": "proxy"}
```

`resolved_by` is `"direct"`, `"proxy"`, `"fallback_fetch"`, or `None` when everything failed.
When all attempts fail, you get `success=False` with the block reason in `error_message` —
check it rather than assuming a network error.

For rotation across many URLs:

```python
from crawl4ai.proxy_strategy import RoundRobinProxyStrategy

CrawlerRunConfig(proxy_rotation_strategy=RoundRobinProxyStrategy(proxies))
```

## Diagnosing a block

Before escalating, confirm what you're actually seeing: run with `headless=False` and watch,
or dump `result.html` and `result.status_code`. Empty markdown with a 200 status is usually a
JS-rendering problem (see `dynamic-pages.md`), not a block — reaching for the undetected
browser when the real issue is a missing `wait_for` wastes a lot of time.

Source: https://docs.crawl4ai.com/advanced/undetected-browser/,
/advanced/anti-bot-and-fallback/, /advanced/identity-based-crawling/, /advanced/proxy-security/
