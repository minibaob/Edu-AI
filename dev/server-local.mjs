// 仅用于本地浏览器演练的 Node 服务：真实 functions/ 路由 + 内存假数据库。
// 不打进 Function 包。生产环境的固定来源校验不变；这里把请求 Origin 规范化为固定 https
// fixture 来源（等价于 check.mjs 中 origin 与请求一致的 fixture），使本地 HTTP 演练可走通。
//   node dev/server-local.mjs   （配合 npm run dev 的 /functions/v1/app 代理）
import http from 'node:http';
import { createApplication } from '../functions/router.mjs';
import { createFakeDb } from './fake-db.mjs';
import { createFakeStorage } from './fake-storage.mjs';
import { seedLocal } from './seed-local.mjs';

const FIXTURE_ORIGIN = 'https://local.fixture';
const db = createFakeDb({ mode: 'ok', dropTable: null, rejectTable: null, writes: [] });
const storage = createFakeStorage();
const handle = createApplication({ db, origin: FIXTURE_ORIGIN, storage });

// 可选：EDUAI_SEED_DIR=<转换后的CSV目录> 时，用真实导入路由灌入官方数据做本地演练。
// 多个目录用逗号分隔，按顺序灌入（多省增量导入演练）。
if (process.env.EDUAI_SEED_DIR) {
  for (const dir of process.env.EDUAI_SEED_DIR.split(',')) {
    await seedLocal(handle, db, dir.trim());
  }
}

const STORAGE_PREFIX = '/functions/v1/app/__local_storage__/';

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // 假 Storage 的签名 URL：PUT 存入内存对象表，GET 按存储的 MIME 回传字节。
  if (req.url.startsWith(STORAGE_PREFIX)) {
    const path = decodeURIComponent(req.url.slice(STORAGE_PREFIX.length));
    if (req.method === 'PUT') {
      storage.put(path, new Uint8Array(body), req.headers['content-type'] ?? 'application/octet-stream');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const object = storage.get(path);
    if (!object) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    res.writeHead(200, {
      'content-type': object.contentType,
      'content-disposition': 'attachment',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(Buffer.from(object.bytes));
    return;
  }

  const request = new Request(`http://127.0.0.1:8000${req.url}`, {
    method: req.method,
    headers: { ...req.headers, origin: FIXTURE_ORIGIN },
    ...(body.length > 0 ? { body, duplex: 'half' } : {}),
  });
  try {
    const response = await handle({ request, requestId: `local-${Date.now()}` });
    const headers = {};
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') headers[key] = value; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'service_unavailable' }));
  }
});

server.listen(8000, '127.0.0.1', () => console.log('local fixture function on http://127.0.0.1:8000'));