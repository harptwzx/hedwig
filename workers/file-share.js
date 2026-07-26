/**
 * Hedwig File Share System v2.1 - Fixed
 * - Compatible with api.js user system
 * - Normal users: 10min expiry, SHA-256 hash link, <=100MB
 * - Super user (hedwig): custom slug/ttl, auto-chunking for large files
 * - Total capacity: 500MB
 */

const CONFIG = {
  OWNER: 'harptwzx',
  REPO: 'hedwig',
  BRANCH: 'main',
  BASE_PATH: 'data/files',
  META_PATH: 'data/meta/files.json',
  USERS_PATH: 'data/users/',
  SESSIONS_PATH: 'data/sessions/',
  CHUNK_SIZE: 50 * 1024 * 1024,
  MAX_NORMAL_SIZE: 100 * 1024 * 1024,
  TOTAL_CAPACITY: 500 * 1024 * 1024,
  DEFAULT_TTL: 10 * 60 * 1000,
  SUPER_USER: 'hedwig',
};

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binString);
}

function base64Decode(str) {
  const binString = atob(str);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function readGitHubFile(filePath, token) {
  const url = 'https://api.github.com/repos/' + CONFIG.OWNER + '/' + CONFIG.REPO + '/contents/' + filePath;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'Hedwig-Worker'
      }
    });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const data = await response.json();
    const content = base64Decode(data.content);
    return { content: JSON.parse(content), sha: data.sha };
  } catch (error) {
    return null;
  }
}

async function writeGitHubFile(filePath, content, commitMessage, token, existingSha) {
  const url = 'https://api.github.com/repos/' + CONFIG.OWNER + '/' + CONFIG.REPO + '/contents/' + filePath;
  try {
    let sha = existingSha;
    if (!sha) {
      const checkResponse = await fetch(url, {
        headers: {
          'Authorization': 'token ' + token,
          'User-Agent': 'Hedwig-Worker'
        }
      });
      if (checkResponse.ok) {
        const existingData = await checkResponse.json();
        sha = existingData.sha;
      }
    }
    const contentString = JSON.stringify(content, null, 2);
    const encodedContent = base64Encode(contentString);
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'Hedwig-Worker'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: encodedContent,
        sha: sha
      })
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function deleteGitHubFile(filePath, token) {
  const url = 'https://api.github.com/repos/' + CONFIG.OWNER + '/' + CONFIG.REPO + '/contents/' + filePath;
  try {
    const checkResponse = await fetch(url, {
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'Hedwig-Worker'
      }
    });
    if (!checkResponse.ok) return false;
    const existingData = await checkResponse.json();
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': 'token ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'Hedwig-Worker'
      },
      body: JSON.stringify({
        message: 'Delete: ' + filePath,
        sha: existingData.sha
      })
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function getSession(env, sessionId) {
  const filePath = CONFIG.SESSIONS_PATH + sessionId + '.json';
  const result = await readGitHubFile(filePath, env.GITHUB_TOKEN);
  if (!result) return null;
  const session = result.content;
  if (session.expires < Date.now()) {
    await deleteGitHubFile(filePath, env.GITHUB_TOKEN);
    return null;
  }
  return { session: session, sha: result.sha };
}

function getSessionId(request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/session_id=([^;]+)/);
  return match ? match[1] : null;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === '/share' && request.method === 'GET') {
        return new Response(getFrontendHTML(), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders() }
        });
      }

      if (path === '/api/file/upload' && request.method === 'POST') {
        return await handleUpload(request, env);
      }

      if (path === '/api/file/download' && request.method === 'GET') {
        return await handleDownload(request, env);
      }

      if (path === '/api/file/info' && request.method === 'GET') {
        return await handleInfo(request, env);
      }

      if (path === '/api/file/delete' && request.method === 'DELETE') {
        return await handleDelete(request, env);
      }

      if (path === '/api/file/cleanup' && request.method === 'POST') {
        return await handleCleanup(request, env);
      }

      if (path === '/api/file/merge' && request.method === 'POST') {
        return await handleMerge(request, env);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }
  }
};

