const API = '/api';

function showAlert(msg, type = 'error') {
    const box = document.getElementById('alertBox');
    if (!box) return;
    box.textContent = msg;
    box.className = `alert ${type} show`;
}

function hideAlert() {
    const box = document.getElementById('alertBox');
    if (box) box.className = 'alert';
}

function setLoading(btnId, loading, originalText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
        ? `<span class="spinner spinner-sm"></span> Please wait…`
        : originalText;
}

function authHeaders() {
    return { 'Content-Type': 'application/json' };
}

function adminAuthHeaders() {
    return { 'Content-Type': 'application/json' };
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    sessionStorage.clear();
    window.location.href = 'index.html';
}

async function adminLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    sessionStorage.removeItem('adminLoggedIn');
    window.location.href = 'admin-login.html';
}

// Global modal handlers
function closeModal(e) {
    if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('open');
}

// If modal code exists in current page
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        overlay.onclick = closeModal;
    }
});
