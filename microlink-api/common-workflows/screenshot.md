# Screenshot generation

```js
import createClient from 'microlink.io'

const microlink = createClient()
const { url } = await microlink.screenshot('https://example.com', {
  fullPage: true,
  type: 'png'
})

console.log(url)
```