async function handleUpload(request, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const sessionId = getSessionId(request);
  let currentUser = null;
  let isSuper = false;

  if (sessionId) {
    const sessionResult = await getSession(env, sessionId);
    if (sessionResult) {
      currentUser = sessionResult.session.username;
      if (currentUser === CONFIG.SUPER_USER) {
        isSuper = true;
      }
    }
  }

  const contentType = request.headers.get('Content-Type') || '';
  let fileData, filename, customSlug, customTtl;

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    fileData = formData.get('file');
    filename = fileData.name;
    customSlug = formData.get('slug') || '';
    customTtl = parseInt(formData.get('ttl')) || 0;
  } else if (contentType.includes('application/json')) {
    const json = await request.json();
    const binary = atob(json.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    fileData = {
      arrayBuffer: () => Promise.resolve(bytes.buffer),
      size: json.size,
      type: json.mimeType || 'application/octet-stream'
    };
    filename = json.filename;
    customSlug = json.slug || '';
    customTtl = json.ttl || 0;
  } else {
    throw new Error('Unsupported Content-Type');
  }

  if (!fileData || !filename) {
    throw new Error('No file provided');
  }

  const fileBuffer = await fileData.arrayBuffer();
  const fileSize = fileBuffer.byteLength;

  if (!isSuper) {
    if (fileSize > CONFIG.MAX_NORMAL_SIZE) {
      throw new Error('File too large. Max ' + (CONFIG.MAX_NORMAL_SIZE / 1024 / 1024) + 'MB for normal users');
    }
  }

  const meta = await getMeta(token);
  const totalUsed = calculateTotalSize(meta);
  if (totalUsed + fileSize > CONFIG.TOTAL_CAPACITY) {
    await cleanupExpired(token, meta);
    const newTotal = calculateTotalSize(await getMeta(token));
    if (newTotal + fileSize > CONFIG.TOTAL_CAPACITY) {
      throw new Error('Server capacity full');
    }
  }

  const now = Date.now();
  const ttl = isSuper && customTtl > 0 ? customTtl * 1000 : CONFIG.DEFAULT_TTL;
  const expiresAt = now + ttl;

  let fileId;
  if (isSuper && customSlug) {
    fileId = sanitizeSlug(customSlug);
    if (meta[fileId]) {
      throw new Error('Custom slug already exists');
    }
  } else {
    fileId = await generateHash(fileBuffer, filename);
  }

  const needsChunking = isSuper && fileSize > CONFIG.CHUNK_SIZE;
  let chunks = [];

  if (needsChunking) {
    const totalChunks = Math.ceil(fileSize / CONFIG.CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CONFIG.CHUNK_SIZE;
      const end = Math.min(start + CONFIG.CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.slice(start, end);
      const chunkId = fileId + '_part' + i;
      await uploadToGitHub(token, CONFIG.BASE_PATH + '/' + chunkId, chunkBuffer);
      chunks.push({ index: i, id: chunkId, size: end - start });
    }
  } else {
    await uploadToGitHub(token, CONFIG.BASE_PATH + '/' + fileId, fileBuffer);
  }

  const fileMeta = {
    id: fileId,
    filename: filename,
    size: fileSize,
    mimeType: fileData.type || 'application/octet-stream',
    createdAt: now,
    expiresAt: expiresAt,
    owner: currentUser || 'anonymous',
    isSuper: isSuper,
    chunks: needsChunking ? chunks : null,
    chunkCount: needsChunking ? chunks.length : 1,
    downloads: 0
  };

  meta[fileId] = fileMeta;
  await saveMeta(token, meta);

  const host = new URL(request.url).origin;
  const downloadUrl = host + '/api/file/download?id=' + fileId;

  return new Response(JSON.stringify({
    success: true,
    fileId: fileId,
    downloadUrl: downloadUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    isSuper: isSuper,
    chunked: needsChunking,
    chunkCount: needsChunking ? chunks.length : 1,
    size: fileSize,
    owner: currentUser || 'anonymous'
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function handleDownload(request, env) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  const chunkIndex = url.searchParams.get('chunk');

  if (!fileId) throw new Error('File ID required');

  const token = env.GITHUB_TOKEN;
  const meta = await getMeta(token);
  const fileMeta = meta[fileId];

  if (!fileMeta) throw new Error('File not found or expired');

  if (Date.now() > fileMeta.expiresAt) {
    throw new Error('File expired');
  }

  fileMeta.downloads++;
  await saveMeta(token, meta);

  if (fileMeta.chunks && fileMeta.chunks.length > 0) {
    if (chunkIndex !== null) {
      const idx = parseInt(chunkIndex);
      if (idx < 0 || idx >= fileMeta.chunks.length) {
        throw new Error('Invalid chunk index');
      }
      const chunk = fileMeta.chunks[idx];
      const data = await downloadFromGitHub(token, CONFIG.BASE_PATH + '/' + chunk.id);
      return new Response(data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="' + fileMeta.filename + '.part' + idx + '"',
          'X-Chunk-Index': idx,
          'X-Total-Chunks': fileMeta.chunks.length,
          ...corsHeaders()
        }
      });
    } else {
      return new Response(JSON.stringify({
        chunked: true,
        chunks: fileMeta.chunks,
        filename: fileMeta.filename,
        totalSize: fileMeta.size,
        mimeType: fileMeta.mimeType
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }
  }

  const data = await downloadFromGitHub(token, CONFIG.BASE_PATH + '/' + fileId);
  return new Response(data, {
    headers: {
      'Content-Type': fileMeta.mimeType,
      'Content-Disposition': 'attachment; filename="' + fileMeta.filename + '"',
      'Content-Length': fileMeta.size,
      ...corsHeaders()
    }
  });
}

async function handleMerge(request, env) {
  const token = env.GITHUB_TOKEN;
  const body = await request.json();
  const fileId = body.fileId;

  if (!fileId) throw new Error('File ID required');

  const meta = await getMeta(token);
  const fileMeta = meta[fileId];

  if (!fileMeta || !fileMeta.chunks) {
    throw new Error('File not found or not chunked');
  }

  if (Date.now() > fileMeta.expiresAt) {
    throw new Error('File expired');
  }

  const chunks = [];
  for (let i = 0; i < fileMeta.chunks.length; i++) {
    const data = await downloadFromGitHub(token, CONFIG.BASE_PATH + '/' + fileMeta.chunks[i].id);
    chunks.push(new Uint8Array(data));
  }

  const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i], offset);
    offset += chunks[i].length;
  }

  return new Response(merged.buffer, {
    headers: {
      'Content-Type': fileMeta.mimeType,
      'Content-Disposition': 'attachment; filename="' + fileMeta.filename + '"',
      'Content-Length': totalSize,
      ...corsHeaders()
    }
  });
}

async function handleInfo(request, env) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  const token = env.GITHUB_TOKEN;

  const meta = await getMeta(token);

  if (fileId) {
    const fileMeta = meta[fileId];
    if (!fileMeta) throw new Error('File not found');
    return new Response(JSON.stringify(fileMeta), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const totalFiles = Object.keys(meta).length;
  const totalSize = calculateTotalSize(meta);
  const expiredFiles = Object.values(meta).filter(f => f.expiresAt < Date.now()).length;

  return new Response(JSON.stringify({
    totalFiles: totalFiles,
    totalSize: totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    expiredFiles: expiredFiles,
    capacity: CONFIG.TOTAL_CAPACITY,
    capacityFormatted: formatBytes(CONFIG.TOTAL_CAPACITY),
    usagePercent: ((totalSize / CONFIG.TOTAL_CAPACITY) * 100).toFixed(2)
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function handleDelete(request, env) {
  const token = env.GITHUB_TOKEN;
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');

  if (!fileId) throw new Error('File ID required');

  const sessionId = getSessionId(request);
  let currentUser = null;
  let isSuper = false;

  if (sessionId) {
    const sessionResult = await getSession(env, sessionId);
    if (sessionResult) {
      currentUser = sessionResult.session.username;
      if (currentUser === CONFIG.SUPER_USER) isSuper = true;
    }
  }

  const meta = await getMeta(token);
  const fileMeta = meta[fileId];

  if (!fileMeta) throw new Error('File not found');

  if (!isSuper && fileMeta.owner !== currentUser) {
    throw new Error('Forbidden');
  }

  await deleteFile(token, fileId, fileMeta);
  delete meta[fileId];
  await saveMeta(token, meta);

  return new Response(JSON.stringify({ success: true, message: 'File deleted' }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function handleCleanup(request, env) {
  const token = env.GITHUB_TOKEN;
  const meta = await getMeta(token);
  const cleaned = await cleanupExpired(token, meta);

  return new Response(JSON.stringify({
    success: true,
    cleaned: cleaned.length,
    files: cleaned
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function getMeta(token) {
  try {
    const result = await readGitHubFile(CONFIG.META_PATH, token);
    if (!result) return {};
    return result.content;
  } catch (e) {
    return {};
  }
}

async function saveMeta(token, meta) {
  const result = await readGitHubFile(CONFIG.META_PATH, token);
  const sha = result ? result.sha : undefined;
  const success = await writeGitHubFile(
    CONFIG.META_PATH,
    meta,
    'Update file meta ' + new Date().toISOString(),
    token,
    sha
  );
  if (!success) throw new Error('Failed to save meta');
}

async function uploadToGitHub(token, path, buffer) {
  const base64 = arrayBufferToBase64(buffer);
  const result = await readGitHubFile(path, token);
  const sha = result ? result.sha : undefined;

  const fileObj = {
    content: base64,
    encoded: true,
    uploadedAt: Date.now()
  };

  const success = await writeGitHubFile(
    path,
    fileObj,
    'Upload file ' + path + ' ' + new Date().toISOString(),
    token,
    sha
  );

  if (!success) throw new Error('Upload failed: ' + path);
}

async function downloadFromGitHub(token, path) {
  const result = await readGitHubFile(path, token);
  if (!result) throw new Error('File not found on GitHub');

  const data = result.content;
  if (data.encoded && data.content) {
    const binary = atob(data.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  throw new Error('Invalid file format');
}

async function generateHash(buffer, filename) {
  const data = new Uint8Array(buffer);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16);
}

function sanitizeSlug(slug) {
  return slug.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64);
}

function calculateTotalSize(meta) {
  return Object.values(meta).reduce((sum, f) => sum + (f.size || 0), 0);
}

async function cleanupExpired(token, meta) {
  const now = Date.now();
  const expired = [];

  for (const id in meta) {
    if (meta[id].expiresAt < now) {
      await deleteFile(token, id, meta[id]);
      expired.push(id);
      delete meta[id];
    }
  }

  if (expired.length > 0) {
    await saveMeta(token, meta);
  }

  return expired;
}

async function deleteFile(token, fileId, fileMeta) {
  if (fileMeta.chunks) {
    for (let i = 0; i < fileMeta.chunks.length; i++) {
      await deleteGitHubFile(CONFIG.BASE_PATH + '/' + fileMeta.chunks[i].id, token);
    }
  } else {
    await deleteGitHubFile(CONFIG.BASE_PATH + '/' + fileId, token);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFrontendHTML() {
  return '<!DOCTYPE html>' +
'<html lang="zh-CN">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <title>Hedwig File Share</title>' +
'  <style>' +
'    * { margin: 0; padding: 0; box-sizing: border-box; }' +
'    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #eee; display: flex; justify-content: center; align-items: center; padding: 20px; }' +
'    .container { background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border-radius: 20px; padding: 40px; max-width: 700px; width: 100%; border: 1px solid rgba(255,255,255,0.1); }' +
'    h1 { text-align: center; margin-bottom: 10px; font-size: 2em; background: linear-gradient(45deg, #00d4ff, #7b2ff7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }' +
'    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }' +
'    .user-info { text-align: center; margin-bottom: 20px; padding: 10px; background: rgba(0,212,255,0.1); border-radius: 10px; display: none; }' +
'    .user-info.active { display: block; }' +
'    .super-badge { display: inline-block; background: linear-gradient(45deg, #f093fb, #f5576c); padding: 2px 10px; border-radius: 20px; font-size: 0.8em; margin-left: 10px; }' +
'    .upload-area { border: 2px dashed rgba(255,255,255,0.2); border-radius: 15px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.3s; margin-bottom: 20px; }' +
'    .upload-area:hover, .upload-area.dragover { border-color: #00d4ff; background: rgba(0,212,255,0.05); }' +
'    .file-input { display: none; }' +
'    .options { display: none; margin-bottom: 20px; }' +
'    .options.active { display: block; }' +
'    .input-group { margin-bottom: 15px; }' +
'    .input-group label { display: block; margin-bottom: 5px; color: #aaa; font-size: 0.9em; }' +
'    .input-group input, .input-group select { width: 100%; padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; background: rgba(0,0,0,0.2); color: #fff; font-size: 1em; }' +
'    .input-group input:focus { outline: none; border-color: #00d4ff; }' +
'    .btn { width: 100%; padding: 15px; border: none; border-radius: 10px; background: linear-gradient(45deg, #00d4ff, #7b2ff7); color: #fff; font-size: 1.1em; cursor: pointer; transition: transform 0.2s; margin-top: 10px; }' +
'    .btn:hover { transform: translateY(-2px); }' +
'    .btn:disabled { opacity: 0.5; cursor: not-allowed; }' +
'    .result { margin-top: 20px; padding: 20px; background: rgba(0,255,0,0.05); border: 1px solid rgba(0,255,0,0.2); border-radius: 10px; display: none; }' +
'    .result.active { display: block; }' +
'    .result.error { background: rgba(255,0,0,0.05); border-color: rgba(255,0,0,0.2); }' +
'    .link-box { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; word-break: break-all; margin: 10px 0; font-family: monospace; cursor: pointer; user-select: all; }' +
'    .stats { margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.9em; color: #888; }' +
'    .progress-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 10px; overflow: hidden; }' +
'    .progress-fill { height: 100%; background: linear-gradient(45deg, #00d4ff, #7b2ff7); transition: width 0.3s; }' +
'    .chunk-info { margin-top: 10px; font-size: 0.85em; color: #aaa; }' +
'    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }' +
'    .tab { flex: 1; padding: 10px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; transition: all 0.3s; }' +
'    .tab.active { background: rgba(0,212,255,0.2); border: 1px solid rgba(0,212,255,0.3); }' +
'    .tab-content { display: none; }' +
'    .tab-content.active { display: block; }' +
'    .file-list { max-height: 300px; overflow-y: auto; }' +
'    .file-item { padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }' +
'    .file-item button { background: rgba(255,0,0,0.2); border: none; color: #ff6b6b; padding: 5px 15px; border-radius: 5px; cursor: pointer; }' +
'  </style>' +
'</head>' +
'<body>' +
'  <div class="container">' +
'    <h1>Hedwig File Share</h1>' +
'    <p class="subtitle">临时文件分享 - 自动过期 - GitHub 存储</p>' +
'    <div class="user-info" id="userInfo">' +
'      <span id="userName"></span>' +
'      <span class="super-badge" id="superBadge" style="display:none;">SUPER</span>' +
'    </div>' +
'    <div class="tabs">' +
'      <div class="tab active" onclick="switchTab(event, 'upload')">上传文件</div>' +
'      <div class="tab" onclick="switchTab(event, 'files')">我的文件</div>' +
'    </div>' +
'    <div class="tab-content active" id="uploadTab">' +
'      <div class="upload-area" id="uploadArea">' +
'        <span style="font-size: 3em;">&#128193;</span>' +
'        <p>点击或拖拽文件到此处上传</p>' +
'        <p style="color: #666; font-size: 0.9em; margin-top: 10px;">普通用户 <=100MB - 10分钟过期</p>' +
'        <input type="file" class="file-input" id="fileInput">' +
'      </div>' +
'      <div class="options" id="options">' +
'        <div class="input-group">' +
'          <label>文件名 <span id="fileName"></span></label>' +
'        </div>' +
'        <div class="input-group super-only" style="display:none;">' +
'          <label>自定义链接 <span class="super-badge">SUPER</span></label>' +
'          <input type="text" id="customSlug" placeholder="my-custom-link">' +
'        </div>' +
'        <div class="input-group super-only" style="display:none;">' +
'          <label>有效期（秒）<span class="super-badge">SUPER</span></label>' +
'          <input type="number" id="customTtl" placeholder="默认 600 秒">' +
'        </div>' +
'      </div>' +
'      <button class="btn" id="uploadBtn" disabled>上传文件</button>' +
'      <div class="progress-bar" id="progressBar" style="display:none;">' +
'        <div class="progress-fill" id="progressFill" style="width: 0%"></div>' +
'      </div>' +
'      <div class="chunk-info" id="chunkInfo"></div>' +
'      <div class="result" id="result">' +
'        <h3>上传成功</h3>' +
'        <p>下载链接（点击复制）：</p>' +
'        <div class="link-box" id="linkBox"></div>' +
'        <p id="expireText"></p>' +
'        <div id="chunkDownload" style="display:none; margin-top: 10px;">' +
'          <p>此文件已切片</p>' +
'        </div>' +
'      </div>' +
'    </div>' +
'    <div class="tab-content" id="filesTab">' +
'      <div class="file-list" id="fileList">' +
'        <p style="text-align:center;color:#888;">加载中...</p>' +
'      </div>' +
'    </div>' +
'    <div class="stats" id="stats">' +
'      <p>服务器容量：<span id="usageText">加载中...</span></p>' +
'      <div class="progress-bar">' +
'        <div class="progress-fill" id="usageBar" style="width: 0%"></div>' +
'      </div>' +
'    </div>' +
'  </div>' +
'  <script>' +
'    const uploadArea = document.getElementById("uploadArea");' +
'    const fileInput = document.getElementById("fileInput");' +
'    const options = document.getElementById("options");' +
'    const uploadBtn = document.getElementById("uploadBtn");' +
'    const result = document.getElementById("result");' +
'    let selectedFile = null;' +
'    let isSuper = false;' +
'    let currentUser = null;' +
'    async function checkUser() {' +
'      try {' +
'        const res = await fetch("/api/current-user", { credentials: "include" });' +
'        const data = await res.json();' +
'        if (data.user) {' +
'          currentUser = data.user.username;' +
'          document.getElementById("userName").textContent = currentUser;' +
'          document.getElementById("userInfo").classList.add("active");' +
'          if (currentUser === "hedwig") {' +
'            isSuper = true;' +
'            document.getElementById("superBadge").style.display = "inline-block";' +
'            document.querySelectorAll(".super-only").forEach(el => el.style.display = "block");' +
'          }' +
'        }' +
'      } catch (e) {}' +
'    }' +
'    checkUser();' +
'    function switchTab(event, tab) {' +
'      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));' +
'      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));' +
'      event.target.classList.add("active");' +
'      document.getElementById(tab + "Tab").classList.add("active");' +
'      if (tab === "files") loadMyFiles();' +
'    }' +
'    uploadArea.addEventListener("click", () => fileInput.click());' +
'    uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("dragover"); });' +
'    uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("dragover"));' +
'    uploadArea.addEventListener("drop", (e) => { e.preventDefault(); uploadArea.classList.remove("dragover"); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });' +
'    fileInput.addEventListener("change", (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });' +
'    function handleFile(file) {' +
'      selectedFile = file;' +
'      document.getElementById("fileName").textContent = file.name + " (" + formatBytes(file.size) + ")";' +
'      options.classList.add("active");' +
'      uploadBtn.disabled = false;' +
'    }' +
'    uploadBtn.addEventListener("click", async () => {' +
'      if (!selectedFile) return;' +
'      uploadBtn.disabled = true;' +
'      uploadBtn.textContent = "上传中...";' +
'      document.getElementById("progressBar").style.display = "block";' +
'      try {' +
'        const formData = new FormData();' +
'        formData.append("file", selectedFile);' +
'        if (isSuper) {' +
'          const slug = document.getElementById("customSlug").value;' +
'          const ttl = document.getElementById("customTtl").value;' +
'          if (slug) formData.append("slug", slug);' +
'          if (ttl) formData.append("ttl", ttl);' +
'        }' +
'        const res = await fetch("/api/file/upload", { method: "POST", body: formData, credentials: "include" });' +
'        const data = await res.json();' +
'        if (!res.ok) throw new Error(data.error || "上传失败");' +
'        showResult(data);' +
'      } catch (err) {' +
'        showError(err.message);' +
'      } finally {' +
'        uploadBtn.disabled = false;' +
'        uploadBtn.textContent = "上传文件";' +
'      }' +
'    });' +
'    function showResult(data) {' +
'      result.classList.remove("error");' +
'      result.classList.add("active");' +
'      document.getElementById("linkBox").textContent = data.downloadUrl;' +
'      document.getElementById("linkBox").onclick = () => { navigator.clipboard.writeText(data.downloadUrl); alert("已复制到剪贴板"); };' +
'      const expire = new Date(data.expiresAt);' +
'      document.getElementById("expireText").textContent = "过期时间：" + expire.toLocaleString() + (data.isSuper ? " [超级用户]" : "");' +
'      if (data.chunked) {' +
'        document.getElementById("chunkDownload").style.display = "block";' +
'      }' +
'    }' +
'    function showError(msg) {' +
'      result.classList.add("error");' +
'      result.innerHTML = "<h3>错误</h3><p>" + msg + "</p>";' +
'      result.classList.add("active");' +
'    }' +
'    async function loadMyFiles() {' +
'      try {' +
'        const res = await fetch("/api/file/info", { credentials: "include" });' +
'        const data = await res.json();' +
'        const list = document.getElementById("fileList");' +
'        list.innerHTML = "<p style=text-align:center;color:#888;>功能开发中...</p>";' +
'      } catch (e) { console.error(e); }' +
'    }' +
'    function formatBytes(bytes) {' +
'      if (bytes === 0) return "0 B";' +
'      const k = 1024;' +
'      const sizes = ["B", "KB", "MB", "GB"];' +
'      const i = Math.floor(Math.log(bytes) / Math.log(k));' +
'      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];' +
'    }' +
'    async function loadStats() {' +
'      try {' +
'        const res = await fetch("/api/file/info");' +
'        const data = await res.json();' +
'        document.getElementById("usageText").textContent = data.totalSizeFormatted + " / " + data.capacityFormatted + " (" + data.usagePercent + "%)";' +
'        document.getElementById("usageBar").style.width = data.usagePercent + "%";' +
'      } catch (e) {}' +
'    }' +
'    loadStats();' +
'  </script>' +
'</body>' +
'</html>';
}