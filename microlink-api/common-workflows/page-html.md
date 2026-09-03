# Turn a whole page into HTML

```js
import createClient from 'microlink.io'

const microlink = createClient()
const html = await microlink.html('https://example.com')
console.log(html)
```
