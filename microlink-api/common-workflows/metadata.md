# Metadata extraction

```js
import createClient from 'microlink.io'

const microlink = createClient()
const { title, description, image } = await microlink.metadata('https://example.com')
console.log(title, description, image?.url)
```
