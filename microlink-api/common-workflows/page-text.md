# Turn a whole page into text

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.text.attr=text"
```

The string is `data.text`. Add `data.text.selector` to scope it.
