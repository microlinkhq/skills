# Turn a whole page into markdown

```js
import createClient from 'microlink.io'

const microlink = createClient()
const markdown = await microlink.markdown('https://example.com')
console.log(markdown)
```
