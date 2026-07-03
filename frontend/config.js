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
const localHosts = ['localhost', '127.0.0.1', ''];
const localNetwork = /^(10|192\.168|172\.(1[6-9]|2[0-9]|3[0-1]))\./;
const hostname = window.location.hostname || '';
if (localHosts.includes(hostname) || localNetwork.test(hostname)) {
  // Local development or LAN access
  window.BACKEND_URL = 'http://localhost:3000';
} else {
  // Production - CHANGE THIS to your actual Render backend URL
  window.BACKEND_URL = 'https://digital-approval-api.onrender.com';
}

console.log('[Config] Backend URL:', window.BACKEND_URL);
