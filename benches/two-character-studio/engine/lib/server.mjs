// Minimal static server for the studio page: /bench/* (this bench, including node_modules/three), /config.json (built
// per run) and /asset/* (fonts and images mapped one by one, so nothing else on disk is reachable).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.png':'image/png',
                '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.otf':'font/otf',
                '.woff':'font/woff', '.woff2':'font/woff2' };

export async function serve(bench, config){
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = null;
    if (url === '/config.json'){            // per-page overrides: ?pass=mask&scale=0.5&cam=two&lookcam=1
      const q = new URL(req.url, 'http://x').searchParams, page = { ...config.page, query:{ ...config.page.query } };
      if (q.get('pass')) page.pass = q.get('pass');
      if (q.get('scale')) page.scale = Number(q.get('scale'));
      if (q.get('cam')) page.query.cam = q.get('cam');
      if (q.get('lookcam')) page.query.lookcam = true;
      if (q.get('camx')) page.query.camx = q.get('camx').split(',').map(Number);
      res.writeHead(200, { 'Content-Type':'application/json' }); return res.end(JSON.stringify(page)); }
    if (url.startsWith('/asset/')) file = config.files[url];
    else if (url.startsWith('/bench/')){
      const p = path.resolve(bench, '.' + url.slice('/bench'.length));
      if (p.startsWith(bench + path.sep)) file = p;
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type':TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  return { server, base:`http://127.0.0.1:${server.address().port}` };
}
