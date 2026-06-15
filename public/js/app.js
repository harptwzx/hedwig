// 全局状态
let currentUser = null;

// 初始化
async function init() {
    await checkLogin();
    renderNav();
    renderAuthButtons();
    initForms();
    handleUrlParams();
    
    if (window.location.pathname === '/dashboard.html') {
        if (!currentUser) {
            window.location.href = '/login.html';
            return;
        }
        displayUsername();
    }
}

// 检查登录状态（通过 Cookie）
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

// 渲染导航栏
function renderNav() {
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    
    if (currentUser) {
        navLinks.innerHTML = `
            <span class="user-info">
                欢迎, ${currentUser.username}
            </span>
            <button onclick="logout()">退出登录</button>
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
    const registered = urlParams.get('registered');
    const error = urlParams.get('error');
    const messageEl = document.getElementById('message');
    
    if (!messageEl) return;
    
    if (registered === '1') {
        messageEl.textContent = '注册成功！请登录';
        messageEl.className = 'message success';
        messageEl.style.display = 'block';
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, 3000);
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
        
        if (response.ok && data.success) {
            // Cookie 已由服务器设置，只需跳转
            window.location.href = data.redirect;
        } else {
            showMessage(messageEl, data.error || '登录失败', 'error');
        }
    } catch (error) {
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
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    window.location.href = '/';
}

// 显示用户名
function displayUsername() {
    const usernameSpan = document.getElementById('username');
    if (usernameSpan && currentUser) {
        usernameSpan.textContent = currentUser.username;
    }
}

// 页面加载时运行
document.addEventListener('DOMContentLoaded', () => {
    init();
});

window.logout = logout;