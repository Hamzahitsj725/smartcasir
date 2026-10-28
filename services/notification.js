/**
 * SIM-Market Enterprise - Notification & Toast Service
 * Sistem pemberitahuan toast modern pengganti alert() browser bawaan
 */

let toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'fixed top-5 right-5 z-[99999] flex flex-col gap-2.5 max-w-sm pointer-events-none';
            document.body.appendChild(toastContainer);
        }
    }
    return toastContainer;
}

export function showToast(message, type = 'info', duration = 3500) {
    const container = ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl text-sm font-medium shadow-2xl border backdrop-blur-md transition-all duration-300 transform translate-x-12 opacity-0`;

    let icon = 'fa-circle-info';
    let colorStyles = 'bg-slate-900/90 text-slate-100 border-slate-700/80 shadow-cyan-950/20';

    if (type === 'success') {
        icon = 'fa-circle-check';
        colorStyles = 'bg-slate-900/95 text-emerald-300 border-emerald-500/40 shadow-emerald-950/30';
    } else if (type === 'error') {
        icon = 'fa-circle-exclamation';
        colorStyles = 'bg-slate-900/95 text-rose-300 border-rose-500/40 shadow-rose-950/30';
    } else if (type === 'warning') {
        icon = 'fa-triangle-exclamation';
        colorStyles = 'bg-slate-900/95 text-amber-300 border-amber-500/40 shadow-amber-950/30';
    }

    toast.className += ` ${colorStyles}`;

    toast.innerHTML = `
        <i class="fa-solid ${icon} mt-0.5 text-base flex-shrink-0"></i>
        <div class="flex-1 text-xs leading-relaxed text-slate-200">${escapeHtml(message)}</div>
        <button class="text-slate-400 hover:text-slate-200 transition-colors ml-1 p-0.5">
            <i class="fa-solid fa-xmark text-xs"></i>
        </button>
    `;

    const closeBtn = toast.querySelector('button');
    const dismiss = () => {
        toast.classList.add('translate-x-12', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    };

    closeBtn.addEventListener('click', dismiss);

    container.appendChild(toast);

    // Animasi masuk
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    });

    // Otomatis hilang
    if (duration > 0) {
        setTimeout(dismiss, duration);
    }

    return dismiss;
}

// Global alert replacement jika dibutuhkan
export function notifyUser(message, type = 'info') {
    showToast(message, type);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
