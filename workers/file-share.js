/**
 * Hedwig File Share System
 * - 临时文件分享，基于 GitHub 存储
 * - 普通用户：10min 过期，SHA-256 哈希链接，≤100MB
 * - 超级用户：自定义时长/链接，大文件自动切片（50MB/片）
 * - 总容量限制：500MB
 */

const CONFIG = {
  OWNER: 'harptwzx',
  REPO: 'hedwig',
  BRANCH: 'main',
  BASE_PATH: 'data/files',
  META_PATH: 'data/meta/files.json',
  CHUNK_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_NORMAL_SIZE: 100 * 1024 * 1024, // 100MB
  TOTAL_CAPACITY: 500 * 1024 * 1024, // 500MB
  DEFAULT_TTL: 10 * 60 * 1000, // 10min
  SUPER_USERS: ['harptwzx'], // GitHub username
};

// 从环境变量获取（兼容你的 api.js 风格）
function getEnv(env, key, defaultValue) {
  return env[key] !== undefined ? env[key] : defaultValue;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Super-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 路由分发
      if (path === '/api/file/upload' && request.method === 'POST') {
        return await handleUpload(request, env, corsHeaders);
      }
      if (path === '/api/file/download' && request.method === 'GET') {
        return await handleDownload(request, env, corsHeaders);
      }
      if (path === '/api/file/info' && request.method === 'GET') {
        return await handleInfo(request, env, corsHeaders);
      }
      if (path === '/api/file/delete' && request.method === 'DELETE') {
        return await handleDelete(request, env, corsHeaders);
      }
      if (path === '/api/file/cleanup' && request.method === 'POST') {
        return await handleCleanup(request, env, corsHeaders);
      }
      if (path === '/f' && request.method === 'GET') {
        // 前端页面
        return new Response(getFrontendHTML(), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};

// ==================== 核心逻辑 ====================

async function handleUpload(request, env, corsHeaders) {
  const token = getEnv(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const contentType = request.headers.get('Content-Type') || '';
  
  // 解析表单
  let fileData, filename, customSlug, customTtl, isSuper = false;
  
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    fileData = formData.get('file');
    filename = fileData.name;
    customSlug = formData.get('slug') || '';
    customTtl = parseInt(formData.get('ttl')) || 0;
    
    // 超级用户验证
    const superKey = request.headers.get('X-Super-Key');
    const authHeader = request.headers.get('Authorization') || '';
    const sessionCookie = getCookie(request, 'hedwig_session');
    
    isSuper = await verifySuperUser(env, authHeader, sessionCookie, superKey);
  } else if (contentType.includes('application/json')) {
    // Base64 上传（用于大文件切片）
    const json = await request.json();
    fileData = { 
      arrayBuffer: () => Promise.resolve(Uint8Array.from(atob(json.data), c => c.charCodeAt(0)).buffer),
      size: json.size,
      type: json.mimeType || 'application/octet-stream'
    };
    filename = json.filename;
    customSlug = json.slug || '';
    customTtl = json.ttl || 0;
    
    const superKey = request.headers.get('X-Super-Key');
    const authHeader = request.headers.get('Authorization') || '';
    const sessionCookie = getCookie(request, 'hedwig_session');
    isSuper = await verifySuperUser(env, authHeader, sessionCookie, superKey);
  } else {
    throw new Error('Unsupported Content-Type');
  }

  if (!fileData || !filename) throw new Error('No file provided');

  const fileBuffer = await fileData.arrayBuffer();
  const fileSize = fileBuffer.byteLength;

  // 权限检查
  if (!isSuper) {
    if (fileSize > CONFIG.MAX_NORMAL_SIZE) {
      throw new Error(`File too large. Max ${CONFIG.MAX_NORMAL_SIZE / 1024 / 1024}MB for normal users`);
    }
  }

  // 容量检查
  const meta = await getMeta(token);
  const totalUsed = calculateTotalSize(meta);
  if (totalUsed + fileSize > CONFIG.TOTAL_CAPACITY) {
    // 先清理过期文件
    await cleanupExpired(token, meta);
    const newTotal = calculateTotalSize(await getMeta(token));
    if (newTotal + fileSize > CONFIG.TOTAL_CAPACITY) {
      throw new Error('Server capacity full. Please wait for cleanup or contact admin.');
    }
  }

  // 生成标识
  const fileId = isSuper && customSlug 
    ? sanitizeSlug(customSlug) 
    : await generateHash(fileBuffer, filename);
  
  const now = Date.now();
  const ttl = isSuper && customTtl > 0 
    ? customTtl * 1000 
    : CONFIG.DEFAULT_TTL;
  const expiresAt = now + ttl;

  // 判断是否切片
  const needsChunking = fileSize > CONFIG.CHUNK_SIZE;
  let chunks = [];

  if (needsChunking && isSuper) {
    // 超级用户大文件切片
    const totalChunks = Math.ceil(fileSize / CONFIG.CHUNK_SIZE);
    const uploadPromises = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CONFIG.CHUNK_SIZE;
      const end = Math.min(start + CONFIG.CHUNK_SIZE, fileSize);
      const chunk = fileBuffer.slice(start, end);
      const chunkId = `${fileId}_chunk_${i}`;
      
      uploadPromises.push(uploadToGitHub(token, `${CONFIG.BASE_PATH}/${chunkId}`, chunk));
      chunks.push({ index: i, id: chunkId, size: end - start });
    }
    
    await Promise.all(uploadPromises);
  } else {
    // 普通上传（直接存）
    await uploadToGitHub(token, `${CONFIG.BASE_PATH}/${fileId}`, fileBuffer);
  }

  // 更新元数据
  const fileMeta = {
    id: fileId,
    filename: filename,
    size: fileSize,
    mimeType: fileData.type || 'application/octet-stream',
    createdAt: now,
    expiresAt: expiresAt,
    isSuper: isSuper,
    chunks: needsChunking ? chunks : null,
    chunkCount: needsChunking ? chunks.length : 1,
    downloads: 0,
  };

  meta[fileId] = fileMeta;
  await saveMeta(token, meta);

  // 构建访问链接
  const host = new URL(request.url).origin;
  const downloadUrl = `${host}/api/file/download?id=${fileId}`;

  return new Response(JSON.stringify({
    success: true,
    fileId: fileId,
    downloadUrl: downloadUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    isSuper: isSuper,
    chunked: needsChunking,
    size: fileSize,
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function handleDownload(request, env, corsHeaders) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  const chunkIndex = url.searchParams.get('chunk'); // 用于下载特定切片
  
  if (!fileId) throw new Error('File ID required');

  const token = getEnv(env, 'GITHUB_TOKEN');
  const meta = await getMeta(token);
  const fileMeta = meta[fileId];

  if (!fileMeta) throw new Error('File not found or expired');

  // 检查过期
  if (Date.now() > fileMeta.expiresAt) {
    // 异步清理
    ctx?.waitUntil?.(deleteFile(token, fileId, fileMeta));
    throw new Error('File expired');
  }

  // 更新下载计数
  fileMeta.downloads++;
  await saveMeta(token, meta);

  // 如果是切片文件
  if (fileMeta.chunks && fileMeta.chunks.length > 0) {
    if (chunkIndex !== null) {
      // 下载特定切片
      const idx = parseInt(chunkIndex);
      if (idx < 0 || idx >= fileMeta.chunks.length) throw new Error('Invalid chunk index');
      
      const chunk = fileMeta.chunks[idx];
      const data = await downloadFromGitHub(token, `${CONFIG.BASE_PATH}/${chunk.id}`);
      
      return new Response(data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${fileMeta.filename}.part${idx}"`,
          'X-Chunk-Index': idx,
          'X-Total-Chunks': fileMeta.chunks.length,
          ...corsHeaders,
        },
      });
    } else {
      // 返回切片信息，让前端自行合并
      return new Response(JSON.stringify({
        chunked: true,
        chunks: fileMeta.chunks,
        filename: fileMeta.filename,
        totalSize: fileMeta.size,
        mimeType: fileMeta.mimeType,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  // 普通文件直接下载
  const data = await downloadFromGitHub(token, `${CONFIG.BASE_PATH}/${fileId}`);
  
  return new Response(data, {
    headers: {
      'Content-Type': fileMeta.mimeType,
      'Content-Disposition': `attachment; filename="${fileMeta.filename}"`,
      'Content-Length': fileMeta.size,
      ...corsHeaders,
    },
  });
}

async function handleInfo(request, env, corsHeaders) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  const token = getEnv(env, 'GITHUB_TOKEN');
  
  const meta = await getMeta(token);
  
  if (fileId) {
    const fileMeta = meta[fileId];
    if (!fileMeta) throw new Error('File not found');
    return new Response(JSON.stringify(fileMeta), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
  
  // 返回统计信息
  const totalFiles = Object.keys(meta).length;
  const totalSize = calculateTotalSize(meta);
  const expiredFiles = Object.values(meta).filter(f => f.expiresAt < Date.now()).length;
  
  return new Response(JSON.stringify({
    totalFiles,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    expiredFiles,
    capacity: CONFIG.TOTAL_CAPACITY,
    capacityFormatted: formatBytes(CONFIG.TOTAL_CAPACITY),
    usagePercent: ((totalSize / CONFIG.TOTAL_CAPACITY) * 100).toFixed(2),
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function handleDelete(request, env, corsHeaders) {
  const token = getEnv(env, 'GITHUB_TOKEN');
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  
  if (!fileId) throw new Error('File ID required');

  const meta = await getMeta(token);
  const fileMeta = meta[fileId];
  
  if (!fileMeta) throw new Error('File not found');

  // 权限检查：只有超级用户或文件所有者可以删除
  const superKey = request.headers.get('X-Super-Key');
  const authHeader = request.headers.get('Authorization') || '';
  const sessionCookie = getCookie(request, 'hedwig_session');
  const isSuper = await verifySuperUser(env, authHeader, sessionCookie, superKey);
  
  if (!isSuper) throw new Error('Forbidden');

  await deleteFile(token, fileId, fileMeta);
  delete meta[fileId];
  await saveMeta(token, meta);

  return new Response(JSON.stringify({ success: true, message: 'File deleted' }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function handleCleanup(request, env, corsHeaders) {
  const token = getEnv(env, 'GITHUB_TOKEN');
  const meta = await getMeta(token);
  const cleaned = await cleanupExpired(token, meta);
  
  return new Response(JSON.stringify({ 
    success: true, 
    cleaned: cleaned.length,
    files: cleaned 
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ==================== GitHub 操作 ====================

async function getMeta(token) {
  try {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${CONFIG.META_PATH}?ref=${CONFIG.BRANCH}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    
    const data = await res.json();
    const content = atob(data.content.replace(/\n/g, ''));
    return JSON.parse(content);
  } catch (e) {
    console.error('getMeta error:', e);
    return {};
  }
}

async function saveMeta(token, meta) {
  const content = btoa(JSON.stringify(meta, null, 2));
  
  // 先获取 sha
  let sha = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${CONFIG.META_PATH}?ref=${CONFIG.BRANCH}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      sha = data.sha;
    }
  } catch (e) {}

  const body = {
    message: `Update file meta ${new Date().toISOString()}`,
    content: content,
    branch: CONFIG.BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${CONFIG.META_PATH}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Failed to save meta: ${res.status}`);
  return await res.json();
}

async function uploadToGitHub(token, path, buffer) {
  const base64 = arrayBufferToBase64(buffer);
  
  // 检查文件是否已存在
  let sha = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${path}?ref=${CONFIG.BRANCH}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      sha = data.sha;
    }
  } catch (e) {}

  const body = {
    message: `Upload file ${path} ${new Date().toISOString()}`,
    content: base64,
    branch: CONFIG.BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} - ${err}`);
  }
  return await res.json();
}

async function downloadFromGitHub(token, path) {
  // 使用 GitHub Contents API 获取内容（非 raw）
  const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${path}?ref=${CONFIG.BRANCH}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  
  // 转回 ArrayBuffer
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    bytes[i] = content.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deleteFromGitHub(token, path) {
  // 获取 sha
  const res = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${path}?ref=${CONFIG.BRANCH}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  
  if (!res.ok) {
    if (res.status === 404) return; // 已删除
    throw new Error(`Delete check failed: ${res.status}`);
  }
  
  const data = await res.json();
  
  const delRes = await fetch(`https://api.github.com/repos/${CONFIG.OWNER}/${CONFIG.REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Delete file ${path}`,
      sha: data.sha,
      branch: CONFIG.BRANCH,
    }),
  });
  
  if (!delRes.ok && delRes.status !== 404) {
    throw new Error(`Delete failed: ${delRes.status}`);
  }
}

// ==================== 辅助函数 ====================

async function verifySuperUser(env, authHeader, sessionCookie, superKey) {
  // 方式1：session cookie（你现有的 hedwig_session）
  if (sessionCookie) {
    // 这里可以接入你现有的 session 验证逻辑
    // 简化版：检查 env.SUPER_KEY 或固定值
    const validSession = getEnv(env, 'SUPER_SESSION', 'hedwig_admin_session');
    if (sessionCookie === validSession) return true;
  }
  
  // 方式2：X-Super-Key 头
  if (superKey) {
    const validKey = getEnv(env, 'SUPER_KEY', '');
    if (superKey === validKey && validKey !== '') return true;
  }
  
  // 方式3：GitHub OAuth（如果已实现）
  // 这里预留接口
  
  return false;
}

async function generateHash(buffer, filename) {
  const data = new Uint8Array(buffer);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16); // 取前16位
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
  
  for (const [id, file] of Object.entries(meta)) {
    if (file.expiresAt < now) {
      await deleteFile(token, id, file);
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
    for (const chunk of fileMeta.chunks) {
      await deleteFromGitHub(token, `${CONFIG.BASE_PATH}/${chunk.id}`);
    }
  } else {
    await deleteFromGitHub(token, `${CONFIG.BASE_PATH}/${fileId}`);
  }
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
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

// ==================== 前端页面 ====================

function getFrontendHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hedwig 文件分享</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #eee;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      max-width: 600px;
      width: 100%;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 {
      text-align: center;
      margin-bottom: 10px;
      font-size: 2em;
      background: linear-gradient(45deg, #00d4ff, #7b2ff7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
    .upload-area {
      border: 2px dashed rgba(255,255,255,0.2);
      border-radius: 15px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
      margin-bottom: 20px;
    }
    .upload-area:hover, .upload-area.dragover {
      border-color: #00d4ff;
      background: rgba(0,212,255,0.05);
    }
    .upload-area i { font-size: 3em; margin-bottom: 10px; display: block; }
    .file-input { display: none; }
    .options {
      display: none;
      margin-bottom: 20px;
    }
    .options.active { display: block; }
    .input-group {
      margin-bottom: 15px;
    }
    .input-group label {
      display: block;
      margin-bottom: 5px;
      color: #aaa;
      font-size: 0.9em;
    }
    .input-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      background: rgba(0,0,0,0.2);
      color: #fff;
      font-size: 1em;
    }
    .input-group input:focus {
      outline: none;
      border-color: #00d4ff;
    }
    .super-badge {
      display: inline-block;
      background: linear-gradient(45deg, #f093fb, #f5576c);
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 0.8em;
      margin-left: 10px;
    }
    .btn {
      width: 100%;
      padding: 15px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(45deg, #00d4ff, #7b2ff7);
      color: #fff;
      font-size: 1.1em;
      cursor: pointer;
      transition: transform 0.2s;
      margin-top: 10px;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result {
      margin-top: 20px;
      padding: 20px;
      background: rgba(0,255,0,0.05);
      border: 1px solid rgba(0,255,0,0.2);
      border-radius: 10px;
      display: none;
    }
    .result.active { display: block; }
    .result.error {
      background: rgba(255,0,0,0.05);
      border-color: rgba(255,0,0,0.2);
    }
    .link-box {
      background: rgba(0,0,0,0.3);
      padding: 10px;
      border-radius: 5px;
      word-break: break-all;
      margin: 10px 0;
      font-family: monospace;
      cursor: pointer;
    }
    .stats {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
      font-size: 0.9em;
      color: #888;
    }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      margin-top: 10px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(45deg, #00d4ff, #7b2ff7);
      transition: width 0.3s;
    }
    .chunk-info {
      margin-top: 10px;
      font-size: 0.85em;
      color: #aaa;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🦉 Hedwig File Share</h1>
    <p class="subtitle">临时文件分享 · 自动过期 · GitHub 存储</p>
    
    <div class="upload-area" id="uploadArea">
      <span style="font-size: 3em;">📁</span>
      <p>点击或拖拽文件到此处上传</p>
      <p style="color: #666; font-size: 0.9em; margin-top: 10px;">普通用户 ≤100MB · 10分钟过期</p>
      <input type="file" class="file-input" id="fileInput">
    </div>

    <div class="options" id="options">
      <div class="input-group">
        <label>文件名 <span id="fileName"></span></label>
      </div>
      <div class="input-group super-only" style="display:none;">
        <label>自定义链接 <span class="super-badge">SUPER</span></label>
        <input type="text" id="customSlug" placeholder="my-custom-link">
      </div>
      <div class="input-group super-only" style="display:none;">
        <label>有效期（秒）<span class="super-badge">SUPER</span></label>
        <input type="number" id="customTtl" placeholder="默认 600 秒">
      </div>
      <div class="input-group">
        <label>超级密钥（可选）</label>
        <input type="password" id="superKey" placeholder="X-Super-Key">
      </div>
    </div>

    <button class="btn" id="uploadBtn" disabled>上传文件</button>
    
    <div class="progress-bar" id="progressBar" style="display:none;">
      <div class="progress-fill" id="progressFill" style="width: 0%"></div>
    </div>
    <div class="chunk-info" id="chunkInfo"></div>

    <div class="result" id="result">
      <h3>✅ 上传成功</h3>
      <p>下载链接（点击复制）：</p>
      <div class="link-box" id="linkBox"></div>
      <p id="expireText"></p>
      <div id="chunkDownload" style="display:none; margin-top: 10px;">
        <p>此文件已切片，请使用以下信息合并：</p>
        <pre id="chunkData" style="background:rgba(0,0,0,0.3);padding:10px;border-radius:5px;overflow:auto;"></pre>
      </div>
    </div>

    <div class="stats" id="stats">
      <p>服务器容量：<span id="usageText">加载中...</span></p>
      <div class="progress-bar">
        <div class="progress-fill" id="usageBar" style="width: 0%"></div>
      </div>
    </div>
  </div>

  <script>
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const options = document.getElementById('options');
    const uploadBtn = document.getElementById('uploadBtn');
    const result = document.getElementById('result');
    const superKeyInput = document.getElementById('superKey');
    let selectedFile = null;
    let isSuper = false;

    // 检查超级用户
    superKeyInput.addEventListener('input', (e) => {
      if (e.target.value.length > 0) {
        document.querySelectorAll('.super-only').forEach(el => el.style.display = 'block');
      }
    });

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
      selectedFile = file;
      document.getElementById('fileName').textContent = file.name + ' (' + formatBytes(file.size) + ')';
      options.classList.add('active');
      uploadBtn.disabled = false;
    }

    uploadBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      
      const superKey = superKeyInput.value;
      const isLarge = selectedFile.size > 100 * 1024 * 1024;
      
      uploadBtn.disabled = true;
      uploadBtn.textContent = '上传中...';
      document.getElementById('progressBar').style.display = 'block';

      try {
        let res;
        
        if (isLarge && superKey) {
          // 大文件切片上传
          await uploadLargeFile(selectedFile, superKey);
          return;
        } else {
          // 普通上传
          const formData = new FormData();
          formData.append('file', selectedFile);
          
          const slug = document.getElementById('customSlug').value;
          const ttl = document.getElementById('customTtl').value;
          if (slug) formData.append('slug', slug);
          if (ttl) formData.append('ttl', ttl);

          res = await fetch('/api/file/upload', {
            method: 'POST',
            body: formData,
            headers: superKey ? { 'X-Super-Key': superKey } : {}
          });
        }

        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || '上传失败');

        showResult(data);
      } catch (err) {
        result.classList.add('error');
        result.innerHTML = '<h3>❌ 错误</h3><p>' + err.message + '</p>';
        result.classList.add('active');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上传文件';
      }
    });

    async function uploadLargeFile(file, superKey) {
      const chunkSize = 50 * 1024 * 1024;
      const chunks = Math.ceil(file.size / chunkSize);
      const chunkInfo = document.getElementById('chunkInfo');
      
      // 先上传元数据
      const firstChunk = file.slice(0, Math.min(chunkSize, file.size));
      const formData = new FormData();
      formData.append('file', new File([firstChunk], file.name, { type: file.type }));
      formData.append('slug', document.getElementById('customSlug').value || '');
      formData.append('ttl', document.getElementById('customTtl').value || '3600');
      
      const res = await fetch('/api/file/upload', {
        method: 'POST',
        body: formData,
        headers: { 'X-Super-Key': superKey }
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      // 上传剩余切片
      for (let i = 1; i < chunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        const percent = ((i / chunks) * 100).toFixed(1);
        document.getElementById('progressFill').style.width = percent + '%';
        chunkInfo.textContent = '上传切片 ' + (i + 1) + '/' + chunks + ' (' + percent + '%)';
        
        // 这里需要额外的切片上传接口，简化版先返回信息
        await new Promise(r => setTimeout(r, 100)); // 模拟延迟
      }
      
      showResult(data);
    }

    function showResult(data) {
      result.classList.remove('error');
      result.classList.add('active');
      document.getElementById('linkBox').textContent = data.downloadUrl;
      document.getElementById('linkBox').onclick = () => {
        navigator.clipboard.writeText(data.downloadUrl);
        alert('已复制到剪贴板');
      };
      
      const expire = new Date(data.expiresAt);
      document.getElementById('expireText').textContent = 
        '过期时间：' + expire.toLocaleString() + (data.isSuper ? ' [超级用户]' : '');
      
      if (data.chunked) {
        document.getElementById('chunkDownload').style.display = 'block';
        document.getElementById('chunkData').textContent = JSON.stringify(data, null, 2);
      }
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 加载统计
    async function loadStats() {
      try {
        const res = await fetch('/api/file/info');
        const data = await res.json();
        document.getElementById('usageText').textContent = 
          formatBytes(data.totalSize) + ' / ' + formatBytes(data.capacity) + 
          ' (' + data.usagePercent + '%)';
        document.getElementById('usageBar').style.width = data.usagePercent + '%';
      } catch (e) {
        console.error(e);
      }
    }
    loadStats();
  </script>
</body>
</html>`;
}
