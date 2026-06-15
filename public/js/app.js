// 全局状态
let currentUser = null;

// 初始化
async function init() {
    console.log('[Init] 开始初始化');
    await checkLogin();
    console.log('[Init] 登录状态:', currentUser ? '已登录' : '未登录');
    
    renderNav();
    renderAuthButtons();
    initForms();
    handleUrlParams();
    
    // 如果在 dashboard 页面
    if (window.location.pathname === '/dashboard.html') {
        console.log('[Init] 当前在 dashboard 页面');
        if (!currentUser) {
            console.log('[Init] 未登录，跳转到登录页');
            window.location.href = '/login.html';
            return;
        }
        console.log('[Init] 已登录，显示用户名');
        displayUsername();
    }
}

// 检查登录状态
async function checkLogin() {
    const token = localStorage.getItem('hedwig_token');
    console.log('[CheckLogin] localStorage 中的 token:', token ? token.substring(0, 20) + '...' : '不存在');
    
    if (!token) return false;
    
    try {
        console.log('[CheckLogin] 请求 /api/current-user');
        const response = await fetch('/api/current-user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log('[CheckLogin] 响应状态:', response.status);
        const data = await response.json();
        console.log('[CheckLogin] 响应数据:', data);
        
        if (data && data.user && data.user.username) {
            currentUser = data.user;
            console.log('[CheckLogin] 登录成功，用户:', currentUser.username);
            return true;
        } else {
            console.log('[CheckLogin] Token 无效，清除');
            localStorage.removeItem('hedwig_token');
            localStorage.removeItem('hedwig_user');
            return false;
        }
    } catch (error) {
        console.error('[CheckLogin] 请求失败:', error);
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
    
    console.log('[Login] 用户名:', username);
    
    if (!username || !password) {
        showMessage(messageEl, '用户名和密码不能为空', 'error');
        return;
    }
    
    try {
        console.log('[Login] 发送登录请求');
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        console.log('[Login] 响应状态:', response.status);
        const data = await response.json();
        console.log('[Login] 响应数据:', data);
        
        if (response.ok && data.success) {
            // 保存登录信息
            localStorage.setItem('hedwig_token', data.token);
            localStorage.setItem('hedwig_user', JSON.stringify(data.user));
            console.log('[Login] Token 已保存');
            console.log('[Login] 即将跳转到 dashboard');
            // 跳转到控制台
            window.location.href = '/dashboard.html';
        } else {
            showMessage(messageEl, data.error || '登录失败', 'error');
        }
    } catch (error) {
        console.error('[Login] 错误:', error);
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
    
    // 跳转到注册入口
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
    console.log('[Logout] 退出登录');
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
    }
}

// 页面加载时运行
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOM] 页面加载完成');
    init();
});

// 暴露全局函数
window.logout = logout;