# JavaScript, sessions, and dynamic content

When the content you want isn't in the first HTML response — infinite scroll, "load more"
buttons, tabs, logins — you drive the page with `CrawlerRunConfig`.

## Waiting for the right moment

```python
CrawlerRunConfig(
    wait_until="networkidle",              # or "domcontentloaded" (default, faster)
    wait_for="css:.results-loaded",        # wait for a selector
    # wait_for="js:() => document.querySelectorAll('.item').length > 20",
    delay_before_return_html=0.5,          # seconds of grace after everything settles
    page_timeout=60_000,                   # milliseconds
)
```

`wait_for` with a JS predicate is the reliable option for content that arrives without a
network event — poll for the condition you actually care about rather than sleeping.

## Running JavaScript

```python
CrawlerRunConfig(
    js_code_before_wait="document.querySelector('#load-more').click();",  # runs BEFORE wait_for
    js_code=["window.scrollTo(0, document.body.scrollHeight);"],          # runs AFTER wait_for
    wait_for="js:() => document.querySelectorAll('.item').length > 20",
)
```

The ordering is the whole point: `js_code_before_wait` triggers the loading, `wait_for`
blocks until it lands, `js_code` acts on the finished page. Putting a click in `js_code` and
expecting `wait_for` to catch its result is the classic mistake.

`js_code` accepts a string or a list of strings. Async IIFEs work:

```python
js_click_tabs = """
(async () => {
    const tabs = document.querySelectorAll(".tabs-menu > div");
    for (const tab of tabs) { tab.scrollIntoView(); tab.click(); await new Promise(r => setTimeout(r, 500)); }
})();
"""
```

## Sessions: multi-step flows in one tab

A `session_id` keeps the same browser page alive across `arun()` calls, so state (cookies,
scroll position, logged-in status, already-clicked pagination) survives. `js_only=True` says
"don't navigate again, just run my JS in the tab that's already open".

```python
session_id = "commits"

# Page 1: normal navigation
result = await crawler.arun(url, config=CrawlerRunConfig(session_id=session_id))

# Pages 2..N: stay in the same tab
for page in range(1, 5):
    result = await crawler.arun(
        url,
        config=CrawlerRunConfig(
            session_id=session_id,
            js_only=True,                       # continue, don't re-navigate
            js_code=js_click_next,
            wait_for=js_wait_for_new_content,
        ),
    )

await crawler.crawler_strategy.kill_session(session_id)
```

Two things to get right: pass a `wait_for` that checks for *changed* content (stash the old
first item on `window` before clicking, then compare) rather than merely present content, or
you'll scrape page 1 five times; and always `kill_session()` when done, since sessions are
sequential-only and hold a live tab.

## Lazy loading and infinite scroll

```python
CrawlerRunConfig(
    scan_full_page=True,   # scroll to the bottom, triggering lazy loads
    scroll_delay=0.3,      # seconds between scroll steps
    wait_for_images=True,
)
```

For **virtualized** feeds that recycle DOM nodes (Twitter/X-style — old items are destroyed as
you scroll), `scan_full_page` loses content. Use virtual scroll, which captures each window
of content before it's recycled:

```python
from crawl4ai import VirtualScrollConfig

virtual = VirtualScrollConfig(
    container_selector="[data-testid='primaryColumn']",
    scroll_count=30,
    scroll_by="container_height",   # or a pixel count
    wait_after_scroll=1.0,
)
config = CrawlerRunConfig(virtual_scroll_config=virtual)
```

## Overlays, iframes, shadow DOM

```python
CrawlerRunConfig(
    remove_overlay_elements=True,  # cookie walls, newsletter modals
    process_iframes=True,          # inline iframe content into the result
    flatten_shadow_dom=True,       # required for Web Components; force-opens closed roots
)
```

If a site built with Lit/Stencil/Shoelace yields empty markdown, `flatten_shadow_dom=True` is
almost always the fix.

## Hooks: arbitrary Playwright access

Hooks give you the raw `page` and `context` objects at defined points — use them for logins,
custom headers, cookie injection, or waiting on something no config flag covers.

```python
async def before_goto(page, context, url, **kwargs):
    await page.set_extra_http_headers({"X-Custom": "value"})
    return page

crawler.crawler_strategy.set_hook("before_goto", before_goto)
```

Available hooks: `on_browser_created`, `on_page_context_created`, `before_goto`, `after_goto`,
`on_user_agent_updated`, `on_execution_started`, `before_retrieve_html`, `before_return_html`.
Each receives `page` and `context` (plus hook-specific arguments) and should return `page`.

For logins, prefer a persistent profile (`use_persistent_context=True` + `user_data_dir`) or
pre-seeded `cookies` in `BrowserConfig` over scripting the login form on every run — it's
faster and far less brittle. Never hardcode credentials in the script; read them from the
environment.

## Downloads

```python
BrowserConfig(accept_downloads=True, downloads_path="/tmp/dl")
# result.downloaded_files -> list of saved file paths
```

Source: https://docs.crawl4ai.com/core/page-interaction/, /advanced/session-management/,
/advanced/virtual-scroll/, /advanced/hooks-auth/
