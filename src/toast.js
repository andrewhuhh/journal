let toastContainer;

function createToastContainer() {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
}

function getContainer() {
    if (!toastContainer) {
        createToastContainer();
    }
    return toastContainer;
}

export function showToast(message, type = 'info', duration = 3000) {
    const container = getContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'error' ? 'error_outline' :
                type === 'success' ? 'check_circle_outline' : 'info_outline';
    
    toast.innerHTML = `
        <span class="material-icons-outlined">${icon}</span>
        <div class="toast-message">${message}</div>
        <button class="toast-close">
            <span class="material-icons-outlined">close</span>
        </button>
    `;
    
    // Add close handler
    const closeButton = toast.querySelector('.toast-close');
    const close = () => {
        toast.style.animation = 'toast-slide-out 0.3s ease forwards';
        setTimeout(() => {
            container.removeChild(toast);
            if (container.children.length === 0) {
                document.body.removeChild(container);
                toastContainer = null;
            }
        }, 300);
    };
    
    closeButton.addEventListener('click', close);
    
    // Auto close after duration
    if (duration > 0) {
        setTimeout(close, duration);
    }
    
    container.appendChild(toast);
    return toast;
} 