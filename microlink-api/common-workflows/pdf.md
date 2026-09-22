# PDF generation

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://example.com" \
  --data-urlencode "pdf=true" \
  --data-urlencode "pdf.format=A4" \
  --data-urlencode "pdf.landscape=false" \
  --data-urlencode "meta=false"
```

The file URL is `data.pdf.url`.
