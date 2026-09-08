/**
 * Validates a source reference without doing any IO.  Local references are
 * deliberately kept in the portable package namespace; callers that need a
 * URL must opt in to an explicit HTTP(S) URL.
 */
export type ResourceReferenceStage = 'intent' | 'compile' | 'contract';

export class ResourceReferenceError extends Error {
  readonly path: string;
  readonly stage: ResourceReferenceStage;
  readonly code: string;

  constructor(stage: ResourceReferenceStage, path: string, code: string, message: string) {
    super(`${stage}: ${path}: ${message}`);
    this.name = 'ResourceReferenceError';
    this.path = path;
    this.stage = stage;
    this.code = code;
  }
}

function invalid(stage: ResourceReferenceStage, path: string, code: string, message: string): never {
  throw new ResourceReferenceError(stage, path, code, message);
}

/**
 * Return an unchanged, portable resource reference or throw a structured
 * error.  This never normalizes a path: a bundle must store precisely the
 * reference its document declares.
 */
export function validateResourceReference(
  source: string,
  path: string,
  stage: ResourceReferenceStage,
): string {
  if (typeof source !== 'string' || source.length === 0 || source.trim() !== source) {
    return invalid(stage, path, 'SOURCE_REQUIRED', '资源引用必须为非空且无首尾空白的字符串');
  }
  if (/[\x00-\x1F\x7F]/.test(source)) {
    return invalid(stage, path, 'UNSAFE_SOURCE', '资源引用不能包含控制字符');
  }

  if (/^https?:\/\//i.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      return invalid(stage, path, 'INVALID_HTTP_URL', 'HTTP(S) 资源地址无效');
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return invalid(stage, path, 'UNSUPPORTED_SCHEME', '仅支持完整的 HTTP(S) 图片地址');
    }
    if (url.username || url.password) {
      return invalid(stage, path, 'CREDENTIALS_FORBIDDEN', '资源地址不能包含凭据');
    }
    return source;
  }

  if (source.startsWith('/') || source.startsWith('\\') || /^[a-z]:/i.test(source)) {
    return invalid(stage, path, 'ABSOLUTE_PATH_FORBIDDEN', '资源引用必须是相对可移植路径');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    return invalid(stage, path, 'UNSUPPORTED_SCHEME', '仅支持相对路径或 HTTP(S) 图片地址');
  }
  if (source.includes('\\')) {
    return invalid(stage, path, 'BACKSLASH_FORBIDDEN', '资源路径必须使用正斜杠');
  }
  if (/[?#]/.test(source)) {
    return invalid(stage, path, 'QUERY_OR_FRAGMENT_FORBIDDEN', '相对资源路径不能包含查询或片段');
  }
  if (source.includes('%')) {
    return invalid(stage, path, 'ENCODED_ESCAPE_FORBIDDEN', '资源路径不能包含编码转义');
  }
  if (source.endsWith('/') || source.includes('//')) {
    return invalid(stage, path, 'INVALID_PORTABLE_PATH', '资源路径必须指向单个文件');
  }

  const parts = source.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '..') {
      return invalid(stage, path, 'PATH_TRAVERSAL_FORBIDDEN', '资源路径不能包含上级目录');
    }
    if (part === '.' && index !== 0) {
      return invalid(stage, path, 'INVALID_PORTABLE_PATH', '资源路径不能包含中间当前目录');
    }
    if (part === '.' && index === 0) continue;
    if (part.length === 0) {
      return invalid(stage, path, 'INVALID_PORTABLE_PATH', '资源路径不能包含空目录段');
    }
    if (/[:*<>"|]/.test(part)) {
      return invalid(stage, path, 'WINDOWS_FORBIDDEN_CHARACTER', '资源路径包含 Windows 不支持的字符');
    }
    const firstDot = part.indexOf('.');
    const windowsStem = (firstDot === -1 ? part : part.slice(0, firstDot)).replace(/[. ]+$/, '');
    if (/[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(windowsStem)) {
      return invalid(stage, path, 'WINDOWS_RESERVED_PATH', '资源路径包含 Windows 保留名称或结尾字符');
    }
  }
  if (parts.length === 1 && parts[0] === '.') {
    return invalid(stage, path, 'INVALID_PORTABLE_PATH', '资源路径必须指向文件');
  }
  return source;
}
