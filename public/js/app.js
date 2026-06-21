let currentUser = null;
let cookieConsent = false;

function checkCookieEnabled() {
    document.cookie = 'testcookie=1; SameSite=Strict';
    const enabled = document.cookie.indexOf('testcookie') !== -1;
    document.cookie = 'testcookie=1; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
    return enabled;
}

function showCookieConsent() {
    if (localStorage.getItem('cookieConsent') === 'accepted') {
        cookieConsent = true;
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'cookie-overlay';
    overlay.innerHTML = `
        <div style="
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.9); z-index: 99999;
            display: flex; align-items: center; justify-content: center;
        ">
            <div style="
                background: #1a1a2e; color: #eee; padding: 40px;
                border-radius: 16px; max-width: 480px; width: 90%;
                text-align: center; border: 1px solid #333;
            ">
                <div style="font-size: 48px; margin-bottom: 15px;"></div>
                <h2 style="margin: 0 0 15px 0; color: #7c8cff;">Cookie 使用提示</h2>
                <p style="margin: 0 0 25px 0; line-height: 1.6; font-size: 14px; color: #aaa;">
                    本网站使用 Cookie 来保存您的登录状态。<br>
                    没有 Cookie，您将无法登录和使用个性化功能。
                </p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="accept-cookie" style="
                        padding: 10px 28px; background: #4CAF50; color: white;
                        border: none; border-radius: 6px; cursor: pointer;
                        font-size: 15px;
                    ">同意使用</button>
                    <button id="reject-cookie" style="
                        padding: 10px 28px; background: transparent; color: #888;
                        border: 1px solid #555; border-radius: 6px; cursor: pointer;
                        font-size: 15px;
                    ">不同意</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('accept-cookie').addEventListener('click', () => {
        localStorage.setItem('cookieConsent', 'accepted');
        cookieConsent = true;
        overlay.remove();
        initApp();
    });

    document.getElementById('reject-cookie').addEventListener('click', () => {
        localStorage.setItem('cookieConsent', 'rejected');
        cookieConsent = false;
        overlay.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: #0a0a1a; z-index: 99999;
                display: flex; align-items: center; justify-content: center;
            ">
                <div style="text-align: center; color: #666;">
                    <div style="font-size: 64px; margin-bottom: 20px;"></div>
                    <h1 style="color: #7c8cff; margin-bottom: 15px;">访问已关闭</h1>
                    <p>您拒绝了 Cookie 使用，无法继续访问。</p>
                    <p style="font-size: 13px; margin-top: 20px;">请开启浏览器 Cookie 后刷新页面</p>
                </div>
            </div>
        `;
        document.body.style.overflow = 'hidden';
    });
}

async function initApp() {
    await checkLogin();
    renderNav();
    renderAuthButtons();
    initForms();
    handleUrlParams();
    initMessageBoard();

    if (window.location.pathname === '/dashboard.html') {
        if (!currentUser) {
            window.location.href = '/login.html';
            return;
        }
        displayUsername();
    }
}

async function init() {
    if (!checkCookieEnabled()) {
        document.body.innerHTML = `
            <div style="
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: #0a0a1a; display: flex; align-items: center; justify-content: center;
                color: #7c8cff; text-align: center; padding: 20px;
            ">
                <div>
                    <div style="font-size: 64px; margin-bottom: 20px;"></div>
                    <h1>Cookie 已禁用</h1>
                    <p style="color: #888;">请开启浏览器 Cookie 设置后刷新页面</p>
                </div>
            </div>
        `;
        return;
    }

    if (localStorage.getItem('cookieConsent') === 'accepted') {
        cookieConsent = true;
        await initApp();
    } else {
        showCookieConsent();
    }
}

