# Custom scraping

```js
import createClient from 'microlink.io'

const microlink = createClient()
const { headline, link } = await microlink.extract('https://news.ycombinator.com', {
  headline: { selector: '.titleline > a', attr: 'text' },
  link: { selector: '.titleline > a', attr: 'href', type: 'url' }
})

console.log(headline, link)
```
