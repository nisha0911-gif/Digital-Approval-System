const express = require('express');
const emailjs = require('@emailjs/nodejs');
const path = require('path');
const cors = require('cors');
const os = require('os');
require('dotenv').config();

// EmailJS Configuration
let EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || 'service_mljgocg';
let EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || 'template_5247c1b';
let EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || '8D4DbJIrZjOPCHD2t';
let EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || '';
let EMAILJS_USER_EMAIL = 'nishasubramani2021@gmail.com';

let emailConfig = {
  service_id: EMAILJS_SERVICE_ID,
  template_id: EMAILJS_TEMPLATE_ID,
  public_key: EMAILJS_PUBLIC_KEY,
  has_private_key: !!EMAILJS_PRIVATE_KEY
};

// Initialize EmailJS
const initEmailJS = () => {
  const initConfig = {
    publicKey: EMAILJS_PUBLIC_KEY
  };
  if (EMAILJS_PRIVATE_KEY) {
    initConfig.privateKey = EMAILJS_PRIVATE_KEY;
  }
  emailjs.init(initConfig);
};
initEmailJS();

function getLocalNetworkAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

const PORT = process.env.PORT || 3000;
const LOCAL_SERVER_URL = (() => {
  const localIp = getLocalNetworkAddress();
  if (localIp) {
    return `http://${localIp}:${PORT}`;
  }
  return `http://localhost:${PORT}`;
})();
const SERVER_URL = process.env.SERVER_URL && !process.env.SERVER_URL.includes('ngrok')
  ? process.env.SERVER_URL
  : LOCAL_SERVER_URL;
if (process.env.SERVER_URL && process.env.SERVER_URL.includes('ngrok')) {
  console.log('⚠️ Ignoring ngrok SERVER_URL to keep links local-network only');
}
console.log(`🌐 Server URL for email links: ${SERVER_URL}`);

// Mock Firebase implementation for demo purposes
class MockFirestore {
  constructor() {
    this.data = {
      users: new Map(),
      requests: new Map()
    };
  }

  collection(name) {
    const self = this;
    return {
      doc: (id) => ({
        get: async () => {
          const collection = self.data[name];
          const doc = collection.get(id);
          return {
            exists: !!doc,
            data: () => doc
          };
        },
        set: async (data) => {
          self.data[name].set(id, { ...data, id });
        },
        update: async (updates) => {
          const existing = self.data[name].get(id);
          if (existing) {
            self.data[name].set(id, { ...existing, ...updates });
          }
        }
      }),
      add: async (data) => {
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        self.data[name].set(id, { ...data, id });
        return { id };
      },
      get: async () => {
        const results = [];
        for (const [id, doc] of self.data[name]) {
          results.push({
            id,
            data: () => doc
          });
        }
        // Add forEach method to results for compatibility
        results.forEach = Array.prototype.forEach;
        return results;
      },
      where: (field, op, value) => ({
        orderBy: (orderField, direction) => ({
          get: async () => {
            const results = [];
            for (const [id, doc] of self.data[name]) {
              if (doc[field] === value) {
                results.push({
                  id,
                  data: () => doc
                });
              }
            }
            return results;
          }
        })
      })
    };
  }
}

const db = new MockFirestore();

const app = express();

