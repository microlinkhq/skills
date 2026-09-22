# Custom scraping

```bash
curl -G "https://api.microlink.io" \
  --data-urlencode "url=https://news.ycombinator.com" \
  --data-urlencode "meta=false" \
  --data-urlencode "data.headline.selector=.titleline > a" \
  --data-urlencode "data.headline.attr=text" \
  --data-urlencode "data.link.selector=.titleline > a" \
  --data-urlencode "data.link.attr=href" \
  --data-urlencode "data.link.type=url"
```

`data.headline` and `data.link`.
