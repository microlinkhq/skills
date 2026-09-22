# Turn a whole page into HTML

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.html.attr=html"
```

The string is `data.html`. Add `data.html.selector` to scope it.
