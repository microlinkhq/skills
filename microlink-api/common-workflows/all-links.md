# Extract all links

```js
import createClient from 'microlink.io'

const microlink = createClient()
const links = await microlink.links('https://example.com')
console.log(links)
```
