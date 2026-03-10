const API = '/api';

// ── Network Error Handling ────────────────────────────────────

// Fetch wrapper with timeout and error handling
async function fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please try again.');
        }
        throw error;
    }
}

// Retry wrapper for transient failures
async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fetchWithTimeout(url, options);
        } catch (error) {
            lastError = error;
            
            // Don't retry on certain errors
            if (error.message.includes('timed out') && attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            // Network errors - retry
            if (!navigator.onLine) {
                throw new Error('You appear to be offline. Please check your internet connection.');
            }
            
            throw error;
        }
    }
    
    throw lastError;
}

// ── Alert & Loading Utilities ─────────────────────────────────

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

// Track form submissions to prevent double-submission
const pendingSubmissions = new Set();

function setLoading(btnId, loading, originalText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    if (loading) {
        pendingSubmissions.add(btnId);
    } else {
        pendingSubmissions.delete(btnId);
    }
    
    btn.disabled = loading;
    btn.innerHTML = loading
        ? `<span class="spinner spinner-sm"></span> Please wait…`
        : originalText;
}

// Check if a form submission is already in progress
function isSubmitting(btnId) {
    return pendingSubmissions.has(btnId);
}

function authHeaders() {
    return { 'Content-Type': 'application/json' };
}

function adminAuthHeaders() {
    return { 'Content-Type': 'application/json' };
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        // Continue with logout even if server is unreachable
    }
    sessionStorage.clear();
    window.location.href = 'index.html';
}

async function adminLogout() {
    try {
        await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {
        // Continue with logout even if server is unreachable
    }
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
    
    // Handle online/offline events
    window.addEventListener('online', () => {
        const box = document.getElementById('alertBox');
        if (box && box.classList.contains('show')) {
            // Check if it's a network error that might be resolved
            if (box.textContent.includes('offline') || box.textContent.includes('network')) {
                hideAlert();
            }
        }
    });
    
    window.addEventListener('offline', () => {
        showAlert('You have lost internet connection. Some features may not work until you reconnect.', 'error');
    });
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Don't show generic errors to users - log them instead
});
