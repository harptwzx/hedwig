const CONFIG = {
    // GitHub 配置 (从环境变量读取)
    get owner() { return typeof env !== 'undefined' ? env.GITHUB_OWNER : 'harptwzx'; },
    get repo() { return typeof env !== 'undefined' ? env.GITHUB_REPO : 'hedwig'; },
    get token() { return typeof env !== 'undefined' ? env.GITHUB_TOKEN : ''; },

    // 限制
    MAX_NORMAL_SIZE: 100 * 1024 * 1024,  // 100MB
    CHUNK_SIZE: 50 * 1024 * 1024,         // 50MB 切片
    DEFAULT_EXPIRY: 10 * 60 * 1000,        // 10分钟
    MAX_TOTAL_SIZE: 500 * 1024 * 1024,    // 500MB 总容量

    // 超级用户配置
    SUPER_USERS: ['hedwig', 'harptwzx'],    // 超级用户列表
};

// GitHub API 工具
class GitHubStorage {
    constructor(token, owner, repo) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
        this.headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Hedwig-FileShare/1.0',
        };
    }

    async request(path, options = {}) {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        const resp = await fetch(url, {
            ...options,
            headers: { ...this.headers, ...options.headers },
        });

        if (!resp.ok && resp.status !== 404) {
            const text = await resp.text();
            throw new Error(`GitHub API ${resp.status}: ${text.slice(0, 200)}`);
        }
        return resp;
    }

    // 获取文件内容
    async getFile(path) {
        try {
            const resp = await this.request(`/contents/${path}`);
            if (resp.status === 404) return null;
            const data = await resp.json();
            if (data.content) {
                return JSON.parse(atob(data.content.replace(/\n/g, '')));
            }
            return null;
        } catch {
            return null;
        }
    }

    // 创建/更新文件
    async putFile(path, content, message) {
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        const base64Content = btoa(unescape(encodeURIComponent(contentStr)));

        // 先获取 sha (如果文件存在)
        let sha = null;
        try {
            const resp = await this.request(`/contents/${path}`);
            if (resp.status === 200) {
                const data = await resp.json();
                sha = data.sha;
            }
        } catch {}

        const body = {
            message: message || `Update ${path}`,
            content: base64Content,
            ...(sha ? { sha } : {}),
        };

        const resp = await this.request(`/contents/${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return resp.ok;
    }

    // 删除文件
    async deleteFile(path, message) {
        let sha = null;
        try {
            const resp = await this.request(`/contents/${path}`);
            if (resp.status === 200) {
                const data = await resp.json();
                sha = data.sha;
            }
        } catch {}

        if (!sha) return true;

        const resp = await this.request(`/contents/${path}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message || `Delete ${path}`,
                sha,
            }),
        });
        return resp.ok;
    }

    // 获取目录内容
    async listDir(path) {
        try {
            const resp = await this.request(`/contents/${path}`);
            if (resp.status === 404) return [];
            return await resp.json();
        } catch {
            return [];
        }
    }
}

// 生成哈希 ID
function generateHash() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 检查用户是否是超级用户
function isSuperUser(user) {
    if (!user) return false;
    return CONFIG.SUPER_USERS.includes(user.username) || 
           CONFIG.SUPER_USERS.includes(user.githubLogin);
}

// 获取当前用户 (从 cookie 或 session)
async function getCurrentUser(request) {
    // 简化: 从 cookie 获取
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/hedwig_session=([^;]+)/);
    if (!match) return null;

    try {
        const sessionData = JSON.parse(atob(decodeURIComponent(match[1])));
        return sessionData.user || null;
    } catch {
        return null;
    }
}

// 计算总存储用量
async function getTotalSize(gh) {
    const files = await gh.listDir('data/files');
    let total = 0;
    for (const f of files) {
        if (f.type === 'file' && f.name.endsWith('.json')) {
            try {
                const meta = await gh.getFile(`data/files/${f.name}`);
                if (meta && meta.size) total += meta.size;
            } catch {}
        }
    }
    return total;
}

