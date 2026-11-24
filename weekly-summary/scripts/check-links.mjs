#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TIMEOUT_MS = 15_000
const CONCURRENCY = 8
const SIGN_IN_PATH = /\/(log-?in|sign-?in|auth|sso|session)(\/|\?|$)/i
const NPM_PACKAGE_PAGE = /^https:\/\/(www\.)?npmjs\.com\/package\/(.+?)\/?$/

const USAGE = `Usage:
  check-links.mjs URL [URL ...]

Fetches each URL anonymously, following redirects, and prints whether it may be linked.
A URL fails when it does not answer 2xx (a private repository answers 404) or when it
lands on a sign-in page (a dashboard behind a login). npm package pages answer bots with
403, so they are checked through the registry instead. Exits 1 when any URL fails.`

export const probeUrl = url => {
  const npmPackage = url.match(NPM_PACKAGE_PAGE)?.[2]
  return npmPackage ? `https://registry.npmjs.org/${npmPackage.replace('/', '%2F')}` : url
}

export const checkLink = async url => {
  try {
    const probed = probeUrl(url)
    const response = await fetch(probed, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    await response.body?.cancel()
    const final = new URL(response.url)
    const fetched = new URL(probed)
    const redirected = final.pathname !== fetched.pathname || final.search !== fetched.search
    const signIn = SIGN_IN_PATH.test(final.pathname + final.search) && (redirected || !SIGN_IN_PATH.test(fetched.pathname + fetched.search))
    return {
      url,
      status: response.status,
      ok: response.ok && !signIn,
      finalUrl: response.url,
      reason: signIn ? 'redirects to sign-in' : response.ok ? null : `answers ${response.status}`
    }
  } catch (error) {
    return { url, status: 0, ok: false, reason: error.cause?.code || error.name }
  }
}

export const checkLinks = async urls => {
  const results = new Array(urls.length)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const index = next++
      results[index] = await checkLink(urls[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))
  return results
}

const describe = result => {
  if (result.ok) return `OK   ${result.status} ${result.url}`
  return `FAIL ${result.url} (${result.reason})`
}

const main = async urls => {
  if (urls.length === 0 || urls.includes('--help')) {
    console.log(USAGE)
    return urls.length === 0 ? 1 : 0
  }
  const results = await checkLinks(urls)
  for (const result of results) console.log(describe(result))
  return results.every(result => result.ok) ? 0 : 1
}

const entry = process.argv[1]
if (entry && entry !== '-' && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2))
}
