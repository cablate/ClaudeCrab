/**
 * ClaudeCab WebUI - Client-side JavaScript
 */

// Auto-dismiss alerts after 5 seconds
document.addEventListener('DOMContentLoaded', () => {
  const alerts = document.querySelectorAll('[role="alert"]');
  alerts.forEach((alert) => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.3s ease-out';
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  });
});

// Confirm dangerous actions
function confirmAction(message) {
  return confirm(message);
}

// Format date helper
function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-TW');
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    showToast('Failed to copy', 'error');
  }
}

// Simple toast notification
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg text-white ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  } shadow-lg z-50 transition-opacity duration-300`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// API helper
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'API request failed');
    }

    return data;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  }
}

// Auto-refresh stats (optional, disabled by default)
let refreshInterval = null;

function startAutoRefresh(intervalMs = 30000) {
  if (refreshInterval) return;

  refreshInterval = setInterval(async () => {
    try {
      const stats = await apiCall('/api/system/stats');
      // Update stats on page if elements exist
      updateStatsOnPage(stats);
    } catch {
      // Silently fail for background refresh
    }
  }, intervalMs);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

function updateStatsOnPage(stats) {
  // This can be extended to update specific elements
  // For now, just log the stats
  console.log('Stats updated:', stats);
}