// CORS Configuration - Allow requests from Vercel frontend
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  process.env.FRONTEND_URL || '',
].filter(url => url); // Remove empty strings

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('vercel.app') || origin.includes('onrender.com')) {
      callback(null, true);
    } else {
      // Log unexpected origins but still allow (for testing)
      console.log(`⚠️ CORS request from: ${origin}`);
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SSE clients for live updates
const sseClients = {}; // reqId -> [res]

app.get('/api/updates/:reqId', (req, res) => {
  const reqId = req.params.reqId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  if (!sseClients[reqId]) sseClients[reqId] = [];
  sseClients[reqId].push(res);

  req.on('close', () => {
    sseClients[reqId] = sseClients[reqId].filter(client => client !== res);
    if (sseClients[reqId].length === 0) delete sseClients[reqId];
  });

  // Send initial data
  db.collection('requests').doc(reqId).get().then(doc => {
    if (doc.exists) {
      const data = doc.data();
      res.write(`data: ${JSON.stringify({ type: 'status', status: data.status, authorities: data.authorities, updatedBy: null, action: null })}\n\n`);
    }
  }).catch(err => console.error('SSE initial data error:', err));
});

// Email system using EmailJS (real emails)
const sentEmails = []; // Store sent emails for tracking

function generateRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sendEmailToAuthority(req, authData, requestData, requestId, resend = false) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
    console.warn(`⚠️ EmailJS not configured - cannot send to ${authData.email}`);
    return { email: authData.email, success: false, error: 'EmailJS is not configured' };
  }

  // Use configured SERVER_URL for email links (works across network)
  const baseUrl = SERVER_URL;
  const approveLink = `${baseUrl}/api/action?data=${encodeURIComponent(Buffer.from(JSON.stringify({ r: requestId, a: authData.id, v: 'approved' })).toString('base64'))}`;
  const rejectLink = `${baseUrl}/api/action?data=${encodeURIComponent(Buffer.from(JSON.stringify({ r: requestId, a: authData.id, v: 'rejected' })).toString('base64'))}`;
  const letterHTML = generateLetterHTML(requestData, authData);

  console.log(`📧 Preparing email for ${authData.name} <${authData.email}>`);
  console.log(`   Request ID: ${requestId}, Authority ID: ${authData.id}`);
  console.log(`   Links will use: ${baseUrl}`);

  try {
    const emailResult = await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        email: authData.email,
        to_email: authData.email,
        to_name: authData.name,
        from_email: EMAILJS_USER_EMAIL,
        reply_to: EMAILJS_USER_EMAIL,
        student_name: requestData.name,
        student_regno: requestData.regno || 'N/A',
        student_dept: requestData.dept,
        student_year: requestData.year || 'N/A',
        student_mobile: requestData.mobile,
        student_role: requestData.role,
        institution: requestData.inst,
        permission_type: requestData.ptype,
        request_date: requestData.date,
        out_time: requestData.outT || 'N/A',
        in_time: requestData.inT || 'N/A',
        reason: requestData.reason,
        request_id: requestId,
        approve_link: approveLink,
        reject_link: rejectLink,
        letter_html: letterHTML,
        current_date: new Date().toLocaleDateString(),
        current_time: new Date().toLocaleTimeString()
      },
      {
        publicKey: EMAILJS_PUBLIC_KEY,
        ...(EMAILJS_PRIVATE_KEY ? { privateKey: EMAILJS_PRIVATE_KEY } : {})
      }
    );

    const sentEmail = {
      id: Date.now() + Math.random(),
      to: authData.email,
      subject: `Permission Request: ${requestData.ptype} - ${requestData.name}`,
      sentAt: new Date().toISOString(),
      requestId,
      authorityId: authData.id,
      authorityName: authData.name,
      emailjsId: emailResult && emailResult.text ? emailResult.text : null,
      resend
    };

    sentEmails.push(sentEmail);
    console.log(`✅ Email successfully sent to ${authData.email}`);
    return { email: authData.email, success: true, emailjsId: sentEmail.emailjsId };
  } catch (emailError) {
    console.error(`❌ Email sending failed for ${authData.email}:`, emailError);
    const errorMessage = emailError && typeof emailError === 'object'
      ? (emailError.message || JSON.stringify(emailError))
      : String(emailError);
    return { email: authData.email, success: false, error: errorMessage };
  }
}

