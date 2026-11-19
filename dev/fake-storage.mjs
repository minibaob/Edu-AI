// 仅用于本地演练的凭据无关假 Storage（内存对象表）。
// 复刻平台适配器的方法形状：upload/download/remove/createSignedUploadUrl/createSignedUrl/list。
// 签名 URL 指向 /functions/v1/app/__local_storage__/<path>，由 dev/server-local.mjs 拦截转发，
// 使本地浏览器可以走完整的「签发 → PUT → 回读校验 → 下载」流程。
// 契约测试里直接调用 put() 模拟浏览器 PUT。不要把它打进 Function 包。
export function createFakeStorage(control = {}) {
  const objects = new Map();
  const toBytes = async (body) => new Uint8Array(await new Blob([body]).arrayBuffer());
  return {
    async upload(path, body, { contentType } = {}) {
      objects.set(path, { bytes: await toBytes(body), contentType: contentType ?? 'application/octet-stream' });
      return { ok: true };
    },
    async download(path) {
      const object = objects.get(path);
      if (!object) return new Response(null, { status: 404 });
      return new Response(object.bytes, { status: 200, headers: { 'content-type': object.contentType } });
    },
    async remove(paths) {
      for (const path of paths) objects.delete(path);
      return { ok: true };
    },
    async createSignedUploadUrl(path) {
      if (control.failSign) { control.failSign = false; throw new Error('simulated signing failure'); }
      return { signedUrl: `/functions/v1/app/__local_storage__/${path}` };
    },
    async createSignedUrl(path) {
      return { signedUrl: `/functions/v1/app/__local_storage__/${path}` };
    },
    async list() {
      return { entries: [...objects.keys()].map((name) => ({ name })) };
    },
    // 测试/演练辅助：模拟浏览器 PUT 与断言存储内容。
    put(path, bytes, contentType) { objects.set(path, { bytes, contentType }); },
    has: (path) => objects.has(path),
    get: (path) => objects.get(path),
  };
}