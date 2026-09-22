# Turn a whole page into markdown

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.markdown.attr=markdown"
```

The string is `data.markdown`. Add `data.markdown.selector` to scope it.
