# Extract all images

```js
import createClient from 'microlink.io'

const microlink = createClient()
const images = await microlink.images('https://example.com')
console.log(images)
```
