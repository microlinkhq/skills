# PDF generation

```js
import createClient from 'microlink.io'

const microlink = createClient()
const { url } = await microlink.pdf('https://example.com', {
  format: 'A4',
  landscape: false
})

console.log(url)
```