// 清理过期文件
async function cleanupExpired(gh) {
    const files = await gh.listDir('data/files');
    const now = Date.now();
    for (const f of files) {
        if (f.type === 'file' && f.name.endsWith('.json')) {
            try {
                const meta = await gh.getFile(`data/files/${f.name}`);
                if (meta && meta.expiresAt && meta.expiresAt < now) {
                    // 删除文件数据
                    if (meta.chunks) {
                        for (const chunk of meta.chunks) {
                            await gh.deleteFile(`data/file_data/${chunk.path}`, 'Cleanup expired file');
                        }
                    } else if (meta.path) {
                        await gh.deleteFile(`data/file_data/${meta.path}`, 'Cleanup expired file');
                    }
                    // 删除元数据
                    await gh.deleteFile(`data/files/${f.name}`, 'Cleanup expired metadata');
                }
            } catch {}
        }
    }
}

// 主处理
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS
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

        // 初始化 GitHub 存储
        const gh = new GitHubStorage(env.GITHUB_TOKEN, env.GITHUB_OWNER || CONFIG.owner, env.GITHUB_REPO || CONFIG.repo);

        // 获取当前用户
        const user = await getCurrentUser(request);
        const superUser = isSuperUser(user);

        // 路由分发
        if (path === '/share' || path === '/share/') {
            return handleUpload(request, gh, user, superUser, env);
        }

        if (path === '/share/upload' && request.method === 'POST') {
            return handleUpload(request, gh, user, superUser, env);
        }

        if (path.startsWith('/share/') && request.method === 'GET') {
            const fileId = path.replace('/share/', '');
            return handleDownload(fileId, gh);
        }

        if (path.startsWith('/share/') && request.method === 'DELETE') {
            const fileId = path.replace('/share/', '');
            return handleDelete(fileId, gh, user);
        }

        // 管理页面
        if (path === '/share/admin') {
            return handleAdmin(gh, user, superUser);
        }

        // 首页
        if (path === '/share' || path === '/share/') {
            return new Response(SHARE_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        return new Response('Not Found', { status: 404 });
    },
};

// 处理上传
async function handleUpload(request, gh, user, superUser, env) {
    try {
        const contentType = request.headers.get('Content-Type') || '';

        if (!contentType.includes('multipart/form-data')) {
            return jsonResponse({ error: '请使用 multipart/form-data 上传' }, 400);
        }

        const formData = await request.formData();
        const file = formData.get('file');
        const customUrl = formData.get('customUrl') || request.headers.get('X-Custom-Url');
        const expiryMinutes = parseInt(formData.get('expiryMinutes') || request.headers.get('X-Expiry-Minutes') || '10');

        if (!file || !(file instanceof File)) {
            return jsonResponse({ error: '请选择文件' }, 400);
        }

        const fileName = file.name;
        const fileSize = file.size;
        const fileType = file.type || 'application/octet-stream';

        // 权限检查
        if (!superUser) {
            if (fileSize > CONFIG.MAX_NORMAL_SIZE) {
                return jsonResponse({ error: `文件过大，普通用户限制 ${formatSize(CONFIG.MAX_NORMAL_SIZE)}` }, 413);
            }
            if (customUrl) {
                return jsonResponse({ error: '自定义网址仅超级用户可用' }, 403);
            }
        }

        // 检查总容量
        const currentSize = await getTotalSize(gh);
        if (currentSize + fileSize > CONFIG.MAX_TOTAL_SIZE) {
            // 先清理过期文件
            await cleanupExpired(gh);
            const newSize = await getTotalSize(gh);
            if (newSize + fileSize > CONFIG.MAX_TOTAL_SIZE) {
                return jsonResponse({ error: '服务器存储已满，请稍后重试' }, 507);
            }
        }

        // 生成文件ID
        let fileId;
        if (superUser && customUrl) {
            // 检查自定义URL是否已被占用
            const existing = await gh.getFile(`data/files/${customUrl}.json`);
            if (existing) {
                return jsonResponse({ error: '该自定义网址已被使用' }, 409);
            }
            fileId = customUrl;
        } else {
            fileId = generateHash();
            // 确保不重复
            while (await gh.getFile(`data/files/${fileId}.json`)) {
                fileId = generateHash();
            }
        }

        // 读取文件内容
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 计算过期时间
        const expiresAt = Date.now() + (superUser ? expiryMinutes * 60 * 1000 : CONFIG.DEFAULT_EXPIRY);

        // 元数据
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

        // 存储文件数据
        if (fileSize > CONFIG.CHUNK_SIZE && superUser) {
            // 切片存储 (仅超级用户)
            const numChunks = Math.ceil(fileSize / CONFIG.CHUNK_SIZE);
            for (let i = 0; i < numChunks; i++) {
                const start = i * CONFIG.CHUNK_SIZE;
                const end = Math.min(start + CONFIG.CHUNK_SIZE, fileSize);
                const chunk = uint8Array.slice(start, end);

                const chunkPath = `data/file_data/${fileId}_chunk_${i}`;
                const chunkBase64 = arrayBufferToBase64(chunk.buffer);

                await gh.putFile(chunkPath, chunkBase64, `Upload chunk ${i} of ${fileId}`);

                metadata.chunks.push({
                    index: i,
                    path: `${fileId}_chunk_${i}`,
                    size: end - start,
                });
            }
        } else {
            // 直接存储
            const filePath = `data/file_data/${fileId}`;
            const base64Content = arrayBufferToBase64(arrayBuffer);
            await gh.putFile(filePath, base64Content, `Upload file ${fileId}`);
            metadata.path = fileId;
        }

        // 保存元数据
        await gh.putFile(`data/files/${fileId}.json`, metadata, `Create metadata for ${fileId}`);

        return jsonResponse({
            success: true,
            fileId: fileId,
            url: `https://hedwig.eu.org/share/${fileId}`,
            name: fileName,
            size: fileSize,
            sizeFormatted: formatSize(fileSize),
            expiresAt: expiresAt,
            expiresIn: superUser ? `${expiryMinutes}分钟` : '10分钟',
            isChunked: metadata.chunks.length > 0,
            chunks: metadata.chunks.length,
        });

    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ error: '上传失败: ' + error.message }, 500);
    }
}

