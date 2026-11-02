#!/usr/bin/env node
// Serve a built front-end on 127.0.0.1 for headless captures.
//
//   node tools/serve.mjs <dir> [--port 4401] [--api <dir>] [--spa]
//
// --api mounts a folder of JSON fixtures at /api/ for GET and HEAD only (anything else answers 405), so two builds
// of the same screen read the very same data and nothing can be written. --spa answers unknown paths with
// index.html. Prints the URL on its first line and stops on SIGINT or SIGTERM.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d }
const positional = []
for (let i = 0; i < args.length; i++) { if (args[i] === '--port' || args[i] === '--api') { i++; continue } if (!args[i].startsWith('--')) positional.push(args[i]) }
const root = resolve(positional[0] || '.')
const port = parseInt(opt('port', '4401'), 10)
const api = opt('api') ? resolve(opt('api')) : null
const spa = args.includes('--spa')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.map': 'application/json' }

function send(res, file) {
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const path = decodeURIComponent(url.pathname)
  if (api && path.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('read-only'); return }
    const file = normalize(join(api, path.slice(5)))
    if (!file.startsWith(api) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return }
    return send(res, file)
  }
  let file = normalize(join(root, path))
  if (!file.startsWith(root)) { res.writeHead(403).end(); return }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) { if (spa) file = join(root, 'index.html'); else { res.writeHead(404).end(); return } }
  send(res, file)
})
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)))