async function checkLogin() {
    try {
        const response = await fetch('/api/current-user');
        const data = await response.json();
        if (data && data.user) {
            currentUser = data.user;
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

function renderNav() {
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    if (currentUser) {
        navLinks.innerHTML = `
            <span class="user-info">欢迎, ${currentUser.username}</span>
            <button onclick="logout()">退出登录</button>
        `;
    } else {
        navLinks.innerHTML = `
            <a href="/login.html">登录</a>
            <a href="/register.html">注册</a>
        `;
    }
}

function renderAuthButtons() {
    const authButtons = document.getElementById('authButtons');
    if (!authButtons) return;
    if (currentUser) {
        authButtons.innerHTML = `<a href="/dashboard.html" class="btn-primary">进入控制台</a>`;
    } else {
        authButtons.innerHTML = `
            <a href="/login.html" class="btn-primary">登录</a>
            <a href="/register.html" class="btn-primary">注册</a>
        `;
    }
}

function handleUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const registered = urlParams.get('registered');
    const error = urlParams.get('error');
    const messageEl = document.getElementById('message');
    if (!messageEl) return;
    if (registered === '1') {
        messageEl.textContent = '注册成功！请登录';
        messageEl.className = 'message success';
        messageEl.style.display = 'block';
        setTimeout(() => { messageEl.style.display = 'none'; }, 3000);
    } else if (error) {
        const errors = {
            '1': '注册失败，请重试',
            '2': '此GitHub账号已绑定其他用户',
            '3': '用户名已存在',
            '4': '保存数据失败'
        };
        messageEl.textContent = errors[error] || '未知错误';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
    }
}

function initForms() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    const registerForm = document.getElementById('registerForm');
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const messageEl = document.getElementById('message');
    if (!username || !password) {
        showMessage(messageEl, '用户名和密码不能为空', 'error');
        return;
    }
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (response.ok && data.success && data.redirect) {
            window.location.href = data.redirect;
        } else {
            showMessage(messageEl, data.error || '登录失败', 'error');
        }
    } catch (error) {
        showMessage(messageEl, '网络错误，请重试', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const messageEl = document.getElementById('message');
    if (!username || !password) {
        showMessage(messageEl, '用户名和密码不能为空', 'error');
        return;
    }
    if (password.length < 6) {
        showMessage(messageEl, '密码长度不能少于6位', 'error');
        return;
    }
    if (password !== confirmPassword) {
        showMessage(messageEl, '两次输入的密码不一致', 'error');
        return;
    }
    try {
        const response = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (response.redirected) {
            window.location.href = response.url;
        } else {
            const data = await response.json();
            showMessage(messageEl, data.error || '注册失败', 'error');
        }
    } catch (error) {
        showMessage(messageEl, '网络错误，请重试', 'error');
    }
}

function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    window.location.href = '/';
}

function displayUsername() {
    const usernameSpan = document.getElementById('username');
    if (usernameSpan && currentUser) {
        usernameSpan.textContent = currentUser.username;
    }
}

// ===== 留言板 =====
let allMessages = [];
let currentPage = 1;
let isListExpanded = false;
const PAGE_SIZE = 5;

function initMessageBoard() {
    const msgForm = document.getElementById('messageForm');
    const msgList = document.getElementById('messageList');
    const toggleBtn = document.getElementById('toggleListBtn');
    const listArea = document.getElementById('listArea');

    if (!msgForm || !msgList) return;

    // 展开/收起切换（控制整个 listArea：留言列表 + 分页）
    if (toggleBtn && listArea) {
        toggleBtn.addEventListener('click', () => {
            isListExpanded = !isListExpanded;
            toggleBtn.classList.toggle('expanded', isListExpanded);
            listArea.classList.toggle('collapsed', !isListExpanded);

            const toggleText = document.getElementById('toggleListText');
            if (toggleText) toggleText.textContent = isListExpanded ? '收起' : '展开';

            if (isListExpanded) {
                currentPage = 1;
                renderMessages();
            }
        });
    }

    // 分页按钮
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) prevBtn.addEventListener('click', () => changePage(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => changePage(1));

    loadMessages();

    msgForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('msgName');
        const contentInput = document.getElementById('msgContent');
        const name = nameInput ? nameInput.value.trim() : '';
        const content = contentInput.value.trim();

        if (!content) {
            alert('留言内容不能为空');
            return;
        }

        const submitBtn = msgForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = '发送中...';

        try {
            const response = await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, content })
            });
            const data = await response.json();
            if (data.success) {
                contentInput.value = '';
                await loadMessages();
                // 发送后如果列表是收起的，保持收起；如果展开，保持展开并跳到第一页
                if (isListExpanded) {
                    currentPage = 1;
                    renderMessages();
                }
            } else {
                alert(data.error || '发送失败');
            }
        } catch (error) {
            alert('网络错误');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '发送留言';
        }
    });
}

