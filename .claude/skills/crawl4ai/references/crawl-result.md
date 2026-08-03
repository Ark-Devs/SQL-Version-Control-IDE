# CrawlResult

Every `arun()` returns one `CrawlResult`; `arun_many()` returns a list (or an async generator
when streaming); a deep crawl returns a list. Failures do **not** raise — check `success`.

```python
if not result.success:
    print(result.status_code, result.error_message)
```

## Fields

| Field | Type | Notes |
|---|---|---|
| `url` | `str` | Final URL crawled |
| `success` | `bool` | Always branch on this |
| `status_code` | `int?` | HTTP status |
| `error_message` | `str?` | Populated when `success=False`, including block reasons |
| `html` | `str` | Untouched page HTML |
| `cleaned_html` | `str?` | Scripts/styles stripped, honors `excluded_tags`, `remove_forms`, … |
| `fit_html` | `str?` | Preprocessed HTML used for extraction/filtering |
| `markdown` | `MarkdownGenerationResult` | See below |
| `extracted_content` | `str?` | JSON **string** from an extraction strategy — `json.loads` it |
| `links` | `dict` | `{"internal": [...], "external": [...]}`, each with `href`, `text`, … |
| `media` | `dict` | `{"images": [...], "audio": [...], "video": [...]}` with `src`, `alt`, `score` |
| `tables` | `list[dict]` | `{headers, rows, caption, summary}` |
| `metadata` | `dict?` | Page metadata; deep crawls add `depth` |
| `screenshot` | `str?` | base64 PNG when `screenshot=True` |
| `pdf` | `bytes?` | when `pdf=True` |
| `mhtml` | `str?` | when `capture_mhtml=True` — whole page incl. resources, one file |
| `downloaded_files` | `list[str]?` | when `accept_downloads=True` |
| `js_execution_result` | `dict?` | Return values from `js_code` |
| `network_requests` | `list[dict]?` | when `capture_network_requests=True` |
| `console_messages` | `list[dict]?` | when `capture_console_messages=True` |
| `ssl_certificate` | `SSLCertificate?` | when `fetch_ssl_certificate=True` |
| `response_headers` | `dict?` | |
| `redirected_url`, `redirected_status_code` | | Redirect chain endpoint |
| `session_id` | `str?` | |
| `dispatch_result` | `DispatchResult?` | Concurrency/memory/timing info from `arun_many()` |
| `crawl_stats` | `dict` | Anti-bot attempt tracking (see `anti-bot.md`) |

## markdown

```python
result.markdown                      # str-like
result.markdown.raw_markdown         # plain conversion
result.markdown.fit_markdown         # filtered — empty without a content filter
result.markdown.markdown_with_citations
result.markdown.references_markdown
result.markdown.fit_html
```

Removed in v0.5: `result.markdown_v2`, and top-level `result.fit_markdown` /
`result.fit_html`. Old snippets using them will raise `AttributeError`.

## Tables

Tables are scored to distinguish data tables from layout tables; only those above
`table_score_threshold` (default 7) land in `result.tables`.

```python
config = CrawlerRunConfig(table_score_threshold=5)   # lower = more tables captured

for t in result.tables:
    print(t.get("caption"), t["headers"], len(t["rows"]))
```

If an obvious table is missing, lower the threshold before writing a custom parser. Nested
tables and tables with inconsistent cell counts may still be skipped.

## Saving binary outputs

```python
import base64
if result.screenshot:
    open("page.png", "wb").write(base64.b64decode(result.screenshot))
if result.pdf:
    open("page.pdf", "wb").write(result.pdf)
if result.mhtml:
    open("page.mhtml", "w", encoding="utf-8").write(result.mhtml)
```

MHTML captures the page plus every resource in a single file — the best option for archiving
or reproducing what the crawler actually saw.

Source: https://docs.crawl4ai.com/core/crawler-result/, /api/crawl-result/
