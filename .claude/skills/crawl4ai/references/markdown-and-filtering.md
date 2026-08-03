# Markdown generation and content filtering

Crawl4AI always produces markdown. The question is how much noise it carries. Two levers:
the markdown generator's options, and a content filter that produces `fit_markdown`.

## DefaultMarkdownGenerator

```python
from crawl4ai import CrawlerRunConfig
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

md = DefaultMarkdownGenerator(
    content_source="cleaned_html",   # "cleaned_html" (default) | "raw_html" | "fit_html"
    options={
        "ignore_links": True,        # drop hyperlinks entirely
        "ignore_images": True,       # drop ![]() references
        "escape_html": False,
        "body_width": 0,             # 0/None = no hard wrapping (usually what you want for LLMs)
        "skip_internal_links": True, # omit #anchor links to the same page
        "citations": True,           # [text][1] plus a reference list at the bottom
        "include_sup_sub": True,
    },
)

config = CrawlerRunConfig(markdown_generator=md)
```

`content_source` picks which HTML feeds the converter: `cleaned_html` (post-scraping, the
default), `raw_html` (untouched page), or `fit_html` (preprocessed for extraction). Use
`raw_html` when the cleaning step is eating content you need.

`result.markdown` is a `MarkdownGenerationResult`:

| Attribute | Contents |
|---|---|
| `raw_markdown` | Plain HTML→markdown conversion |
| `markdown_with_citations` | Same, with `[text][n]` citations |
| `references_markdown` | The reference list for those citations |
| `fit_markdown` | Filtered markdown — **empty unless a content filter is configured** |
| `fit_html` | HTML that produced `fit_markdown` |

## Content filters

Attach a filter to the generator; the filtered output lands in `fit_markdown`.

### PruningContentFilter — general noise removal

Scores each node on text density, link density, and tag importance, then drops what falls
below the threshold. This is the right default when you want "the article, not the chrome"
and have no particular query in mind.

```python
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

prune = PruningContentFilter(
    threshold=0.45,
    threshold_type="dynamic",     # "fixed" = every node must clear `threshold`
    min_word_threshold=5,
    preserve_classes=["author", "byline", "dateline"],  # never pruned (v0.9.1+)
    preserve_tags=["time", "address"],
)
md = DefaultMarkdownGenerator(content_filter=prune)
```

The `preserve_classes` / `preserve_tags` whitelist exists because density scoring reliably
eats short metadata — bylines, timestamps, attribution. Whitelisted nodes skip scoring
entirely. Adds roughly 50ms per page.

### BM25ContentFilter — query-driven

Keeps blocks relevant to a query. Use when the crawl has a topic, e.g. building a RAG corpus
about a specific subject.

```python
from crawl4ai.content_filter_strategy import BM25ContentFilter

bm25 = BM25ContentFilter(
    user_query="startup fundraising tips",  # if blank, inferred from page metadata
    bm25_threshold=1.2,                     # higher = stricter
)
```

### LLMContentFilter — instruction-driven

Most expensive, most controllable. Good when the desired shape of the output is easier to
describe than to select.

```python
from crawl4ai import LLMConfig, LLMContentFilter

filt = LLMContentFilter(
    llm_config=LLMConfig(provider="gemini/gemini-1.5-pro", api_token="env:GEMINI_API_TOKEN"),
    instruction="""
    Keep the core educational content: concepts, explanations, code examples.
    Drop navigation, sidebars, and footers. Output clean markdown with code blocks.
    """,
    chunk_token_threshold=500,
)
```

## Cheaper wins before you reach for a filter

Filters cost time (or money). Structural exclusion is free and often enough:

```python
CrawlerRunConfig(
    target_elements=["article.main", "div.content"],  # scope markdown/extraction only
    excluded_tags=["nav", "footer", "header", "aside", "form"],
    exclude_external_links=True,
    remove_overlay_elements=True,   # cookie banners, modals
    remove_forms=True,
    word_count_threshold=10,        # lower than the 200 default for listing-style pages
)
```

A typical high-quality documentation crawl combines both: `target_elements` to scope,
`PruningContentFilter` to polish, `ignore_links=True` to keep the markdown readable.

Source: https://docs.crawl4ai.com/core/markdown-generation/, /core/fit-markdown/,
/core/content-selection/