async function loadMessages() {
    const msgList = document.getElementById('messageList');
    const listArea = document.getElementById('listArea');
    const toggleBtn = document.getElementById('toggleListBtn');
    const listCount = document.getElementById('listCount');

    if (!msgList) return;

    msgList.innerHTML = '<div class="loading">加载中...</div>';

    try {
        const response = await fetch('/api/messages');
        const data = await response.json();
        allMessages = data.messages || [];

        // 更新留言数量显示
        if (listCount) {
            listCount.textContent = allMessages.length > 0 ? `共 ${allMessages.length} 条留言` : '';
        }

        if (allMessages.length === 0) {
            renderEmptyBoard();
            if (toggleBtn) toggleBtn.style.display = 'none';
            if (listArea) listArea.classList.add('collapsed');
            return;
        }

        if (toggleBtn) toggleBtn.style.display = 'flex';

        if (isListExpanded) {
            renderMessages();
        } else {
            // 收起状态：只显示最近5条，无分页
            renderCompactMessages();
        }
    } catch (error) {
        msgList.innerHTML = '<div class="no-messages">加载失败，请刷新重试</div>';
    }
}

function renderEmptyBoard() {
    const msgList = document.getElementById('messageList');
    const pagination = document.getElementById('pagination');

    if (!msgList) return;

    msgList.innerHTML = `
        <div class="empty-board">
            <div class="empty-icon">💬</div>
            <p>这里还没有留言</p>
            <p class="empty-hint">在上方写下第一条留言，开启交流吧</p>
        </div>
    `;
    if (pagination) pagination.style.display = 'none';
}

function renderCompactMessages() {
    const msgList = document.getElementById('messageList');
    const pagination = document.getElementById('pagination');

    if (!msgList) return;

    // 收起状态：只显示最近5条，不显示分页
    const displayMessages = allMessages.slice(0, PAGE_SIZE);
    msgList.innerHTML = displayMessages.map(msg => createMessageHTML(msg)).join('');
    if (pagination) pagination.style.display = 'none';
}

function renderMessages() {
    const msgList = document.getElementById('messageList');
    const pagination = document.getElementById('pagination');

    if (!msgList) return;

    const totalPages = Math.ceil(allMessages.length / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageMessages = allMessages.slice(start, end);

    msgList.innerHTML = pageMessages.map(msg => createMessageHTML(msg)).join('');

    // 更新分页
    if (pagination) {
        if (totalPages > 1) {
            pagination.style.display = 'flex';
            document.getElementById('pageInfo').textContent = `${currentPage} / ${totalPages}`;
            document.getElementById('prevPage').disabled = currentPage <= 1;
            document.getElementById('nextPage').disabled = currentPage >= totalPages;
        } else {
            pagination.style.display = 'none';
        }
    }
}

function createMessageHTML(msg) {
    return `
        <div class="message-item">
            <div class="message-header">
                <span class="message-name">${escapeHtml(msg.name)}</span>
                <span class="message-time">${formatTime(msg.timestamp)}</span>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        </div>
    `;
}

function changePage(delta) {
    const totalPages = Math.ceil(allMessages.length / PAGE_SIZE);
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderMessages();
        // 滚动到留言列表顶部
        document.getElementById('messageList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
}

document.addEventListener('DOMContentLoaded', init);
window.logout = logout;
