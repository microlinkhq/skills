# Extract all images

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.images.selectorAll=img" \
  --data-urlencode "data.images.attr=src" \
  --data-urlencode "data.images.type=url"
```

The list is `data.images`. Use a tighter selector (`article img`) to scope it.
