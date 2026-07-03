/**
 * Backend Configuration for Digital Approval System
 * 
 * LOCAL: Automatically uses http://localhost:3000
 * PRODUCTION: Update BACKEND_URL to your Render backend URL
 * 
 * Example:
 * PRODUCTION_URL = 'https://digital-approval-api.onrender.com'
 */

// Detect environment and set backend URL
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  // Local development
  window.BACKEND_URL = 'http://localhost:3000';
} else {
  // Production - CHANGE THIS to your actual Render backend URL
  window.BACKEND_URL = 'https://digital-approval-api.onrender.com';
}

console.log('[Config] Backend URL:', window.BACKEND_URL);
