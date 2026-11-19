// 模块4 文件直传：扩展名白名单、大小上限、服务端派生存储路径。
// 存储路径目录段来自会话用户 ID 的 SHA-256 摘要；归属校验只认这个前缀，
// 绝不信任浏览器提交的 owner_id 或任意路径。MIME 由扩展名在服务端派生，
// 浏览器按签发时给定的 contentType 上传，落库前再回读实际字节复核。
import { AppError } from './http.mjs';
import { sha256Hex } from './sessions.mjs';

export const FILE_MAX_BYTES = 10 * 1024 * 1024;
const FILE_NAME_MAX = 120;

// 学习资料常见格式；可执行文件、脚本与未知类型一律拒绝。
export const FILE_KINDS = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip',
};

export function fileKind(fileName) {
  if (typeof fileName !== 'string') throw new AppError('invalid_file', 400);
  const name = fileName.trim();
  if (name.length === 0 || [...name].length > FILE_NAME_MAX || /[/\\\u0000-\u001f]/.test(name)) {
    throw new AppError('invalid_file', 400);
  }
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!Object.hasOwn(FILE_KINDS, ext)) throw new AppError('unsupported_file_type', 400);
  return { name, ext, mime: FILE_KINDS[ext] };
}

export function validateUploadIntent(body) {
  const kind = fileKind(body?.file_name);
  const size = body?.file_size;
  if (!Number.isSafeInteger(size) || size < 1) throw new AppError('invalid_file', 400);
  if (size > FILE_MAX_BYTES) throw new AppError('file_too_large', 400);
  return { ...kind, size };
}

export async function storageKeyFor(userId, ext) {
  return `resources/${await sha256Hex(userId)}/${crypto.randomUUID()}.${ext}`;
}

const KEY_PATTERN = /^resources\/[0-9a-f]{64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;

export async function assertOwnedKey(storageKey, userId) {
  if (typeof storageKey !== 'string' || !KEY_PATTERN.test(storageKey)) throw new AppError('invalid_file', 400);
  if (storageKey.split('/')[1] !== await sha256Hex(userId)) throw new AppError('file_forbidden', 403);
}