# Extract all links

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.links.selectorAll=a" \
  --data-urlencode "data.links.attr=href" \
  --data-urlencode "data.links.type=url"
```

The list is `data.links`. Use a tighter selector (`nav a`) to scope it.
