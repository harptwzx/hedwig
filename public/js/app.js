// 全局状态
let currentUser = null;

// 调试日志函数
function debugLog(msg) {
    const debugDiv = document.getElementById('debug-info');
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${msg}`);
    if (debugDiv) {
        let currentContent = debugDiv.innerHTML;
        // 如果内容太长，只保留最近20条
        const lines = currentContent.split('<br>');
        if (lines.length > 25) {
            currentContent = lines.slice(-20).join('<br>');
        }
        debugDiv.innerHTML = currentContent + `<br>${timestamp} - ${msg}`;
    }
}

// 初始化
async function init() {
    debugLog('=== 页面初始化开始 ===');
    debugLog('当前路径: ' + window.location.pathname);
    debugLog('localStorage 中的 token: ' + (localStorage.getItem('hedwig_token') ? '存在' : '不存在'));
    
    await checkLogin();
    
    debugLog('登录状态: ' + (currentUser ? '已登录' : '未登录'));
    if (currentUser) {
        debugLog('当前用户: ' + JSON.stringify(currentUser));
    }
    
    renderNav();
    renderAuthButtons();
    initForms();
    handleUrlParams();
    
    // 如果在 dashboard 页面
    if (window.location.pathname === '/dashboard.html') {
        debugLog('当前在 dashboard 页面');
        if (!currentUser) {
            debugLog('⚠️ 未登录，3秒后跳转到登录页');
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 3000);
        } else {
            debugLog('✅ 已登录，显示用户名');
            displayUsername();
        }
    }
}

// 检查登录状态
async function checkLogin() {
    const token = localStorage.getItem('hedwig_token');
    debugLog('检查登录 - Token: ' + (token ? token.substring(0, 30) + '...' : '无'));
    
    if (!token) {
        debugLog('❌ 没有 token');
        return false;
    }
    
    try {
        debugLog('请求 /api/current-user...');
        const response = await fetch('/api/current-user', {
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'same-origin'
        });
        
        debugLog('响应状态码: ' + response.status);
        
        // 获取原始响应文本
        const responseText = await response.text();
        debugLog('原始响应: ' + responseText);
        
        let data;
        try {
            data = JSON.parse(responseText);
            debugLog('JSON 解析成功');
        } catch (e) {
            debugLog('❌ JSON 解析失败: ' + e.message);
            return false;
        }
        
        // 根据返回结构判断
        if (data && data.user) {
            if (data.user.username) {
                currentUser = data.user;
                debugLog('✅ 登录有效，用户: ' + currentUser.username);
                return true;
            }
        } else if (data && data.username) {
            // 如果直接返回用户对象
            currentUser = data;
            debugLog('✅ 登录有效，用户: ' + currentUser.username);
            return true;
        } else if (data && data.success === false) {
            debugLog('❌ API 返回失败: ' + (data.error || '未知错误'));
            localStorage.removeItem('hedwig_token');
            localStorage.removeItem('hedwig_user');
            return false;
        } else {
            debugLog('❌ 响应格式未知: ' + JSON.stringify(data));
            return false;
        }
    } catch (error) {
        debugLog('❌ 请求异常: ' + error.message);
        return false;
    }
}

// 渲染导航栏
function renderNav() {
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    
    if (currentUser) {
        navLinks.innerHTML = `
            <span class="user-info">
                欢迎, ${currentUser.username}
            </span>
            <button onclick="window.logout()">退出登录</button>
        `;
    } else {
        navLinks.innerHTML = `
            <a href="/login.html">登录</a>
            <a href="/register.html">注册</a>
        `;
    }
}

// 渲染首页按钮
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

// 处理 URL 参数
function handleUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const messageEl = document.getElementById('message');
    
    if (!messageEl) return;
    
    if (success === '1') {
        messageEl.textContent = '注册成功！正在跳转登录页...';
        messageEl.className = 'message success';
        messageEl.style.display = 'block';
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 2000);
    } else if (error === '1') {
        messageEl.textContent = '注册失败，请重试';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
    } else if (error === '2') {
        messageEl.textContent = '此GitHub账号已绑定其他用户';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
    } else if (error === '3') {
        messageEl.textContent = '用户名已存在';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
    } else if (error === '4') {
        messageEl.textContent = '保存数据失败';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
    }
}

// 初始化表单
function initForms() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
}

// 处理本地登录
async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const messageEl = document.getElementById('message');
    
    debugLog('=== 登录请求 ===');
    debugLog('用户名: ' + username);
    
    if (!username || !password) {
        showMessage(messageEl, '用户名和密码不能为空', 'error');
        return;
    }
    
    try {
        debugLog('发送 POST /api/login');
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        debugLog('响应状态: ' + response.status);
        const data = await response.json();
        debugLog('响应数据: ' + JSON.stringify(data));
        
        if (response.ok && data.success) {
            // 保存登录信息
            localStorage.setItem('hedwig_token', data.token);
            localStorage.setItem('hedwig_user', JSON.stringify(data.user));
            debugLog('Token 已保存，跳转到 /dashboard.html');
            window.location.href = '/dashboard.html';
        } else {
            showMessage(messageEl, data.error || '登录失败', 'error');
        }
    } catch (error) {
        debugLog('❌ 错误: ' + error.message);
        showMessage(messageEl, '网络错误，请重试', 'error');
    }
}

// 处理注册
function handleRegister(e) {
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
    
    window.location.href = `/auth/register?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

// 显示消息
function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = `message ${type}`;
    el.style.display = 'block';
    
    setTimeout(() => {
        if (el.style.display === 'block') {
            el.style.display = 'none';
        }
    }, 3000);
}

// 退出登录
function logout() {
    debugLog('退出登录');
    localStorage.removeItem('hedwig_token');
    localStorage.removeItem('hedwig_user');
    currentUser = null;
    window.location.href = '/';
}

// 显示用户名
function displayUsername() {
    const usernameSpan = document.getElementById('username');
    if (usernameSpan && currentUser) {
        usernameSpan.textContent = currentUser.username;
        debugLog('显示用户名: ' + currentUser.username);
    }
}

// 页面加载时运行
document.addEventListener('DOMContentLoaded', () => {
    debugLog('DOM 加载完成');
    init();
});

// 暴露全局函数
window.logout = logout;