// 处理下载
async function handleDownload(fileId, gh) {
    try {
        const metadata = await gh.getFile(`data/files/${fileId}.json`);

        if (!metadata) {
            return new Response('文件不存在或已过期', { status: 404 });
        }

        // 检查是否过期
        if (metadata.expiresAt && metadata.expiresAt < Date.now()) {
            // 清理过期文件
            if (metadata.chunks) {
                for (const chunk of metadata.chunks) {
                    await gh.deleteFile(`data/file_data/${chunk.path}`, 'Cleanup expired');
                }
            } else if (metadata.path) {
                await gh.deleteFile(`data/file_data/${metadata.path}`, 'Cleanup expired');
            }
            await gh.deleteFile(`data/files/${fileId}.json`, 'Cleanup expired metadata');
            return new Response('文件已过期', { status: 410 });
        }

        // 读取文件数据
        let fileData;

        if (metadata.chunks && metadata.chunks.length > 0) {
            // 合并切片
            const chunks = [];
            for (const chunkInfo of metadata.chunks) {
                const chunkData = await gh.getFile(`data/file_data/${chunkInfo.path}`);
                if (chunkData) {
                    chunks.push(base64ToArrayBuffer(chunkData));
                }
            }

            // 合并
            const totalSize = chunks.reduce((sum, c) => sum + c.byteLength, 0);
            const merged = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
                merged.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }
            fileData = merged.buffer;
        } else {
            const base64Data = await gh.getFile(`data/file_data/${metadata.path}`);
            if (!base64Data) {
                return new Response('文件数据丢失', { status: 404 });
            }
            fileData = base64ToArrayBuffer(base64Data);
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
        console.error('Download error:', error);
        return new Response('下载失败: ' + error.message, { status: 500 });
    }
}

// 处理删除
async function handleDelete(fileId, gh, user) {
    try {
        const metadata = await gh.getFile(`data/files/${fileId}.json`);

        if (!metadata) {
            return jsonResponse({ error: '文件不存在' }, 404);
        }

        // 权限检查: 只能删除自己的文件，或超级用户
        if (!user || (metadata.uploadedBy !== user.username && !isSuperUser(user))) {
            return jsonResponse({ error: '无权删除此文件' }, 403);
        }

        // 删除文件数据
        if (metadata.chunks) {
            for (const chunk of metadata.chunks) {
                await gh.deleteFile(`data/file_data/${chunk.path}`, 'User delete');
            }
        } else if (metadata.path) {
            await gh.deleteFile(`data/file_data/${metadata.path}`, 'User delete');
        }

        // 删除元数据
        await gh.deleteFile(`data/files/${fileId}.json`, 'User delete');

        return jsonResponse({ success: true, message: '文件已删除' });

    } catch (error) {
        return jsonResponse({ error: '删除失败: ' + error.message }, 500);
    }
}

