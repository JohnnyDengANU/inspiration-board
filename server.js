#!/usr/bin/env node
/**
 * 零依赖 Node 服务：静态托管 + 公开 REST API
 * - 用于本地验证前端 CRUD 全链路
 * - 也可用于「自托管」模式：任何人可经 /api/inspirations 公开读写
 * - 数据持久化到 data/inspirations.json
 *
 * 启动：node server.js  （可选 PORT 环境变量，默认 3000）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'inspirations.json');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // 首次运行：回退到仓库根目录的种子文件
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, 'inspirations.json'), 'utf8'));
    } catch (e2) {
      return [];
    }
  }
}

function writeData(arr) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防目录穿越
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // 公开 API：/api/inspirations
  if (urlPath === '/api/inspirations') {
    if (req.method === 'GET') {
      return send(res, 200, readData());
    }
    if (req.method === 'PUT') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return send(res, 400, { error: 'body must be array' });
          writeData(arr);
          return send(res, 200, { ok: true, count: arr.length });
        } catch (e) {
          return send(res, 400, { error: 'invalid json' });
        }
      });
      return;
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`灵感板服务已启动: http://localhost:${PORT}`);
  console.log(`公开 API: http://localhost:${PORT}/api/inspirations`);
});
