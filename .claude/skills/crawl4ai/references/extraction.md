# Structured extraction

All extraction strategies are passed as `CrawlerRunConfig(extraction_strategy=...)` and write a
**JSON string** to `result.extracted_content`. Parse it with `json.loads()`.

Order of preference: schema-based (CSS/XPath) → regex → LLM. The first two are free,
deterministic, and fast enough for thousands of pages; LLM extraction costs money per page and
can vary run to run. If the page structure is unfamiliar, spend one LLM call generating a
schema and then run that schema forever.

## Schema-based: JsonCssExtractionStrategy / JsonXPathExtractionStrategy

```python
import json
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode, JsonCssExtractionStrategy

schema = {
    "name": "Products",
    "baseSelector": "div.product-card",     # one match = one output object
    "baseFields": [                          # read from the container element itself
        {"name": "product_url", "type": "attribute", "attribute": "href"}
    ],
    "fields": [
        {"name": "title", "selector": "h2.title", "type": "text", "default": "No title"},
        {"name": "price", "selector": "span.price", "type": "text"},
        {"name": "image", "selector": "img", "type": "attribute", "attribute": "src"},
        {"name": "blurb", "selector": ".description", "type": "html"},
    ],
}

cfg = CrawlerRunConfig(
    cache_mode=CacheMode.BYPASS,
    extraction_strategy=JsonCssExtractionStrategy(schema),
)

async with AsyncWebCrawler() as crawler:
    result = await crawler.arun("https://example.com/shop", config=cfg)
    products = json.loads(result.extracted_content)
```

### Field types

| `type` | Meaning |
|---|---|
| `text` | Text content of the matched element |
| `attribute` | Value of `attribute` (requires `"attribute": "href"` etc.) |
| `html` | Inner HTML of the match |
| `nested` | A single sub-object, with its own `fields` |
| `nested_list` | A list of sub-objects, each with its own `fields` |
| `list` | A list of simple values, described by a one-field `fields` list |

Optional per-field keys: `default` (value when the selector misses), `transform`
(e.g. `"strip"`).

```python
{
    "name": "specs",
    "selector": "ul.specs li",
    "type": "list",
    "fields": [{"name": "spec", "type": "text"}]
},
{
    "name": "reviews",
    "selector": "div.review",
    "type": "nested_list",
    "fields": [
        {"name": "author", "selector": ".author", "type": "text"},
        {"name": "rating", "selector": ".stars", "type": "attribute", "attribute": "data-rating"},
    ]
}
```

### Sibling data with `source`

Field selectors normally only search *descendants* of `baseSelector`. Some sites split one
logical record across sibling elements (Hacker News rows are the canonical case). Prefix a
sibling selector with `+` to hop before matching:

```python
{"name": "score", "selector": "span.score", "type": "text", "source": "+ tr"}
```

`"+ tr"` = next sibling `<tr>`; `"+ div.details"`, `"+ .subtext"` work the same way.

### Generating a schema with an LLM (one-time cost)

```python
from crawl4ai import JsonCssExtractionStrategy, LLMConfig

schema = JsonCssExtractionStrategy.generate_schema(
    html,                       # a representative HTML snippet, not the whole page
    schema_type="css",          # or "xpath" via JsonXPathExtractionStrategy
    llm_config=LLMConfig(provider="openai/gpt-4o", api_token="..."),
    # validate=True by default: the schema is tested against the HTML and refined if it
    # extracts nothing
)
```

Save the returned dict to disk and load it in production — no LLM at crawl time. Passing
several representative samples produces a schema that survives layout variation better than
one built from a single card.

### XPath

`JsonXPathExtractionStrategy` takes the same schema shape with XPath selectors. Useful when
the structure is easier to express by traversal than by class names.

## Regex extraction

For values that appear in prose rather than in predictable containers:

```python
from crawl4ai import RegexExtractionStrategy

strategy = RegexExtractionStrategy(
    pattern=RegexExtractionStrategy.Email | RegexExtractionStrategy.PhoneUS
)
```

Built-in patterns (IntFlag, combine with `|`, or use `.All`): `Email`, `PhoneIntl`,
`PhoneUS`, `Url`, `IPv4`, `IPv6`, `Uuid`, `Currency`, `Percentage`, `Number`, `DateIso`,
`DateUS`, `Time24h`, `PostalUS`, `PostalUK`, `HexColor`, `TwitterHandle`, `Hashtag`,
`MacAddr`, `Iban`, `CreditCard`.

Custom patterns are passed as a dict of `{label: regex}`. Results come back labeled by
pattern name, so you can mix built-ins and custom patterns in one pass.

## LLM extraction

Worth it for irregular pages, or when the target is semantic ("the argument the author is
making") rather than positional.

```python
from pydantic import BaseModel, Field
from crawl4ai import CrawlerRunConfig, CacheMode, LLMConfig, LLMExtractionStrategy

class Model(BaseModel):
    model_name: str = Field(..., description="Name of the model")
    input_fee: str = Field(..., description="Price per input token")

cfg = CrawlerRunConfig(
    cache_mode=CacheMode.BYPASS,
    word_count_threshold=1,
    page_timeout=80_000,
    extraction_strategy=LLMExtractionStrategy(
        llm_config=LLMConfig(provider="openai/gpt-4o", api_token=os.getenv("OPENAI_API_KEY")),
        schema=Model.model_json_schema(),
        extraction_type="schema",          # or "block" for free-form chunks
        instruction="Extract every model mentioned with its input and output token fees.",
        extra_args={"temperature": 0, "max_tokens": 2000},
    ),
)
```

Notes that matter in practice: content is chunked before being sent to the model, so an
instruction saying "do not miss any items in the entire content" measurably helps; set
`temperature=0` for repeatability; and `LLMConfig` handles rate-limit backoff for you.

## Testing schemas without hitting the network

Prefix raw HTML with `raw:` (`raw://` also works) and Crawl4AI skips the fetch entirely:

```python
result = await crawler.arun(url="raw://" + html_string, config=cfg)
result = await crawler.arun(url=f"file://{path.resolve()}", config=cfg)   # local HTML file
```

This is the fastest way to iterate on a schema: fetch the page once, save the HTML, then loop
on `raw://` until the extraction is right. Local files work too via `file://`.

Source: https://docs.crawl4ai.com/extraction/no-llm-strategies/, /extraction/llm-strategies/
