# Screenshot generation

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "screenshot=true" \
  --data-urlencode "screenshot.fullPage=true" \
  --data-urlencode "screenshot.type=png" \
  --data-urlencode "meta=false"
```

The image URL is `data.screenshot.url`.
