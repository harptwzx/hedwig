const CONFIG = {
  MAX_NORMAL_SIZE: 100 * 1024 * 1024,
  CHUNK_SIZE: 50 * 1024 * 1024,
  DEFAULT_EXPIRY: 10 * 60 * 1000,
  MAX_TOTAL_SIZE: 500 * 1024 * 1024,
  SUPER_USERS: ['hedwig', 'harptwzx'],
  RAW_BASE: 'https://raw.githubusercontent.com/harptwzx/hedwig/main',
};

class GitHubStorage {
  constructor(token) {
    this.token = token;
    this.apiBase = 'https://api.github.com/repos/harptwzx/hedwig';
    this.headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Hedwig-FileShare/1.0',
    };
  }

  encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  async apiRequest(path, options) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const resp = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });
    return resp;
  }

  // ========== FIX: 读取走 Raw CDN，零延迟 ==========
  async readRaw(path) {
    try {
      const encodedPath = this.encodePath(path);
      const url = `${CONFIG.RAW_BASE}/${encodedPath}?t=${Date.now()}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Hedwig-FileShare/1.0' },
        cf: { cacheTtl: 0 },
      });
      if (resp.status === 404) return { ok: false, status: 404, data: null };
      if (!resp.ok) {
        const text = await resp.text();
        return { ok: false, status: resp.status, error: text, data: null };
      }
      const text = await resp.text();
      try {
        return { ok: true, status: 200, data: JSON.parse(text) };
      } catch {
        return { ok: true, status: 200, data: text };
      }
    } catch (e) {
      return { ok: false, status: 500, error: e.message, data: null };
    }
  }

  // 保留 API 读取作为 fallback
  async getFile(path) {
    // 优先走 Raw CDN
    const raw = await this.readRaw(path);
    if (raw.ok) return raw;
    // Raw 失败时 fallback 到 API
    try {
      const encodedPath = this.encodePath(path);
      const resp = await this.apiRequest(`/contents/${encodedPath}`);
      if (resp.status === 404) return { ok: false, status: 404, data: null };
      if (!resp.ok) {
        const text = await resp.text();
        return { ok: false, status: resp.status, error: text, data: null };
      }
      const data = await resp.json();
      if (Array.isArray(data)) {
        return { ok: false, status: 400, error: 'path is directory', data: null };
      }
      if (data.content) {
        const cleanContent = data.content.replace(/\s/g, '');
        try {
          return { ok: true, status: 200, data: JSON.parse(atob(cleanContent)), raw: data };
        } catch {
          return { ok: true, status: 200, data: atob(cleanContent), raw: data };
        }
      }
      if (data.download_url) {
        const dlResp = await fetch(data.download_url, {
          headers: { 'User-Agent': 'Hedwig-FileShare/1.0' }
        });
        if (!dlResp.ok) {
          return { ok: false, status: dlResp.status, error: 'download_url failed', data: null };
        }
        const text = await dlResp.text();
        try {
          return { ok: true, status: 200, data: JSON.parse(text), raw: data };
        } catch {
          return { ok: true, status: 200, data: text, raw: data };
        }
      }
      return { ok: false, status: 500, error: 'no content or download_url', data: null };
    } catch (e) {
      return { ok: false, status: 500, error: e.message, data: null };
    }
  }

  async putFile(path, content, message) {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    const base64Content = btoa(contentStr);
    const encodedPath = this.encodePath(path);

    async function doPut(sha) {
      const body = {
        message: message || `Update ${path}`,
        content: base64Content,
        ...(sha ? { sha } : {}),
      };
      const resp = await this.apiRequest(`/contents/${encodedPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => 'unknown');
        return { ok: false, status: resp.status, error: text };
      }
      return { ok: true, status: resp.status };
    }

    let result = await doPut.call(this, null);
    if (!result.ok && result.status === 422) {
      const errorText = (result.error || '').toLowerCase();
      if (errorText.includes('sha') || errorText.includes("wasn't supplied")) {
        await new Promise(r => setTimeout(r, 2000));
        let sha = null;
        try {
          const checkResp = await this.apiRequest(`/contents/${encodedPath}`);
          if (checkResp.status === 200) {
            const checkData = await checkResp.json();
            sha = checkData.sha;
          }
        } catch (e) {}
        if (sha) {
          result = await doPut.call(this, sha);
        }
      }
    }
    return result;
  }

  async deleteFile(path, message) {
    const encodedPath = this.encodePath(path);
    let sha = null;
    try {
      const resp = await this.apiRequest(`/contents/${encodedPath}`);
      if (resp.status === 200) {
        const data = await resp.json();
        sha = data.sha;
      }
    } catch {}
    if (!sha) return { ok: true };
    const resp = await this.apiRequest(`/contents/${encodedPath}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || `Delete ${path}`,
        sha,
      }),
    });
    return { ok: resp.ok, status: resp.status };
  }

  async listDir(path) {
    try {
      const encodedPath = this.encodePath(path);
      const resp = await this.apiRequest(`/contents/${encodedPath}`);
      if (resp.status === 404) return [];
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
}

async function generateContentHash(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateRandomSuffix(length = 4) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateHash() {
  return generateRandomSuffix(8);
}

// ========== FIX: VIP 认证 - 从 data/users/hedwig.json 读取密钥 ==========
async function getVipKey(gh) {
  // 优先从 env 读取
  // 其次从 hedwig 用户数据读取 passwordHash
  const userData = await gh.readRaw('data/users/user_hedwig.json');
  if (userData.ok && userData.data && userData.data.passwordHash) {
    return userData.data.passwordHash;
  }
  return null;
}

async function signVipToken(fileId, secret) {
  const msg = new TextEncoder().encode(`hedwig:${fileId}:${Math.floor(Date.now() / 3600000)}`);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msg);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function verifyVipToken(fileId, token, secret) {
  const now = Math.floor(Date.now() / 3600000);
  for (let i = -1; i <= 1; i++) {
    const msg = new TextEncoder().encode(`hedwig:${fileId}:${now + i}`);
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    if (expected === token) return true;
  }
  return false;
}

async function getCurrentUser(request, gh) {
  const cookie = request.headers.get('Cookie') || '';
  const sessionMatch = cookie.match(/session_id=([^;]+)/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    try {
      const sessionData = await gh.readRaw(`data/sessions/${sessionId}.json`);
      if (sessionData.ok && sessionData.data && sessionData.data.expires > Date.now()) {
        const userData = await gh.readRaw(`data/users/user_${sessionData.data.username}.json`);
        if (userData.ok && userData.data) {
          return {
            username: userData.data.username,
            githubLogin: userData.data.githubLogin,
          };
        }
        return { username: sessionData.data.username };
      }
    } catch (e) {}
  }
  const hedwigMatch = cookie.match(/hedwig_session=([^;]+)/);
  if (hedwigMatch) {
    try {
      const sessionData = JSON.parse(atob(decodeURIComponent(hedwigMatch[1])));
      return sessionData.user || null;
    } catch {
      return null;
    }
  }
  return null;
}

function isSuperUser(user) {
  if (!user) return false;
  return CONFIG.SUPER_USERS.includes(user.username) || CONFIG.SUPER_USERS.includes(user.githubLogin);
}

async function getTotalSize(gh) {
  const files = await gh.listDir('data/files');
  let total = 0;
  for (const f of files) {
    if (f.type === 'file' && f.name.endsWith('.json')) {
      try {
        const meta = await gh.readRaw(`data/files/${f.name}`);
        if (meta.ok && meta.data && meta.data.size) total += meta.data.size;
      } catch {}
    }
  }
  return total;
}

async function cleanupExpired(gh) {
  const files = await gh.listDir('data/files');
  const now = Date.now();
  for (const f of files) {
    if (f.type === 'file' && f.name.endsWith('.json')) {
      try {
        const meta = await gh.readRaw(`data/files/${f.name}`);
        if (meta.ok && meta.data && meta.data.expiresAt && meta.data.expiresAt < now) {
          if (meta.data.chunks) {
            for (const chunk of meta.data.chunks) {
              await gh.deleteFile(`data/file_data/${chunk.path}`, 'Cleanup expired');
            }
          } else if (meta.data.path) {
            await gh.deleteFile(`data/file_data/${meta.data.path}`, 'Cleanup expired');
          }
          await gh.deleteFile(`data/files/${f.name}`, 'Cleanup expired');
        }
      } catch {}
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Custom-Url, X-Expiry-Minutes',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const gh = new GitHubStorage(env.GITHUB_TOKEN);
    const user = await getCurrentUser(request, gh);
    const superUser = isSuperUser(user);

    if (path === '/share' || path === '/share/') {
      if (request.method === 'POST') {
        return handleUpload(request, gh, user, superUser, env);
      }
      return new Response(SHARE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (path === '/share/upload' && request.method === 'POST') {
      return handleUpload(request, gh, user, superUser, env);
    }

    if (path === '/share/admin' && request.method === 'GET') {
      return handleAdmin(gh, user, superUser);
    }

    if (path.startsWith('/share/debug/') && request.method === 'GET') {
      const fileId = path.replace('/share/debug/', '');
      return handleDebug(fileId, gh);
    }

    if (path.startsWith('/share/')) {
      const fileId = path.replace('/share/', '');
      if (!fileId) {
        return new Response(SHARE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (request.method === 'GET') {
        return handleDownload(fileId, gh, env);
      }
      if (request.method === 'DELETE') {
        return handleDelete(fileId, gh, user);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleUpload(request, gh, user, superUser, env) {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: '请使用 multipart/form-data 上传' }, 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const customUrl = formData.get('customUrl') || '';
    const expiryMinutes = parseInt(formData.get('expiryMinutes') || '10');

    if (!file) {
      return jsonResponse({ error: '请选择文件' }, 400);
    }

    const fileName = file.name || 'unnamed';
    const fileSize = file.size || 0;
    const fileType = file.type || 'application/octet-stream';

    if (!superUser) {
      if (fileSize > CONFIG.MAX_NORMAL_SIZE) {
        return jsonResponse({ error: '文件过大，普通用户限制 ' + formatSize(CONFIG.MAX_NORMAL_SIZE) }, 413);
      }
    }

    const currentSize = await getTotalSize(gh);
    if (currentSize + fileSize > CONFIG.MAX_TOTAL_SIZE) {
      await cleanupExpired(gh);
      const newSize = await getTotalSize(gh);
      if (newSize + fileSize > CONFIG.MAX_TOTAL_SIZE) {
        return jsonResponse({ error: '服务器存储已满' }, 507);
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const expiresAt = Date.now() + (superUser ? expiryMinutes * 60 * 1000 : CONFIG.DEFAULT_EXPIRY);

    let fileId;
    if (superUser && customUrl.trim()) {
      const cleanUrl = customUrl.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(cleanUrl)) {
        return jsonResponse({ error: '自定义网址只能包含字母、数字、下划线和连字符' }, 400);
      }
      const existing = await gh.readRaw(`data/files/${cleanUrl}.json`);
      if (existing.ok && existing.data) {
        return jsonResponse({ error: '该自定义网址已被使用' }, 409);
      }
      fileId = cleanUrl;
    } else {
      const contentHash = (await generateContentHash(arrayBuffer)).slice(0, 10);
      fileId = contentHash;
      let collisionCheck = await gh.readRaw(`data/files/${fileId}.json`);
      let safety = 0;
      while (collisionCheck.ok && collisionCheck.data && safety < 20) {
        fileId = contentHash + generateRandomSuffix(4);
        collisionCheck = await gh.readRaw(`data/files/${fileId}.json`);
        safety++;
      }
    }

    const metadata = {
      id: fileId,
      name: fileName,
      size: fileSize,
      type: fileType,
      uploadedAt: Date.now(),
      expiresAt: expiresAt,
      uploadedBy: user ? user.username : 'anonymous',
      isSuperUser: superUser,
      chunks: [],
    };

    if (fileSize > CONFIG.CHUNK_SIZE && superUser) {
      const numChunks = Math.ceil(fileSize / CONFIG.CHUNK_SIZE);
      for (let i = 0; i < numChunks; i++) {
        const start = i * CONFIG.CHUNK_SIZE;
        const end = Math.min(start + CONFIG.CHUNK_SIZE, fileSize);
        const chunk = uint8Array.slice(start, end);
        const chunkPath = `data/file_data/${fileId}_chunk_${i}`;
        const chunkBase64 = arrayBufferToBase64(chunk.buffer);
        const putResult = await gh.putFile(chunkPath, chunkBase64, `Upload chunk ${i} of ${fileId}`);
        if (!putResult.ok) {
          for (let j = 0; j < i; j++) {
            await gh.deleteFile(`data/file_data/${fileId}_chunk_${j}`, 'Rollback');
          }
          return jsonResponse({ error: `分块 ${i} 上传失败: ${putResult.status} ${putResult.error || ''}` }, 500);
        }
        metadata.chunks.push({
          index: i,
          path: `${fileId}_chunk_${i}`,
          size: end - start,
        });
      }
    } else {
      const filePath = `data/file_data/${fileId}`;
      const base64Content = arrayBufferToBase64(arrayBuffer);
      const putResult = await gh.putFile(filePath, base64Content, `Upload file ${fileId}`);
      if (!putResult.ok) {
        return jsonResponse({ error: `文件数据上传失败: ${putResult.status} ${putResult.error || ''}` }, 500);
      }
      metadata.path = fileId;
    }

    const metaResult = await gh.putFile(`data/files/${fileId}.json`, metadata, `Create metadata for ${fileId}`);
    if (!metaResult.ok) {
      if (metadata.chunks) {
        for (const chunk of metadata.chunks) {
          await gh.deleteFile(`data/file_data/${chunk.path}`, 'Rollback metadata fail');
        }
      } else if (metadata.path) {
        await gh.deleteFile(`data/file_data/${metadata.path}`, 'Rollback metadata fail');
      }
      return jsonResponse({ error: `元数据写入失败: ${metaResult.status} ${metaResult.error || ''}` }, 500);
    }

    // ========== FIX: VIP 生成签名 token ==========
    let vipToken = null;
    if (superUser) {
      const vipKey = env.HEDWIG_VIP_KEY || await getVipKey(gh);
      if (vipKey) {
        vipToken = await signVipToken(fileId, vipKey);
      }
    }

    return jsonResponse({
      success: true,
      fileId: fileId,
      url: `https://hedwig.eu.org/share/${fileId}`,
      vipUrl: vipToken ? `https://hedwig.eu.org/share/${fileId}?vip=${vipToken}` : null,
      name: fileName,
      size: fileSize,
      sizeFormatted: formatSize(fileSize),
      expiresAt: expiresAt,
      expiresIn: superUser ? expiryMinutes + '分钟' : '10分钟',
      isChunked: metadata.chunks.length > 0,
      chunks: metadata.chunks.length,
    });

  } catch (error) {
    return jsonResponse({ error: '上传失败: ' + error.message }, 500);
  }
}

