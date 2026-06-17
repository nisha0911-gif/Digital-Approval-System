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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

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
        to_name: authData.name,
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

// Serve HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

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

app.post('/api/requests', async (req, res) => {
  try {
    const { inst, name, dept, regno, year, mobile, role, ptype, date, outT, inT, reason, authorities } = req.body;

    // Validate required fields
    if (!name || !mobile || !ptype || !authorities || authorities.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const reqData = {
      inst, name, dept, regno, year, mobile, role,
      ptype, date, outT, inT, reason,
      authorities: authorities.map(a => ({
        ...a,
        status: 'pending',
        respondedAt: null
      })),
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await db.collection("requests").add(reqData);
    const id = docRef.id;

    // Send real emails to all authorities using EmailJS
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const emailPromises = authorities.map(async (auth) => {
      const authData = AUTHS.find(x => x.id === auth.id);
      if (!authData) {
        console.error(`Authority not found: ${auth.id}`);
        return { email: auth.email, success: false, error: 'Authority not found' };
      }

      const approveLink = `${baseUrl}/action?req=${encodeURIComponent(id)}&auth=${encodeURIComponent(auth.id)}&action=approved`;
      const rejectLink = `${baseUrl}/action?req=${encodeURIComponent(id)}&auth=${encodeURIComponent(auth.id)}&action=rejected`;

      const letterHTML = generateLetterHTML(reqData, authData);

      try {
        // Send email using EmailJS
        const emailResult = await emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_ID,
          {
            to_email: auth.email,
            to_name: authData.name,
            from_name: reqData.name,
            from_regno: reqData.regno,
            from_dept: reqData.dept,
            institution: reqData.inst,
            permission_type: reqData.ptype,
            date: reqData.date,
            out_time: reqData.outT,
            in_time: reqData.inT,
            reason: reqData.reason,
            request_id: id,
            approve_link: approveLink,
            reject_link: rejectLink,
            letter_html: letterHTML,
            current_date: new Date().toLocaleDateString(),
            current_time: new Date().toLocaleTimeString()
          }
        );

        const sentEmail = {
          id: Date.now() + Math.random(),
          to: auth.email,
          subject: `Permission Request: ${ptype} - ${name}`,
          sentAt: new Date().toISOString(),
          requestId: id,
          authorityId: auth.id,
          authorityName: authData.name,
          emailjsId: emailResult.text
        };

        // Store sent email
        sentEmails.push(sentEmail);

        // Log the sent email
        console.log(`\n📧 EMAIL SENT VIA EMAILJS:`);
        console.log(`To: ${auth.email}`);
        console.log(`Subject: Permission Request: ${ptype} - ${name}`);
        console.log(`Authority: ${authData.name}`);
        console.log(`EmailJS ID: ${emailResult.text}`);
        console.log(`---\n`);

        return { email: auth.email, success: true, emailjsId: emailResult.text };
      } catch (emailError) {
        console.error(`Email sending failed for ${auth.email}:`, emailError);
        return { email: auth.email, success: false, error: emailError.message };
      }
    });

    // Wait for all emails to be sent
    const emailResults = await Promise.allSettled(emailPromises);

    // Log email results
    const successfulEmails = emailResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
    const failedEmails = emailResults.filter(r => r.status === 'rejected' || !r.value?.success).length;

    console.log(`\n📊 EMAIL SENDING COMPLETE:`);
    console.log(`Total Authorities: ${authorities.length}`);
    console.log(`Emails Sent Successfully: ${successfulEmails}`);
    console.log(`Failed Emails: ${failedEmails}`);
    console.log(`Request ID: ${id}\n`);

    res.json({
      success: true,
      id,
      emailStats: {
        total: authorities.length,
        simulated: successfulEmails,
        failed: failedEmails,
        mode: 'simulated'
      },
      message: 'Request created successfully. Check console for simulated emails.'
    });
  } catch (e) {
    console.error('Error creating request:', e);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// Get specific request
app.get('/request/:reqId', async (req, res) => {
  try {
    const doc = await db.collection("requests").doc(req.params.reqId).get();
    if (!doc.exists) return res.status(404).json({ error: "Request not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) {
    console.error('Error fetching request:', e);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

// Action endpoint for approve/reject (POST)
app.post('/api/action', async (req, res) => {
  try {
    const { id, authId, action } = req.body;

    if (!id || !authId || !['approved','rejected'].includes(action)) {
      return res.status(400).json({ error: 'Invalid request parameters' });
    }

    const docRef = db.collection('requests').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Request not found' });

    const reqData = doc.data();
    const authIndex = reqData.authorities.findIndex(a => a.id === authId);
    if (authIndex === -1) return res.status(404).json({ error: 'Authority not found' });

    if (reqData.authorities[authIndex].status !== 'pending') {
      return res.status(400).json({ error: 'Request already processed by this authority' });
    }

    // Update authority status
    reqData.authorities[authIndex].status = action;
    reqData.authorities[authIndex].respondedAt = new Date().toISOString();

    // Calculate overall status
    const tot = reqData.authorities.length;
    const appr = reqData.authorities.filter(a => a.status === 'approved').length;
    const rej = reqData.authorities.some(a => a.status === 'rejected');

    reqData.status = rej ? 'rejected' : appr === tot ? 'approved' : 'pending';
    reqData.updatedAt = new Date().toISOString();

    await docRef.update(reqData);

    console.log(`\n✅ AUTHORITY ACTION:`);
    console.log(`Request ID: ${id}`);
    console.log(`Authority: ${reqData.authorities[authIndex].name} (${authId})`);
    console.log(`Action: ${action.toUpperCase()}`);
    console.log(`New Status: ${reqData.status.toUpperCase()} (${appr}/${tot} approved)`);
    console.log(`---\n`);

    res.json({
      success: true,
      message: `Request ${action} successfully`,
      newStatus: reqData.status,
      progress: {
        total: tot,
        approved: appr,
        rejected: reqData.authorities.filter(a => a.status === 'rejected').length,
        pending: reqData.authorities.filter(a => a.status === 'pending').length
      }
    });
  } catch (e) {
    console.error('Error processing action:', e);
    res.status(500).json({ error: 'Failed to process action' });
  }
});

// Resend request endpoint (simulated)
app.post('/api/requests/:reqId/resend', async (req, res) => {
  try {
    const doc = await db.collection('requests').doc(req.params.reqId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Request not found' });

    const request = doc.data();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { authId } = req.body;

    if (!authId) {
      return res.status(400).json({ error: 'Authority ID required' });
    }

    const auth = request.authorities.find(a => a.id === authId);
    if (!auth) return res.status(404).json({ error: 'Authority not found' });

    const authData = AUTHS.find(x => x.id === auth.id);
    const approveLink = `${baseUrl}/action?req=${encodeURIComponent(req.params.reqId)}&auth=${encodeURIComponent(auth.id)}&action=approved`;
    const rejectLink = `${baseUrl}/action?req=${encodeURIComponent(req.params.reqId)}&auth=${encodeURIComponent(auth.id)}&action=rejected`;

    const letterHTML = generateLetterHTML(request, authData);

    // Simulate resending email
    const simulatedEmail = {
      id: Date.now() + Math.random(),
      to: auth.email,
      subject: `Permission Request (Resent): ${request.ptype} - ${request.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px;">
          <div style="background: #fff3cd; padding: 20px; border-bottom: 1px solid #ddd;">
            <h2 style="margin: 0; color: #856404;">Permission Request (Resent)</h2>
            <p style="margin: 5px 0 0 0; color: #856404;">Request ID: ${req.params.reqId}</p>
          </div>

          <div style="padding: 20px;">
            <p>You have received a permission request from <strong>${request.name}</strong>.</p>
            ${letterHTML}

            <div style="margin: 30px 0; text-align: center;">
              <a href="${approveLink}" target="_blank" rel="noopener noreferrer"
                 style="background:#16a34a;color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;margin-right:15px;font-weight:bold;display:inline-block;">
                ✅ APPROVE
              </a>
              <a href="${rejectLink}" target="_blank" rel="noopener noreferrer"
                 style="background:#dc2626;color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;display:inline-block;">
                ❌ REJECT
              </a>
            </div>
          </div>
        </div>
      `,
      sentAt: new Date().toISOString(),
      requestId: req.params.reqId,
      authorityId: auth.id,
      authorityName: authData.name,
      resent: true
    };

    simulatedEmails.push(simulatedEmail);

    console.log(`\n📧 SIMULATED EMAIL RESENT:`);
    console.log(`To: ${auth.email}`);
    console.log(`Subject: ${simulatedEmail.subject}`);
    console.log(`Authority: ${authData.name}`);
    console.log(`---\n`);

    res.json({ success: true, message: 'Email resent successfully (simulated)' });
  } catch (e) {
    console.error('Error resending request:', e);
    res.status(500).json({ error: 'Failed to resend request' });
  }
});

// Slip endpoint for approved requests
app.get('/api/slip/:reqId', async (req, res) => {
  try {
    const doc = await db.collection("requests").doc(req.params.reqId).get();
    if (!doc.exists) return res.status(404).json({ error: "Request not found" });

    const request = doc.data();

    // Check if request is approved
    if (request.status !== 'approved') {
      return res.status(400).json({ error: "Request is not approved" });
    }

    // Generate permission slip HTML
    const slipHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Permission Slip - ${request.ptype}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f8f9fa; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
          .header { text-align: center; border-bottom: 3px solid #007bff; padding-bottom: 20px; margin-bottom: 30px; }
          .content { margin: 20px 0; line-height: 1.6; }
          .signature { margin-top: 50px; border-top: 2px solid #333; padding-top: 20px; }
          .approved-stamp { color: green; font-weight: bold; font-size: 20px; text-align: center; margin: 20px 0; }
          .authority-list { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .authority-item { margin: 5px 0; padding: 5px; background: white; border-radius: 3px; }
          @media print { body { margin: 0; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="color: #007bff; margin: 0;">PERMISSION SLIP</h1>
            <h2 style="color: #666; margin: 10px 0 0 0;">${request.inst || 'Institution'}</h2>
          </div>

          <div class="content">
            <p><strong>Request ID:</strong> ${req.params.reqId}</p>
            <p><strong>Name:</strong> ${request.name}</p>
            <p><strong>Registration No:</strong> ${request.regno}</p>
            <p><strong>Department:</strong> ${request.dept}</p>
            <p><strong>Permission Type:</strong> ${request.ptype}</p>
            <p><strong>Date:</strong> ${request.date}</p>
            <p><strong>Out Time:</strong> ${request.outT}</p>
            <p><strong>In Time:</strong> ${request.inT}</p>
            <p><strong>Reason:</strong> ${request.reason}</p>

            <div class="approved-stamp">
              ✅ FULLY APPROVED BY ALL AUTHORITIES
            </div>

            <div class="authority-list">
              <h3>Approval Details:</h3>
              ${request.authorities.map(auth => `
                <div class="authority-item">
                  <strong>${auth.name}:</strong> ✅ Approved
                  ${auth.respondedAt ? `<span style="color: #666; font-size: 12px;">(${new Date(auth.respondedAt).toLocaleString()})</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="signature">
            <p><strong>Issued Date:</strong> ${new Date().toLocaleDateString()}</p>
            <p><strong>Valid for:</strong> ${request.date}</p>
            <p><strong>System Generated</strong></p>
          </div>
        </div>

        <div class="no-print" style="text-align: center; margin: 20px;">
          <button onclick="window.print()" style="background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;">
            Print Permission Slip
          </button>
        </div>
      </body>
      </html>
    `;

    res.send(slipHTML);
  } catch (e) {
    console.error('Error generating slip:', e);
    res.status(500).json({ error: 'Failed to generate slip' });
  }
});

// Legacy action endpoint (GET) for email links
app.get('/action', async (req, res) => {
  const { req: reqId, auth: authId, action } = req.query;

  if (!reqId || !authId || !['approved','rejected'].includes(action)) {
    return res.status(400).send(`
      <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;background:#f8f9fa;min-height:100vh;">
        <div style="max-width:500px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);">
          <div style="font-size:60px;margin-bottom:20px;">❌</div>
          <h2 style="color:#dc3545;margin:0 0 15px 0;">Invalid Action</h2>
          <p style="color:#666;margin:0;">Please use the approve or reject button in the email.</p>
        </div>
      </div>
    `);
  }

  try {
    const docRef = db.collection('requests').doc(reqId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send(`
        <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;background:#f8f9fa;min-height:100vh;">
          <div style="max-width:500px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);">
            <div style="font-size:60px;margin-bottom:20px;">🔍</div>
            <h2 style="color:#dc3545;margin:0 0 15px 0;">Request Not Found</h2>
            <p style="color:#666;margin:0;">The request may have been deleted or the link is invalid.</p>
          </div>
        </div>
      `);
    }

    const reqData = doc.data();
    const authIndex = reqData.authorities.findIndex(a => a.id === authId);

    if (authIndex === -1) {
      return res.status(404).send(`
        <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;background:#f8f9fa;min-height:100vh;">
          <div style="max-width:500px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);">
            <div style="font-size:60px;margin-bottom:20px;">🚫</div>
            <h2 style="color:#dc3545;margin:0 0 15px 0;">Authority Not Found</h2>
            <p style="color:#666;margin:0;">You are not authorized for this action.</p>
          </div>
        </div>
      `);
    }

    if (reqData.authorities[authIndex].status !== 'pending') {
      const isApproved = reqData.authorities[authIndex].status === 'approved';
      return res.send(`
        <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;background:#f8f9fa;min-height:100vh;">
          <div style="max-width:500px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);">
            <div style="font-size:60px;margin-bottom:20px;">${isApproved ? '✅' : '❌'}</div>
            <h2 style="color:${isApproved ? '#28a745' : '#dc3545'};margin:0 0 15px 0;">
              Already ${isApproved ? 'Approved' : 'Rejected'}
            </h2>
            <p style="color:#666;margin:0;">This request has already been processed.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </div>
        </div>
      `);
    }

    // Process the action
    reqData.authorities[authIndex].status = action;
    reqData.authorities[authIndex].respondedAt = new Date().toISOString();

    const tot = reqData.authorities.length;
    const appr = reqData.authorities.filter(a => a.status === 'approved').length;
    const rej = reqData.authorities.some(a => a.status === 'rejected');

    reqData.status = rej ? 'rejected' : appr === tot ? 'approved' : 'pending';
    reqData.updatedAt = new Date().toISOString();

    await docRef.update(reqData);

    const isApproved = action === 'approved';
    res.send(`
      <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;background:#f8f9fa;min-height:100vh;">
        <div style="max-width:500px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);">
          <div style="font-size:80px;margin-bottom:20px;">${isApproved ? '✅' : '❌'}</div>
          <h1 style="color:${isApproved ? '#28a745' : '#dc3545'};margin:0 0 15px 0;font-size:36px;">
            ${isApproved ? 'APPROVED' : 'REJECTED'}
          </h1>
          <p style="color:#666;margin:0;font-size:18px;">Request has been ${action} successfully.</p>
          <p style="color:#999;margin:10px 0;font-size:14px;">You can close this window now.</p>
        </div>
      </div>
    `);

  } catch (e) {
    console.error('Error processing action:', e);
    res.status(500).send(`
      <div style="text-align:center;padding:50px;font-family:Arial,sans-serif;background:#f8f9fa;min-height:100vh;">
        <div style="max-width:500px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);">
          <div style="font-size:60px;margin-bottom:20px;">⚠️</div>
          <h2 style="color:#ffc107;margin:0 0 15px 0;">Error Processing Action</h2>
          <p style="color:#666;margin:0;">Please try again or contact support.</p>
        </div>
      </div>
    `);
  }
});

// Get all simulated emails (for testing)
app.get('/api/simulated-emails', (req, res) => {
  res.json({
    emails: simulatedEmails,
    total: simulatedEmails.length,
    mode: 'simulated'
  });
});

// Clear simulated emails (for testing)
app.delete('/api/simulated-emails', (req, res) => {
  const count = simulatedEmails.length;
  simulatedEmails.length = 0;
  res.json({
    success: true,
    message: `Cleared ${count} simulated emails`
  });
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
  { id: 'professor', name: 'Professor', icon: '👨‍🎓', cat: 'College' },
  { id: 'associate_prof', name: 'Associate Professor', icon: '👨‍🏫', cat: 'College' },
  { id: 'assistant_prof', name: 'Assistant Professor', icon: '👨‍🏫', cat: 'College' },
  { id: 'lecturer', name: 'Lecturer', icon: '📖', cat: 'College' },
  { id: 'class_teacher', name: 'Class Teacher', icon: '👩‍🏫', cat: 'College' },
  { id: 'counselor', name: 'Counselor', icon: '💬', cat: 'College' },
  { id: 'exam_controller', name: 'Exam Controller', icon: '📝', cat: 'College' },
  { id: 'librarian', name: 'Librarian', icon: '📚', cat: 'College' },
  { id: 'sports_coach', name: 'Sports Coach', icon: '⚽', cat: 'College' },
  { id: 'team_lead', name: 'Team Lead', icon: '👤', cat: 'Corporate' },
  { id: 'manager', name: 'Manager', icon: '🗂️', cat: 'Corporate' },
  { id: 'sr_manager', name: 'Senior Manager', icon: '📊', cat: 'Corporate' },
  { id: 'hr_exec', name: 'HR Executive', icon: '🧑‍💼', cat: 'Corporate' },
  { id: 'hr_mgr', name: 'HR Manager', icon: '🏢', cat: 'Corporate' },
  { id: 'project_mgr', name: 'Project Manager', icon: '📁', cat: 'Corporate' },
  { id: 'dept_head', name: 'Department Head', icon: '🏛️', cat: 'Corporate' },
  { id: 'director', name: 'Director', icon: '🎯', cat: 'Corporate' },
  { id: 'ceo', name: 'CEO / MD', icon: '👔', cat: 'Corporate' },
  { id: 'cfo', name: 'CFO', icon: '💰', cat: 'Corporate' },
  { id: 'cto', name: 'CTO', icon: '💻', cat: 'Corporate' },
  { id: 'coo', name: 'COO', icon: '⚙️', cat: 'Corporate' },
  { id: 'cmo', name: 'CMO', icon: '📢', cat: 'Corporate' },
  { id: 'chro', name: 'CHRO', icon: '👥', cat: 'Corporate' },
  { id: 'vp', name: 'Vice President', icon: '⭐', cat: 'Corporate' },
  { id: 'finance_mgr', name: 'Finance Manager', icon: '💳', cat: 'Corporate' },
  { id: 'it_mgr', name: 'IT Manager', icon: '🖥️', cat: 'Corporate' },
  { id: 'supervisor', name: 'Supervisor', icon: '🔧', cat: 'Company' },
  { id: 'site_incharge', name: 'Site Incharge', icon: '🏗️', cat: 'Company' },
  { id: 'admin_officer', name: 'Admin Officer', icon: '📑', cat: 'Company' },
  { id: 'safety_officer', name: 'Safety Officer', icon: '🦺', cat: 'Company' },
  { id: 'gen_mgr', name: 'General Manager', icon: '🌐', cat: 'Company' },
  { id: 'owner', name: 'Owner', icon: '👑', cat: 'Company' },
  { id: 'partner', name: 'Partner', icon: '🤝', cat: 'Company' },
  { id: 'operations_mgr', name: 'Operations Manager', icon: '⚙️', cat: 'Company' },
  { id: 'sales_mgr', name: 'Sales Manager', icon: '📈', cat: 'Company' },
  { id: 'purchase_mgr', name: 'Purchase Manager', icon: '🛒', cat: 'Company' },
  { id: 'quality_mgr', name: 'Quality Manager', icon: '✅', cat: 'Company' },
  { id: 'maintenance_mgr', name: 'Maintenance Manager', icon: '🔧', cat: 'Company' },
  { id: 'security_officer', name: 'Security Officer', icon: '🔒', cat: 'Company' },
  { id: 'accountant', name: 'Accountant', icon: '🧮', cat: 'Company' },
  { id: 'receptionist', name: 'Receptionist', icon: '📞', cat: 'Company' }
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
  console.log('🧪 Test endpoints: /api/test-email, /api/sent-emails\n');
});
