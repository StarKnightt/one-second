// Shared helpers: serve dist/ and open render pages in headless Chromium.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };

export function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(dir, url === '/' ? 'index.html' : url);
    if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function launch() {
  // WebGL on SwiftShader (CPU): identical pixels on any machine, no GPU needed
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--font-render-hinting=none'] });
}

export async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(0);
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`http://127.0.0.1:${port}/?render`);
  await page.evaluate(() => window.ready);
  return page;
}