app.post('/api/update-status', async (req, res) => {
  try {
    const { requestId, authId, status } = req.body;
    console.log(`🔄 Update request: ${requestId}, Auth: ${authId}, Status: ${status}`);
    
    const doc = await db.collection('requests').doc(requestId).get();
    if (!doc.exists) {
      console.warn(`❌ Request not found: ${requestId}`);
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const request = doc.data();
    
    // VERIFY: Authority is authorized to approve this request
    const authIndex = request.authorities.findIndex(a => a.id === authId);
    if (authIndex < 0) {
      console.warn(`❌ Authority ${authId} NOT authorized for request ${requestId}`);
      return res.status(403).json({ error: 'Not authorized to approve this request' });
    }
    
    if (request.authorities[authIndex].status !== 'pending') {
      console.warn(`⚠️ Authority already responded: ${request.authorities[authIndex].status}`);
      return res.status(400).json({ error: `Already ${request.authorities[authIndex].status}` });
    }
    
    request.authorities[authIndex].status = status;
    request.authorities[authIndex].respondedAt = new Date().toISOString();
    const auths = request.authorities;
    const tot = auths.length;
    const appr = auths.filter(a => a.status === 'approved').length;
    const rej = auths.some(a => a.status === 'rejected');
    request.status = rej ? 'rejected' : appr === tot ? 'approved' : 'pending';
    request.updatedAt = new Date().toISOString();
    await db.collection('requests').doc(requestId).set(request);

    console.log(`✅ Status updated: ${appr}/${tot} approved, Final status: ${request.status}`);

    // Send live update to SSE clients
    if (sseClients[requestId]) {
      sseClients[requestId].forEach(client => {
        try {
          client.write(`data: ${JSON.stringify({ type: 'status', status: request.status, authorities: request.authorities, updatedBy: authId, action: status })}\n\n`);
        } catch (e) {
          console.error('SSE send error:', e);
        }
      });
    }

    res.json({ success: true, status: request.status, message: `${appr}/${tot} approved` });
  } catch (error) {
    console.error('❌ Update status error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/api/requests', async (req, res) => {
  try {
    const { submittedBy } = req.query;
    console.log(`📥 /api/requests called - submittedBy: ${submittedBy}`);
    
    const snapshot = await db.collection('requests').get();
    const requests = [];
    
    if (Array.isArray(snapshot)) {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!submittedBy || data.submittedBy === submittedBy) {
          requests.push({ id: doc.id, ...data });
        }
      });
    } else if (snapshot && typeof snapshot.forEach === 'function') {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!submittedBy || data.submittedBy === submittedBy) {
          requests.push({ id: doc.id, ...data });
        }
      });
    }
    
    console.log(`✅ Returning ${requests.length} request(s)`);
    res.json(requests);
  } catch (error) {
    console.error('❌ Get requests error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/api/action', async (req, res) => {
  const raw = req.query.data;
  if (!raw) return res.status(400).send('<h1>Invalid link</h1>');
  try {
    const d = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString());
    const { r: requestId, a: authId, v: action } = d;
    const doc = await db.collection('requests').doc(requestId).get();
    if (!doc.exists) {
      return res.send('<h1>Request not found</h1>');
    }
    const request = doc.data();
    const authIndex = request.authorities.findIndex(a => a.id === authId);
    if (authIndex < 0) {
      return res.send('<h1>Authority not found</h1>');
    }
    if (request.authorities[authIndex].status !== 'pending') {
      return res.send(`<h1>Already ${request.authorities[authIndex].status}</h1>`);
    }
    request.authorities[authIndex].status = action;
    const auths = request.authorities;
    const tot = auths.length;
    const appr = auths.filter(a => a.status === 'approved').length;
    const rej = auths.some(a => a.status === 'rejected');
    request.status = rej ? 'rejected' : appr === tot ? 'approved' : 'pending';
    request.updatedAt = new Date().toISOString();
    await db.collection('requests').doc(requestId).set(request);

    // Send live update to SSE clients
    if (sseClients[requestId]) {
      sseClients[requestId].forEach(client => {
        try {
          client.write(`data: ${JSON.stringify({ type: 'status', status: request.status, authorities: request.authorities, updatedBy: authId, action: action })}\n\n`);
        } catch (e) {
          console.error('SSE send error:', e);
        }
      });
    }

    const icon = action === 'approved' ? '✅' : '❌';
    const title = action === 'approved' ? 'Approved' : 'Rejected';
    res.send(`
      <html>
      <head>
        <title>Action Recorded</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f4ff; }
          h1 { color: #2563eb; }
          p { color: #475569; }
        </style>
      </head>
      <body>
        <h1>${icon} ${title}</h1>
        <p>Your response has been recorded successfully.</p>
        <p>Request ID: ${requestId}</p>
        <p>You can close this window.</p>
      </body>
      </html>
    `);
  } catch (e) {
    console.error('Action error:', e);
    res.send('<h1>Invalid link</h1>');
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Digital Approval System Backend is running with EmailJS',
    timestamp: new Date().toISOString(),
    version: '2.2.0',
    emailMode: 'emailjs',
    configured: !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY)
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    configured: !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY),
    emailConfig
  });
});