async function handleDownload(fileId, gh, env) {
  try {
    // ========== FIX: 读取走 Raw CDN，零延迟 ==========
    const metaResult = await gh.readRaw(`data/files/${fileId}.json`);

    if (!metaResult.ok) {
      // Raw 失败时 fallback 到 API
      const apiMeta = await gh.getFile(`data/files/${fileId}.json`);
      if (!apiMeta.ok || !apiMeta.data) {
        return new Response(
          JSON.stringify({ error: '文件不存在或已过期', debug: { fileId, rawStatus: metaResult.status, rawError: metaResult.error } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const metadata = metaResult.ok ? metaResult.data : (await gh.getFile(`data/files/${fileId}.json`)).data;

    if (metadata.expiresAt && metadata.expiresAt < Date.now()) {
      if (metadata.chunks) {
        for (const chunk of metadata.chunks) {
          await gh.deleteFile(`data/file_data/${chunk.path}`, 'Cleanup expired');
        }
      } else if (metadata.path) {
        await gh.deleteFile(`data/file_data/${metadata.path}`, 'Cleanup expired');
      }
      await gh.deleteFile(`data/files/${fileId}.json`, 'Cleanup expired');
      return new Response('文件已过期', { status: 410 });
    }

    // ========== FIX: VIP 校验 ==========
    const url = new URL(request.url);
    const vipParam = url.searchParams.get('vip');
    if (metadata.isSuperUser && vipParam) {
      const vipKey = env.HEDWIG_VIP_KEY || await getVipKey(gh);
      if (vipKey) {
        const isValid = await verifyVipToken(fileId, vipParam, vipKey);
        if (!isValid) {
          return new Response('VIP 令牌无效', { status: 403 });
        }
      }
    }

    let fileData;
    if (metadata.chunks && metadata.chunks.length > 0) {
      const chunks = [];
      for (const chunkInfo of metadata.chunks) {
        const chunkResult = await gh.readRaw(`data/file_data/${chunkInfo.path}`);
        if (!chunkResult.ok) {
          const apiChunk = await gh.getFile(`data/file_data/${chunkInfo.path}`);
          if (!apiChunk.ok || !apiChunk.data) {
            return new Response(
              JSON.stringify({ error: `分块 ${chunkInfo.index} 读取失败`, debug: { chunkPath: chunkInfo.path, rawStatus: chunkResult.status } }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }
          let chunkData = apiChunk.data;
          if (typeof chunkData === 'object' && chunkData.data) chunkData = chunkData.data;
          if (typeof chunkData === 'string') {
            chunks.push(base64ToArrayBuffer(chunkData));
          }
        } else {
          let chunkData = chunkResult.data;
          if (typeof chunkData === 'object' && chunkData.data) chunkData = chunkData.data;
          if (typeof chunkData === 'string') {
            chunks.push(base64ToArrayBuffer(chunkData));
          }
        }
      }
      const totalSize = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const merged = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      fileData = merged.buffer;
    } else {
      const fileResult = await gh.readRaw(`data/file_data/${metadata.path}`);
      if (!fileResult.ok) {
        const apiFile = await gh.getFile(`data/file_data/${metadata.path}`);
        if (!apiFile.ok || !apiFile.data) {
          return new Response(
            JSON.stringify({ error: '文件数据读取失败', debug: { filePath: metadata.path, rawStatus: fileResult.status } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }
        let base64Data = apiFile.data;
        if (typeof base64Data === 'object' && base64Data.data) base64Data = base64Data.data;
        if (typeof base64Data !== 'string') {
          return new Response(
            JSON.stringify({ error: '文件数据格式错误', debug: { type: typeof base64Data } }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
        fileData = base64ToArrayBuffer(base64Data);
      } else {
        let base64Data = fileResult.data;
        if (typeof base64Data === 'object' && base64Data.data) base64Data = base64Data.data;
        if (typeof base64Data !== 'string') {
          return new Response(
            JSON.stringify({ error: '文件数据格式错误', debug: { type: typeof base64Data } }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
        fileData = base64ToArrayBuffer(base64Data);
      }
    }

    return new Response(fileData, {
      status: 200,
      headers: {
        'Content-Type': metadata.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
        'Content-Length': String(fileData.byteLength),
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: '下载失败: ' + error.message, stack: error.stack }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handleDelete(fileId, gh, user) {
  try {
    const metaResult = await gh.readRaw(`data/files/${fileId}.json`);
    if (!metaResult.ok || !metaResult.data) {
      return jsonResponse({ error: '文件不存在' }, 404);
    }
    const metadata = metaResult.data;
    if (!user || (metadata.uploadedBy !== user.username && !isSuperUser(user))) {
      return jsonResponse({ error: '无权删除此文件' }, 403);
    }
    if (metadata.chunks) {
      for (const chunk of metadata.chunks) {
        await gh.deleteFile(`data/file_data/${chunk.path}`, 'User delete');
      }
    } else if (metadata.path) {
      await gh.deleteFile(`data/file_data/${metadata.path}`, 'User delete');
    }
    await gh.deleteFile(`data/files/${fileId}.json`, 'User delete');
    return jsonResponse({ success: true, message: '文件已删除' });
  } catch (error) {
    return jsonResponse({ error: '删除失败: ' + error.message }, 500);
  }
}

async function handleDebug(fileId, gh) {
  const metaResult = await gh.readRaw(`data/files/${fileId}.json`);
  const fileResult = metaResult.ok && metaResult.data 
    ? await gh.readRaw(`data/file_data/${metaResult.data.path || fileId}`)
    : { ok: false, error: 'metadata not found' };

  return jsonResponse({
    fileId,
    metadata: metaResult,
    fileData: fileResult,
    timestamp: Date.now(),
  });
}

async function handleAdmin(gh, user, superUser) {
  if (!superUser) {
    return new Response('无权访问', { status: 403 });
  }
  try {
    const files = await gh.listDir('data/files');
    const fileList = [];
    let totalSize = 0;
    for (const f of files) {
      if (f.type === 'file' && f.name.endsWith('.json')) {
        const meta = await gh.readRaw(`data/files/${f.name}`);
        if (meta.ok && meta.data) {
          totalSize += meta.data.size || 0;
          fileList.push({
            id: meta.data.id,
            name: meta.data.name,
            size: formatSize(meta.data.size || 0),
            uploadedBy: meta.data.uploadedBy,
            uploadedAt: new Date(meta.data.uploadedAt).toLocaleString('zh-CN'),
            expiresAt: new Date(meta.data.expiresAt).toLocaleString('zh-CN'),
            isExpired: meta.data.expiresAt < Date.now(),
            isChunked: (meta.data.chunks || []).length > 0,
          });
        }
      }
    }

    let html = ADMIN_HTML;
    html = html.replace(/\{\{fileCount\}\}/g, String(fileList.length));
    html = html.replace(/\{\{totalSize\}\}/g, formatSize(totalSize));
    html = html.replace(/\{\{maxSize\}\}/g, formatSize(CONFIG.MAX_TOTAL_SIZE));
    html = html.replace(/\{\{usagePercent\}\}/g, String(Math.round((totalSize / CONFIG.MAX_TOTAL_SIZE) * 100)));
    html = html.replace('"{{fileList}}"', JSON.stringify(fileList));

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    return new Response('加载失败: ' + error.message, { status: 500 });
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const SHARE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>文件分享 - Hedwig</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  min-height: 100vh;
  color: #e0e0e0;
}
.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 20px;
}
.header {
  text-align: center;
  margin-bottom: 40px;
}
.header h1 {
  font-size: 2.5rem;
  background: linear-gradient(90deg, #00d4ff, #7b2cbf);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 10px;
}
.header p {
  color: #888;
}
.upload-area {
  border: 2px dashed #444;
  border-radius: 16px;
  padding: 60px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
  background: rgba(255,255,255,0.02);
}
.upload-area:hover, .upload-area.dragover {
  border-color: #00d4ff;
  background: rgba(0,212,255,0.05);
}
.upload-area .icon {
  font-size: 3rem;
  margin-bottom: 16px;
}
.upload-area p {
  color: #888;
  margin-bottom: 8px;
}
.upload-area .hint {
  font-size: 0.85rem;
  color: #666;
}
.file-input {
  display: none;
}
.progress-bar {
  width: 100%;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
  margin: 20px 0;
  display: none;
}
.progress-bar .progress {
  height: 100%;
  background: linear-gradient(90deg, #00d4ff, #7b2cbf);
  width: 0%;
  transition: width 0.3s;
}
.result {
  display: none;
  background: rgba(0,212,255,0.1);
  border: 1px solid #00d4ff;
  border-radius: 12px;
  padding: 24px;
  margin-top: 20px;
}
.result.show { display: block; }
.result h3 {
  color: #00d4ff;
  margin-bottom: 16px;
}
.result .link-box {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.result .link-box input {
  flex: 1;
  padding: 12px;
  border: 1px solid #444;
  border-radius: 8px;
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: monospace;
}
.result .link-box button {
  padding: 12px 20px;
  border: none;
  border-radius: 8px;
  background: #00d4ff;
  color: #1a1a2e;
  cursor: pointer;
  font-weight: bold;
}
.result .info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  font-size: 0.9rem;
  color: #aaa;
}
.result .info span {
  color: #e0e0e0;
}
.admin-link {
  text-align: center;
  margin-top: 30px;
}
.admin-link a {
  color: #00d4ff;
  text-decoration: none;
}
.admin-link a:hover {
  text-decoration: underline;
}
.super-options {
  display: none;
  margin-top: 20px;
  padding: 20px;
  background: rgba(123,44,191,0.1);
  border: 1px solid #7b2cbf;
  border-radius: 12px;
}
.super-options.show { display: block; }
.super-options h3 {
  color: #7b2cbf;
  margin-bottom: 12px;
}
.super-options label {
  display: block;
  margin-bottom: 8px;
  color: #aaa;
}
.super-options input {
  width: 100%;
  padding: 10px;
  border: 1px solid #444;
  border-radius: 8px;
  background: #1a1a2e;
  color: #e0e0e0;
  margin-bottom: 12px;
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📁 Hedwig 文件分享</h1>
    <p>简单、快速的临时文件分享服务</p>
  </div>
  <div class="upload-area" id="uploadArea">
    <div class="icon">📁</div>
    <p>点击或拖拽文件到此处上传</p>
    <p class="hint">普通用户: 最大 100MB，保存 10 分钟</p>
  </div>
  <input type="file" class="file-input" id="fileInput">
  <div class="progress-bar" id="progressBar">
    <div class="progress" id="progress"></div>
  </div>
  <div class="super-options" id="superOptions">
    <h3>🌟 超级会员选项</h3>
    <label>自定义链接 (可选)</label>
    <input type="text" id="customUrl" placeholder="例如: myfile">
    <label>有效期 (分钟)</label>
    <input type="number" id="expiryMinutes" value="10" min="1" max="1440">
  </div>
  <div class="result" id="result">
    <h3>✅ 上传成功！</h3>
    <div class="link-box">
      <input type="text" id="shareLink" readonly>
      <button onclick="copyLink()">复制</button>
    </div>
    <div class="info">
      <div>文件名: <span id="fileName"></span></div>
      <div>文件大小: <span id="fileSize"></span></div>
      <div>有效期: <span id="fileExpiry"></span></div>
      <div>分块: <span id="fileChunks"></span></div>
    </div>
    <div id="vipSection" style="display:none;margin-top:12px;padding:12px;background:rgba(123,44,191,0.1);border:1px solid #7b2cbf;border-radius:8px;">
      <div style="color:#7b2cbf;font-weight:bold;margin-bottom:8px;">🌟 VIP 直链（防缓存延迟）</div>
      <div class="link-box">
        <input type="text" id="vipLink" readonly>
        <button onclick="copyVipLink()">复制</button>
      </div>
    </div>
    <div style="margin-top:12px;font-size:0.8rem;color:#888;">
      调试: <a id="debugLink" href="#" target="_blank" style="color:#00d4ff;">查看文件状态</a>
    </div>
  </div>
  <div class="admin-link">
    <a href="/share/admin">📊 管理后台</a>
  </div>
</div>
<script>
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const progressBar = document.getElementById('progressBar');
const progress = document.getElementById('progress');
const result = document.getElementById('result');
const superOptions = document.getElementById('superOptions');
let isSuperUser = false;

async function checkUser() {
  try {
    const res = await fetch('/api/current-user');
    const data = await res.json();
    if (data.user) {
      isSuperUser = ['hedwig', 'harptwzx'].includes(data.user.username);
      if (isSuperUser) superOptions.classList.add('show');
    }
  } catch (e) {}
}
checkUser();

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) uploadFile(files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) uploadFile(e.target.files[0]);
});

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  if (isSuperUser) {
    const customUrl = document.getElementById('customUrl').value;
    const expiryMinutes = document.getElementById('expiryMinutes').value;
    if (customUrl) formData.append('customUrl', customUrl);
    formData.append('expiryMinutes', expiryMinutes);
  }

  progressBar.style.display = 'block';
  progress.style.width = '30%';

  try {
    const res = await fetch('/share/upload', {
      method: 'POST',
      body: formData,
    });
    progress.style.width = '80%';
    const data = await res.json();
    progress.style.width = '100%';

    if (data.success) {
      document.getElementById('shareLink').value = data.url;
      document.getElementById('fileName').textContent = data.name;
      document.getElementById('fileSize').textContent = data.sizeFormatted;
      document.getElementById('fileExpiry').textContent = data.expiresIn;
      document.getElementById('fileChunks').textContent = data.isChunked ? data.chunks + ' 块' : '否';
      document.getElementById('debugLink').href = data.url.replace('/share/', '/share/debug/');
      if (data.vipUrl) {
        document.getElementById('vipLink').value = data.vipUrl;
        document.getElementById('vipSection').style.display = 'block';
      }
      result.classList.add('show');
    } else {
      alert(data.error || '上传失败');
    }
  } catch (error) {
    alert('上传失败: ' + error.message);
  } finally {
    setTimeout(() => {
      progressBar.style.display = 'none';
      progress.style.width = '0%';
    }, 1000);
  }
}

function copyLink() {
  const link = document.getElementById('shareLink');
  link.select();
  document.execCommand('copy');
  alert('链接已复制！');
}
function copyVipLink() {
  const link = document.getElementById('vipLink');
  link.select();
  document.execCommand('copy');
  alert('VIP 链接已复制！');
}
</script>
</body>
</html>
`;

const ADMIN_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>文件管理 - Hedwig</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  min-height: 100vh;
  color: #e0e0e0;
}
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 20px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40px;
}
.header h1 {
  font-size: 2rem;
  background: linear-gradient(90deg, #00d4ff, #7b2cbf);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.header a {
  color: #00d4ff;
  text-decoration: none;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 40px;
}
.stat-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid #333;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}
.stat-card .number {
  font-size: 2rem;
  font-weight: bold;
  color: #00d4ff;
}
.stat-card .label {
  color: #888;
  margin-top: 8px;
}
.file-list {
  background: rgba(255,255,255,0.02);
  border: 1px solid #333;
  border-radius: 12px;
  overflow: hidden;
}
.file-list table {
  width: 100%;
  border-collapse: collapse;
}
.file-list th, .file-list td {
  padding: 16px;
  text-align: left;
  border-bottom: 1px solid #333;
}
.file-list th {
  background: rgba(0,212,255,0.1);
  color: #00d4ff;
  font-weight: 600;
}
.file-list tr:hover {
  background: rgba(255,255,255,0.03);
}
.file-list .expired {
  color: #ff4444;
}
.file-list .actions button {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: #ff4444;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
}
.file-list .actions button:hover {
  background: #ff6666;
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📊 文件管理后台</h1>
    <a href="/share">← 返回上传页面</a>
  </div>
  <div class="stats">
    <div class="stat-card">
      <div class="number">{{fileCount}}</div>
      <div class="label">文件总数</div>
    </div>
    <div class="stat-card">
      <div class="number">{{totalSize}}</div>
      <div class="label">已用空间</div>
    </div>
    <div class="stat-card">
      <div class="number">{{maxSize}}</div>
      <div class="label">总容量</div>
    </div>
    <div class="stat-card">
      <div class="number">{{usagePercent}}%</div>
      <div class="label">使用率</div>
    </div>
  </div>
  <div class="file-list">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>文件名</th>
          <th>大小</th>
          <th>上传者</th>
          <th>上传时间</th>
          <th>过期时间</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="fileTableBody"></tbody>
    </table>
  </div>
</div>
<script>
const fileList = {{fileList}};
const tbody = document.getElementById('fileTableBody');
fileList.forEach(file => {
  const tr = document.createElement('tr');
  if (file.isExpired) tr.classList.add('expired');
  tr.innerHTML = \`
    <td>\${file.id}</td>
    <td>\${file.name}</td>
    <td>\${file.size}</td>
    <td>\${file.uploadedBy}</td>
    <td>\${file.uploadedAt}</td>
    <td>\${file.expiresAt}</td>
    <td>\${file.isExpired ? '<span class="expired">已过期</span>' : '有效'}</td>
    <td class="actions">
      <button onclick="deleteFile('\${file.id}')">删除</button>
    </td>
  \`;
  tbody.appendChild(tr);
});

async function deleteFile(id) {
  if (!confirm('确定要删除这个文件吗？')) return;
  try {
    const res = await fetch(\`/share/\${id}\`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      location.reload();
    } else {
      alert(data.error || '删除失败');
    }
  } catch (e) {
    alert('删除失败');
  }
}
</script>
</body>
</html>
`;