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
    const token = sessionStorage.getItem('token');
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

function adminAuthHeaders() {
    const token = sessionStorage.getItem('adminToken');
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

function logout() {
    sessionStorage.clear();
    window.location.href = 'index.html';
}

function adminLogout() {
    sessionStorage.removeItem('adminToken');
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