// 管理页面
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
                const meta = await gh.getFile(`data/files/${f.name}`);
                if (meta) {
                    totalSize += meta.size || 0;
                    fileList.push({
                        id: meta.id,
                        name: meta.name,
                        size: formatSize(meta.size || 0),
                        uploadedBy: meta.uploadedBy,
                        uploadedAt: new Date(meta.uploadedAt).toLocaleString('zh-CN'),
                        expiresAt: new Date(meta.expiresAt).toLocaleString('zh-CN'),
                        isExpired: meta.expiresAt < Date.now(),
                        isChunked: (meta.chunks || []).length > 0,
                    });
                }
            }
        }

        const html = ADMIN_HTML
            .replace('{{fileCount}}', String(fileList.length))
            .replace('{{totalSize}}', formatSize(totalSize))
            .replace('{{maxSize}}', formatSize(CONFIG.MAX_TOTAL_SIZE))
            .replace('{{usagePercent}}', String(Math.round((totalSize / CONFIG.MAX_TOTAL_SIZE) * 100)))
            .replace('{{fileList}}', JSON.stringify(fileList));

        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });

    } catch (error) {
        return new Response('加载失败: ' + error.message, { status: 500 });
    }
}

// 工具函数
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
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
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// HTML 模板
const SHARE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>文件分享 - Hedwig</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#eee;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh}
.container{max-width:800px;margin:0 auto;padding:40px 20px}
.header{text-align:center;margin-bottom:40px}
.header h1{font-size:2.2em;color:#7c8cff;margin-bottom:10px}
.header p{color:#888}
.upload-area{border:2px dashed #333;border-radius:16px;padding:60px 20px;text-align:center;transition:all .3s;cursor:pointer;background:#1a1a2e}
.upload-area:hover{border-color:#7c8cff;background:#1a1a2e}
.upload-area.dragover{border-color:#4CAF50;background:rgba(76,175,80,.05)}
.upload-icon{font-size:48px;margin-bottom:15px}
.upload-text{font-size:1.1em;color:#aaa;margin-bottom:10px}
.upload-hint{color:#666;font-size:.9em}
input[type="file"]{display:none}
.options{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px;margin-top:20px;display:none}
.options.show{display:block}
.option-row{display:flex;gap:15px;margin-bottom:15px;flex-wrap:wrap}
.option-row label{color:#aaa;min-width:100px;padding-top:8px}
.option-row input,.option-row select{flex:1;background:#0a0a1a;border:1px solid #333;border-radius:8px;padding:10px 15px;color:#eee;font-size:14px;min-width:200px}
.option-row input:focus,.option-row select:focus{outline:none;border-color:#7c8cff}
.upload-btn{background:#4CAF50;color:#fff;border:none;border-radius:8px;padding:14px 40px;font-size:16px;cursor:pointer;width:100%;margin-top:10px}
.upload-btn:hover{background:#45a049}
.upload-btn:disabled{background:#333;cursor:not-allowed}
.progress{background:#1a1a2e;border-radius:12px;padding:20px;margin-top:20px;display:none}
.progress.show{display:block}
.progress-bar{background:#333;border-radius:8px;height:20px;overflow:hidden}
.progress-fill{background:#4CAF50;height:100%;width:0%;transition:width .3s;border-radius:8px}
.progress-text{text-align:center;margin-top:10px;color:#aaa}
.result{background:#1a1a2e;border-radius:12px;padding:20px;margin-top:20px;display:none}
.result.show{display:block}
.result-url{background:#0a0a1a;border:1px solid #333;border-radius:8px;padding:15px;font-family:monospace;color:#4CAF50;word-break:break-all;margin:10px 0}
.copy-btn{background:#7c8cff;color:#fff;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:14px}
.copy-btn:hover{background:#6a7be0}
.file-info{color:#aaa;margin-top:10px;font-size:.9em}
.super-badge{display:inline-block;background:#FFD700;color:#0a0a1a;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:bold;margin-left:10px}
.footer{text-align:center;color:#666;margin-top:50px;padding:20px}
.footer a{color:#7c8cff;text-decoration:none}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Hedwig 文件分享</h1>
<p>临时文件存储，快速分享</p>
</div>

<div class="upload-area" id="uploadArea">
<div class="upload-icon">📁</div>
<div class="upload-text">点击或拖拽文件到此处上传</div>
<div class="upload-hint">普通用户: 最大 100MB，保存 10 分钟</div>
</div>
<input type="file" id="fileInput">

<div class="options" id="options">
<div class="option-row">
<label>文件名</label>
<input type="text" id="fileName" readonly>
</div>
<div class="option-row">
<label>文件大小</label>
<input type="text" id="fileSize" readonly>
</div>
<div class="option-row super-only" style="display:none">
<label>自定义网址</label>
<input type="text" id="customUrl" placeholder="例如: myfile (可选)">
</div>
<div class="option-row super-only" style="display:none">
<label>保存时长</label>
<select id="expiryMinutes">
<option value="10">10 分钟</option>
<option value="30">30 分钟</option>
<option value="60">1 小时</option>
<option value="180">3 小时</option>
<option value="360">6 小时</option>
<option value="720">12 小时</option>
<option value="1440">24 小时</option>
</select>
</div>
<button class="upload-btn" id="uploadBtn">上传文件</button>
</div>

<div class="progress" id="progress">
<div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
<div class="progress-text" id="progressText">准备上传...</div>
</div>

<div class="result" id="result">
<h3 style="color:#7c8cff;margin-bottom:10px">上传成功！</h3>
<p style="color:#aaa">分享链接:</p>
<div class="result-url" id="resultUrl"></div>
<button class="copy-btn" onclick="copyUrl()">复制链接</button>
<div class="file-info" id="fileInfo"></div>
</div>

<div class="footer">
<p>Powered by <a href="https://hedwig.eu.org">Hedwig</a> | 存储于 GitHub</p>
</div>
</div>

<script>
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const options = document.getElementById('options');
const uploadBtn = document.getElementById('uploadBtn');
const progress = document.getElementById('progress');
const result = document.getElementById('result');

let selectedFile = null;
let isSuperUser = false;

// 检查是否是超级用户 (简化: 从 cookie 或本地存储判断)
function checkSuperUser() {
    // 实际应该从服务器获取用户信息
    // 这里简化处理
    const cookie = document.cookie;
    isSuperUser = cookie.includes('hedwig_session'); // 简化判断
    if (isSuperUser) {
        document.querySelectorAll('.super-only').forEach(el => el.style.display = 'flex');
        document.querySelector('.upload-hint').textContent = '超级用户: 无大小限制，自定义时长和网址，支持切片';
        document.querySelector('.upload-hint').innerHTML += ' <span class="super-badge">SUPER</span>';
    }
}
checkSuperUser();

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
    if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

function handleFile(file) {
    selectedFile = file;
    document.getElementById('fileName').value = file.name;
    document.getElementById('fileSize').value = formatSize(file.size);
    options.classList.add('show');
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    progress.classList.add('show');
    result.classList.remove('show');

    const formData = new FormData();
    formData.append('file', selectedFile);

    if (isSuperUser) {
        const customUrl = document.getElementById('customUrl').value.trim();
        const expiry = document.getElementById('expiryMinutes').value;
        if (customUrl) formData.append('customUrl', customUrl);
        formData.append('expiryMinutes', expiry);
    }

    try {
        document.getElementById('progressText').textContent = '正在上传...';
        document.getElementById('progressFill').style.width = '50%';

        const resp = await fetch('/share/upload', {
            method: 'POST',
            body: formData,
        });

        document.getElementById('progressFill').style.width = '100%';

        const data = await resp.json();

        if (data.success) {
            document.getElementById('resultUrl').textContent = data.url;
            document.getElementById('fileInfo').innerHTML = 
                `文件名: ${data.name}<br>大小: ${data.sizeFormatted}<br>过期时间: ${data.expiresIn}` +
                (data.isChunked ? `<br>切片数: ${data.chunks}` : '');
            result.classList.add('show');
        } else {
            alert('上传失败: ' + data.error);
        }
    } catch (e) {
        alert('上传出错: ' + e.message);
    } finally {
        uploadBtn.disabled = false;
        setTimeout(() => progress.classList.remove('show'), 1000);
    }
});

function copyUrl() {
    const url = document.getElementById('resultUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
        alert('链接已复制！');
    });
}
</script>
</body>
</html>`;

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>文件管理 - Hedwig</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#eee;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh}
.container{max-width:1200px;margin:0 auto;padding:40px 20px}
.header{text-align:center;margin-bottom:40px}
.header h1{font-size:2.2em;color:#7c8cff;margin-bottom:10px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:40px}
.stat-card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px;text-align:center}
.stat-value{font-size:2em;color:#4CAF50;font-weight:bold}
.stat-label{color:#888;margin-top:5px}
.file-list{background:#1a1a2e;border:1px solid #333;border-radius:12px;overflow:hidden}
.file-list-header{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 100px;gap:15px;padding:15px 20px;background:#0a0a1a;color:#7c8cff;font-weight:bold;font-size:.9em}
.file-item{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 100px;gap:15px;padding:12px 20px;border-top:1px solid #333;align-items:center}
.file-item:hover{background:rgba(124,140,255,.05)}
.file-name{color:#eee;word-break:break-all}
.file-size{color:#aaa}
.file-uploader{color:#aaa}
.file-date{color:#888;font-size:.85em}
.file-status{color:#4CAF50}
.file-status.expired{color:#f44336}
.file-actions{display:flex;gap:8px}
.file-actions button{background:#333;border:none;color:#eee;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px}
.file-actions button:hover{background:#f44336}
.back-btn{display:inline-block;background:#7c8cff;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;margin-bottom:20px}
.back-btn:hover{background:#6a7be0}
.usage-bar{background:#333;border-radius:8px;height:20px;overflow:hidden;margin-top:10px}
.usage-fill{background:#4CAF50;height:100%;border-radius:8px}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>文件管理</h1>
<p>超级用户控制台</p>
</div>

<a href="/share" class="back-btn">返回上传页面</a>

<div class="stats">
<div class="stat-card">
<div class="stat-value">{{fileCount}}</div>
<div class="stat-label">文件总数</div>
</div>
<div class="stat-card">
<div class="stat-value">{{totalSize}}</div>
<div class="stat-label">已用空间</div>
</div>
<div class="stat-card">
<div class="stat-value">{{maxSize}}</div>
<div class="stat-label">总容量</div>
</div>
<div class="stat-card">
<div class="stat-value">{{usagePercent}}%</div>
<div class="stat-label">使用率</div>
<div class="usage-bar"><div class="usage-fill" style="width:{{usagePercent}}%"></div></div>
</div>
</div>

<div class="file-list">
<div class="file-list-header">
<div>文件名</div>
<div>大小</div>
<div>上传者</div>
<div>上传时间</div>
<div>状态</div>
<div>操作</div>
</div>
<div id="fileList"></div>
</div>
</div>

<script>
const files = {{fileList}};
const listEl = document.getElementById('fileList');

files.forEach(file => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = \`
        <div class="file-name">\${file.name} \${file.isChunked ? '<span style="color:#FFD700">[切片]</span>' : ''}</div>
        <div class="file-size">\${file.size}</div>
        <div class="file-uploader">\${file.uploadedBy}</div>
        <div class="file-date">\${file.uploadedAt}</div>
        <div class="file-status \${file.isExpired ? 'expired' : ''}">\${file.isExpired ? '已过期' : '有效'}</div>
        <div class="file-actions">
            <button onclick="deleteFile('\${file.id}')">删除</button>
        </div>
    \`;
    listEl.appendChild(div);
});

async function deleteFile(id) {
    if (!confirm('确定删除此文件？')) return;
    try {
        const resp = await fetch('/share/' + id, { method: 'DELETE' });
        const data = await resp.json();
        if (data.success) {
            alert('删除成功');
            location.reload();
        } else {
            alert('删除失败: ' + data.error);
        }
    } catch (e) {
        alert('错误: ' + e.message);
    }
}
</script>
</body>
</html>`;