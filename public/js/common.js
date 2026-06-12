let currentUser = null;

async function checkLogin() {
    const token = localStorage.getItem('auth_token');
    if (!token) return false;
    
    try {
        const resp = await fetch('/api/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resp.ok) {
            const userInfo = localStorage.getItem('user_info');
            if (userInfo) {
                currentUser = JSON.parse(userInfo);
            } else {
                currentUser = await resp.json();
                localStorage.setItem('user_info', JSON.stringify(currentUser));
            }
            return true;
        } else {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
            return false;
        }
    } catch(e) {
        return false;
    }
}

function isLoggedIn() {
    return currentUser !== null;
}

function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
    currentUser = null;
    window.location.href = '/';
}

function getUser() {
    return currentUser;
}

function renderNavbar() {
    const user = currentUser;
    const userHtml = user
        ? `<div class="user-area">
            <img class="avatar" src="${user.avatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}" width="28" height="28" style="border-radius: 50%;">
            <span class="user-name">${user.username || user.login}</span>
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

async function initPage() {
    await checkLogin();
    const navbarPlaceholder = document.getElementById('navbar-placeholder');
    if (navbarPlaceholder) {
        navbarPlaceholder.innerHTML = renderNavbar();
    }
    
    // 更新用户标识
    const userBadge = document.getElementById('user-badge');
    if (userBadge) {
        if (isLoggedIn()) {
            userBadge.textContent = `已登录: ${currentUser.username}`;
            userBadge.className = 'badge user-badge';
        } else {
            userBadge.textContent = '未登录';
            userBadge.className = 'badge guest-badge';
        }
    }
}

function requireAuth(redirectUrl) {
    if (!isLoggedIn()) {
        window.location.href = redirectUrl || '/login.html';
        return false;
    }
    return true;
}

window.Hedwig = {
    checkLogin,
    getUser,
    isLoggedIn,
    logout,
    requireAuth,
    initPage
};

window.logout = logout;
