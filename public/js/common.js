let currentUser = null;

const CONFIG = {
    WORKER_URL: ''
};

async function checkLogin() {
    const token = localStorage.getItem('github_token');
    if (!token) return false;
    
    try {
        const resp = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resp.ok) {
            currentUser = await resp.json();
            return true;
        } else {
            localStorage.removeItem('github_token');
            return false;
        }
    } catch(e) {
        return false;
    }
}

function getUser() {
    return currentUser;
}

function isLoggedIn() {
    return currentUser !== null;
}

function logout() {
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_user');
    currentUser = null;
    window.location.href = '/';
}

function renderNavbar() {
    const user = currentUser;
    const userHtml = user
        ? `<div class="user-area">
            <span class="user-name">${user.login}</span>
            <button class="btn-logout" onclick="window.logout()">退出</button>
           </div>`
        : `<div class="user-area">
            <a href="/login.html" class="btn-login">登录</a>
           </div>`;
    
    return `
        <div class="navbar">
            <div class="nav-container">
                <a href="/" class="logo">Hedwig</a>
                ${userHtml}
            </div>
        </div>
    `;
}

function protectElement(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.style.display = isLoggedIn() ? 'block' : 'none';
    }
}

function showGuestMessage(containerId, message) {
    const container = document.getElementById(containerId);
    if (container && !isLoggedIn()) {
        const guestDiv = document.createElement('div');
        guestDiv.className = 'card';
        guestDiv.style.textAlign = 'center';
        guestDiv.style.color = '#94a3b8';
        guestDiv.innerHTML = message || '请登录后查看此内容';
        container.appendChild(guestDiv);
    }
}

function requireAuth(redirectUrl) {
    if (!isLoggedIn()) {
        window.location.href = redirectUrl || '/login.html';
        return false;
    }
    return true;
}

async function initPage() {
    await checkLogin();
    const navbarPlaceholder = document.getElementById('navbar-placeholder');
    if (navbarPlaceholder) {
        navbarPlaceholder.innerHTML = renderNavbar();
    }
    
    const userBadge = document.getElementById('user-badge');
    if (userBadge) {
        if (isLoggedIn()) {
            userBadge.textContent = `已登录: ${currentUser.login}`;
            userBadge.className = 'badge user-badge';
        } else {
            userBadge.textContent = '访客模式';
            userBadge.className = 'badge guest-badge';
        }
    }
}

window.Hedwig = {
    checkLogin,
    getUser,
    isLoggedIn,
    logout,
    protectElement,
    showGuestMessage,
    requireAuth,
    initPage
};

window.logout = logout;