app.post('/api/config', (req, res) => {
  const { service_id, template_id, public_key, private_key } = req.body || {};
  if (!service_id || !template_id || !public_key) {
    return res.status(400).json({ error: 'service_id, template_id and public_key are required' });
  }
  EMAILJS_SERVICE_ID = service_id;
  EMAILJS_TEMPLATE_ID = template_id;
  EMAILJS_PUBLIC_KEY = public_key;
  EMAILJS_PRIVATE_KEY = private_key || EMAILJS_PRIVATE_KEY;
  emailConfig = {
    service_id,
    template_id,
    public_key,
    has_private_key: !!EMAILJS_PRIVATE_KEY
  };
  initEmailJS();
  res.json({ configured: true, emailConfig });
});

app.post('/api/submit', async (req, res) => {
  try {
    const request = req.body.request || req.body;
    if (!request || !request.authorities || !request.authorities.length) {
      return res.status(400).json({ error: 'Request payload is missing required authorities' });
    }

    const requestData = {
      ...request,
      submittedBy: request.mobile,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log(`📝 Creating new request with ${requestData.authorities.length} authorities`);
    const docRef = await db.collection('requests').add(requestData);
    const requestId = docRef.id;
    console.log(`✅ Request created with ID: ${requestId}`);

    console.log(`📧 Sending emails to authorities...`);
    const results = await Promise.all(requestData.authorities.map(async (auth) => {
      const defaultAuth = AUTHS.find(x => x.id === auth.id) || {};
      const authData = { ...defaultAuth, ...auth };
      console.log(`  → Sending to ${authData.email} (${authData.name})`);
      return sendEmailToAuthority(req, authData, requestData, requestId);
    }));

    const sentCount = results.filter(r => r.success).length;
    const failedEmails = results.filter(r => !r.success);
    
    console.log(`📊 Email results: ${sentCount}/${requestData.authorities.length} sent`);
    if(failedEmails.length > 0){
      console.log(`❌ Failed emails:`, failedEmails);
    }
    
    res.json({
      success: true,
      requestId,
      results,
      sentCount,
      message: `${sentCount}/${requestData.authorities.length} emails processed`
    });
  } catch (error) {
    console.error('❌ Submit error:', error);
    res.status(500).json({ error: 'Failed to submit request', details: error.message });
  }
});

app.post('/api/resend', async (req, res) => {
  try {
    const { requestId, authId } = req.body || {};
    if (!requestId || !authId) {
      return res.status(400).json({ error: 'requestId and authId are required' });
    }

    const doc = await db.collection('requests').doc(requestId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const requestData = doc.data();
    const auth = requestData.authorities.find(a => a.id === authId);
    if (!auth) {
      return res.status(404).json({ error: 'Authority not found' });
    }

    const authData = { ...(AUTHS.find(x => x.id === authId) || {}), ...auth };
    const result = await sendEmailToAuthority(req, authData, requestData, requestId, true);
    res.json({ ok: result.success, result });
  } catch (error) {
    console.error('Resend error:', error);
    res.status(500).json({ error: 'Failed to resend email' });
  }
});

app.get('/api/updates/:reqId', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendUpdate = async () => {
    const doc = await db.collection('requests').doc(req.params.reqId).get();
    if (!doc.exists) {
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'not_found' })}\n\n`);
      return;
    }
    const requestData = doc.data();
    res.write(`data: ${JSON.stringify({ type: 'status', status: requestData.status, authorities: requestData.authorities })}\n\n`);
  };

  await sendUpdate();
  const interval = setInterval(sendUpdate, 1000);
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// API Endpoints

// Profile endpoints
app.get('/api/profile/:mobile', async (req, res) => {
  try {
    const user = await db.collection("users").doc(req.params.mobile).get();
    if (user.exists) {
      res.json(user.data());
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (e) {
    console.error('Error fetching profile:', e);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    const { inst, name, dept, regno, year, mobile, role } = req.body;
    const userRef = db.collection("users").doc(mobile);
    await userRef.set({
      inst, name, dept, regno, year, mobile, role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Error saving profile:', e);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// Request endpoints
app.get('/api/requests/:mobile', async (req, res) => {
  try {
    const snapshot = await db.collection("requests")
      .where("mobile", "==", req.params.mobile)
      .orderBy("createdAt", "desc")
      .get();

    const requests = [];
    snapshot.forEach(doc => {
      requests.push({ id: doc.id, ...doc.data() });
    });
    res.json(requests);
  } catch (e) {
    console.error('Error fetching requests:', e);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get specific request status for polling
app.get('/api/status/:reqId', async (req, res) => {
  try {
    const doc = await db.collection("requests").doc(req.params.reqId).get();
    if (!doc.exists) return res.status(404).json({ error: "Request not found" });

    const request = doc.data();
    const totalAuthorities = request.authorities.length;
    const approvedCount = request.authorities.filter(a => a.status === 'approved').length;
    const rejectedCount = request.authorities.filter(a => a.status === 'rejected').length;
    const pendingCount = request.authorities.filter(a => a.status === 'pending').length;

    res.json({
      ...request,
      progress: {
        total: totalAuthorities,
        approved: approvedCount,
        rejected: rejectedCount,
        pending: pendingCount,
        status: request.status
      }
    });
  } catch (e) {
    console.error('Error fetching request status:', e);
    res.status(500).json({ error: 'Failed to fetch request status' });
  }
});

// Authorities list
const AUTHS = [
  { id: 'class_advisor', name: 'Class Advisor', icon: '👩‍🏫', cat: 'College' },
  { id: 'mentor', name: 'Mentor', icon: '🧑‍💼', cat: 'College' },
  { id: 'hod', name: 'HOD', icon: '🏛️', cat: 'College' },
  { id: 'vice_principal', name: 'Vice Principal', icon: '🎓', cat: 'College' },
  { id: 'principal', name: 'Principal', icon: '🎩', cat: 'College' },
  { id: 'dean', name: 'Dean', icon: '📚', cat: 'College' },
  { id: 'registrar', name: 'Registrar', icon: '📋', cat: 'College' },
  { id: 'gate_pass', name: 'Gate Pass Incharge', icon: '🚪', cat: 'College' },
  { id: 'placement', name: 'Placement Officer', icon: '💼', cat: 'College' },
  { id: 'lab_incharge', name: 'Lab Incharge', icon: '🔬', cat: 'College' },
  { id: 'warden', name: 'Warden', icon: '🏠', cat: 'College' },
  { id: 'coordinator', name: 'Coordinator', icon: '📌', cat: 'College' },
  { id: 'sports_director', name: 'Sports Director', icon: '🏅', cat: 'College' },
  { id: 'nss_officer', name: 'NSS Officer', icon: '🌿', cat: 'College' },
  { id: 'team_lead', name: 'Team Lead', icon: '👤', cat: 'Corporate' },
  { id: 'manager', name: 'Manager', icon: '🗂️', cat: 'Corporate' },
  { id: 'sr_manager', name: 'Senior Manager', icon: '📊', cat: 'Corporate' },
  { id: 'hr_exec', name: 'HR Executive', icon: '🧑‍💼', cat: 'Corporate' },
  { id: 'hr_mgr', name: 'HR Manager', icon: '🏢', cat: 'Corporate' },
  { id: 'project_mgr', name: 'Project Manager', icon: '📁', cat: 'Corporate' },
  { id: 'dept_head', name: 'Department Head', icon: '🏛️', cat: 'Corporate' },
  { id: 'director', name: 'Director', icon: '🎯', cat: 'Corporate' },
  { id: 'ceo', name: 'CEO / MD', icon: '👔', cat: 'Corporate' },
  { id: 'supervisor', name: 'Supervisor', icon: '🔧', cat: 'Company' },
  { id: 'site_incharge', name: 'Site Incharge', icon: '🏗️', cat: 'Company' },
  { id: 'admin_officer', name: 'Admin Officer', icon: '📑', cat: 'Company' },
  { id: 'safety_officer', name: 'Safety Officer', icon: '🦺', cat: 'Company' },
  { id: 'gen_mgr', name: 'General Manager', icon: '🌐', cat: 'Company' },
];

function generateLetterHTML(reqData, authData) {
  const currentDate = new Date().toLocaleDateString();
  const currentTime = new Date().toLocaleTimeString();

  return `
    <div style="border:1px solid #ddd;padding:20px;margin:20px 0;border-radius:8px;background:#f9f9f9;font-family:Arial,sans-serif;">
      <h3 style="margin:0 0 15px 0;color:#333;text-align:center;">PERMISSION LETTER</h3>

      <div style="margin-bottom:20px;">
        <p><strong>Institution:</strong> ${reqData.inst || 'Not specified'}</p>
        <p><strong>Date:</strong> ${currentDate}</p>
        <p><strong>Time:</strong> ${currentTime}</p>
      </div>

      <div style="margin-bottom:20px;">
        <p><strong>To:</strong> ${authData.name}</p>
        <p><strong>Authority Type:</strong> ${authData.cat}</p>
      </div>

      <div style="margin-bottom:20px;">
        <p><strong>From:</strong></p>
        <p style="margin-left:20px;"><strong>Name:</strong> ${reqData.name}</p>
        <p style="margin-left:20px;"><strong>Registration No:</strong> ${reqData.regno}</p>
        <p style="margin-left:20px;"><strong>Department:</strong> ${reqData.dept}</p>
        <p style="margin-left:20px;"><strong>Year:</strong> ${reqData.year}</p>
        <p style="margin-left:20px;"><strong>Mobile:</strong> ${reqData.mobile}</p>
        <p style="margin-left:20px;"><strong>Role:</strong> ${reqData.role}</p>
      </div>

      <div style="margin-bottom:20px;">
        <p><strong>Permission Type:</strong> ${reqData.ptype}</p>
        <p><strong>Requested Date:</strong> ${reqData.date}</p>
        <p><strong>Out Time:</strong> ${reqData.outT}</p>
        <p><strong>In Time:</strong> ${reqData.inT}</p>
        <p><strong>Reason:</strong> ${reqData.reason}</p>
      </div>

      <div style="margin-top:30px;padding-top:15px;border-top:1px solid #ddd;">
        <p style="font-size:12px;color:#666;">
          <strong>Request ID:</strong> ${reqData.id || 'Pending'}
        </p>
        <p style="font-size:12px;color:#666;">
          <strong>Generated on:</strong> ${currentDate} at ${currentTime}
        </p>
      </div>
    </div>
  `;
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, 'localhost', () => {
  console.log(`\n🚀 Digital Approval System Backend v2.2 (Real Email Integration)`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🌐 Public link base: ${SERVER_URL}`);
  console.log('🔥 Firebase: Mock Database (In-Memory)');
  console.log('📧 Email: EmailJS Integration (Real Emails)');
  console.log('⚡ Real-time status updates: Enabled');
  console.log('🔄 Multi-authority workflow: Active');
  console.log('🧪 Test endpoints: /api/health, /api/config\n');
});
