let currentUser = null;

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

document.addEventListener('DOMContentLoaded', init);
window.logout = logout;