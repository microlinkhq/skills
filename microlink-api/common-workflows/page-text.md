# Turn a whole page into text

```js
import createClient from 'microlink.io'

const microlink = createClient()
const text = await microlink.text('https://example.com')
console.log(text)
```
