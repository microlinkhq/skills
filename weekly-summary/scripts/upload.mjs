#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const USAGE = `Usage:
  upload.mjs UPLOAD_URL UPLOAD_HEADERS_JSON FILE

Sends FILE to the upload_url returned by the notion-create-file-upload tool, with every
header from its upload_headers (pass that object as JSON). Prints the
<image source="file-upload://..." /> tag to place on the page within the hour, before
the upload expires.`

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

const parseHeaders = json => {
  try {
    const headers = JSON.parse(json)
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) return headers
  } catch {}
  throw new Error('pass upload_headers as JSON, e.g. \'{"authorization":"Bearer ..."}\'')
}

export const upload = async (uploadUrl, headersJson, file) => {
  const headers = parseHeaders(headersJson)
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const form = new FormData()
  form.append('file', new Blob([readFileSync(file)], { type }), path.basename(file))
  const response = await fetch(uploadUrl, { method: 'POST', headers, body: form })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.status !== 'uploaded') {
    throw new Error(`upload failed with ${response.status}: ${JSON.stringify(body)}`)
  }
  if (!body.markdown_source) throw new Error(`upload answered no markdown_source: ${JSON.stringify(body)}`)
  return `<image source="${body.markdown_source}" />`
}

const main = async argv => {
  if (argv.length !== 3) {
    console.log(USAGE)
    return 1
  }
  console.log(await upload(...argv))
  return 0
}

const entry = process.argv[1]
if (entry !== '-' && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(`upload.mjs: ${error.message}`)
    process.exitCode = 1
  }
}
