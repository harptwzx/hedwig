let currentUser = null;

async function checkLogin() {
    const token = localStorage.getItem('auth_token');
    if (!token) return false;
    try {
        const resp = await fetch('/api/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resp.ok) {
            currentUser = await resp.json();
            return true;
        } else {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
            return false;
        }
    } catch(e) { return false; }
}

function isLoggedIn() { return currentUser !== null; }
function getUser() { return currentUser; }
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
    currentUser = null;
    window.location.href = '/';
}

function renderNavbar() {
    const user = currentUser;
    if (user) {
        return `<div class="navbar"><div class="nav-container">
            <a href="/" class="logo">Hedwig</a>
            <div class="user-area">
                <span>${user.username}</span>
                <button onclick="logout()">退出</button>
            </div>
        </div></div>`;
    } else {
        return `<div class="navbar"><div class="nav-container">
            <a href="/" class="logo">Hedwig</a>
            <div class="user-area">
                <a href="/login.html">登录</a>
                <a href="/register.html">注册</a>
            </div>
        </div></div>`;
    }
}

async function initPage() {
    await checkLogin();
    const placeholder = document.getElementById('navbar-placeholder');
    if (placeholder) placeholder.innerHTML = renderNavbar();
}

window.Hedwig = { checkLogin, getUser, isLoggedIn, logout, initPage };
window.logout = logout;