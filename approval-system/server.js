const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// HARDCODED EmailJS - NO .env needed
const EMAILJS_SERVICE_ID = 'service_mljgocg';
const EMAILJS_TEMPLATE_ID = 'template_5247c1b';
const EMAILJS_PUBLIC_KEY = '8D4DbJIrZjOPCHD2t';

const app = express();
const PORT = 3000;
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('../'));

const DATA_DIR = path.join(__dirname, 'data');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(REQUESTS_FILE)) fs.writeFileSync(REQUESTS_FILE, JSON.stringify({}, null, 2));

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(data, null, 2));
}

const sendEmailJS = async (to_email, subject, html) => {
  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost'
      },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email,
          subject,
          message: html
        }
      })
    });
    return response.ok;
  } catch (error) {
    console.error('EmailJS error:', error);
    return false;
  }
};

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'Backend Ready ✅' }));

// Config (frontend check)
app.get('/api/config', (req, res) => res.json({ configured: true }));

// Submit request - SEND REAL EMAILS
app.post('/api/submit', async (req, res) => {
  try {
    const request = req.body.request;
    const requestId = request.id || uuidv4();
    
    // Save
    const data = loadData();
    if (!data[request.name]) data[request.name] = [];
    data[request.name].unshift({ ...request, id: requestId });
    saveData(data);

    // Send emails to EACH authority
    const results = [];
    for (const auth of request.authorities) {
      const baseUrl = req.headers.origin || 'http://localhost:3000';
      const approveUrl = `${baseUrl}?act=${Buffer.from(JSON.stringify({
        r: requestId, a: auth.id, v: 'approved'
      })).toString('base64')}`;
      const rejectUrl = `${baseUrl}?act=${Buffer.from(JSON.stringify({
        r: requestId, a: auth.id, v: 'rejected'
      })).toString('base64')}`;

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:30px">
          <h2 style="color:#1e40af">Permission Request</h2>
          <table style="width:100%;border-collapse:collapse;margin:25px 0">
            <tr><td style="padding:10px 0;font-weight:bold;min-width:80px">Student:</td><td>${request.name}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold">Reg No:</td><td>${request.regno||'—'}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold">Department:</td><td>${request.dept}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold">Type:</td><td>${request.ptype}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold">Date:</td><td>${new Date(request.date).toLocaleDateString()}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold">Time:</td><td>${request.outT||'—'} to ${request.inT||'—'}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold">Reason:</td><td>${request.reason.replace(/\n/g,'<br>')}</td></tr>
          </table>
          <div style="text-align:center;margin:35px 0">
            <a href="${approveUrl}" style="background:#10b981;color:white;padding:15px 35px;text-decoration:none;border-radius:8px;font-weight:bold;margin-right:15px;display:inline-block">✅ APPROVE</a>
            <a href="${rejectUrl}" style="background:#ef4444;color:white;padding:15px 35px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">❌ REJECT</a>
          </div>
          <p style="font-size:12px;color:#6b7280;text-align:center">Request ID: ${requestId} | Digital Approval System</p>
        </div>`;

      const sent = await sendEmailJS(auth.email, `Permission Request: ${request.ptype}`, html);
      results.push({ email: auth.email, sent });
      console.log(`📧 Email to ${auth.email}: ${sent ? '✅ SENT' : '❌ FAILED'}`);
    }

    res.json({
      demo: false,
      ok: true,
      requestId,
      results,
      sentCount: results.filter(r => r.sent).length
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Resend to specific authority
app.post('/api/resend', async (req, res) => {
  try {
    const { requestId, authId } = req.body;
    const data = loadData();
    let request = null, auth = null;

    for (const userId in data) {
      const userReqs = data[userId];
      request = userReqs.find(r => r.id === requestId);
      if (request) {
        auth = request.authorities.find(a => a.id === authId);
        break;
      }
    }

    if (!request || !auth) return res.status(404).json({ error: 'Not found' });

    const baseUrl = req.headers.origin || 'http://localhost:3000';
    const approveUrl = `${baseUrl}?act=${Buffer.from(JSON.stringify({
      r: requestId, a: authId, v: 'approved'
    })).toString('base64')}`;
    const rejectUrl = `${baseUrl}?act=${Buffer.from(JSON.stringify({
      r: requestId, a: authId, v: 'rejected'
    })).toString('base64')}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:30px">
        <h2 style="color:#1e40af">Permission Request (Resend)</h2>
        <table style="width:100%;border-collapse:collapse;margin:25px 0">
          <tr><td style="padding:10px 0;font-weight:bold;min-width:80px">Student:</td><td>${request.name}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Reg No:</td><td>${request.regno||'—'}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Department:</td><td>${request.dept}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Type:</td><td>${request.ptype}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Date:</td><td>${new Date(request.date).toLocaleDateString()}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Time:</td><td>${request.outT||'—'} to ${request.inT||'—'}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold">Reason:</td><td>${request.reason.replace(/\n/g,'<br>')}</td></tr>
        </table>
        <div style="text-align:center;margin:35px 0">
          <a href="${approveUrl}" style="background:#10b981;color:white;padding:15px 35px;text-decoration:none;border-radius:8px;font-weight:bold;margin-right:15px;display:inline-block">✅ APPROVE</a>
          <a href="${rejectUrl}" style="background:#ef4444;color:white;padding:15px 35px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block">❌ REJECT</a>
        </div>
        <p style="font-size:12px;color:#6b7280;text-align:center">Request ID: ${requestId} | Digital Approval System</p>
      </div>`;

    const sent = await sendEmailJS(auth.email, `Permission Request (Resend): ${request.ptype}`, html);
    res.json({ ok: sent });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get request status
app.get('/api/status/:reqId', (req, res) => {
  const { reqId } = req.params;
  const data = loadData();
  let request = null;

  for (const userId in data) {
    const userReqs = data[userId];
    request = userReqs.find(r => r.id === reqId);
    if (request) break;
  }

  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json({ request });
});

// SSE for live updates
app.get('/api/updates/:reqId', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const clientId = Date.now();
  const sendUpdate = () => {
    const data = loadData();
    let request = null;
    for (const userId in data) {
      const userReqs = data[userId];
      request = userReqs.find(r => r.id === reqId.params.reqId);
      if (request) break;
    }
    if (request) {
      res.write(`data: ${JSON.stringify({type:'status', status: request.status, authorities: request.authorities})}\n\n`);
    }
  };

  sendUpdate();
  const interval = setInterval(sendUpdate, 2000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// Action endpoint (from email link)
app.get('/api/action/:reqId/:authId/:action', async (req, res) => {
  const { reqId, authId, action } = req.params;
  const data = loadData();
  let updated = false;

  for (const userId in data) {
    const userReqs = data[userId];
    const reqIndex = userReqs.findIndex(r => r.id === reqId);
    if (reqIndex === -1) continue;

    const authIndex = userReqs[reqIndex].authorities.findIndex(a => a.id === authId);
    if (authIndex === -1) continue;

    userReqs[reqIndex].authorities[authIndex].status = action === 'approved' ? 'approved' : 'rejected';
    userReqs[reqIndex].authorities[authIndex].respondedAt = new Date().toISOString();

    // Update overall status
    const auths = userReqs[reqIndex].authorities;
    const total = auths.length;
    const approved = auths.filter(a => a.status === 'approved').length;
    const rejected = auths.some(a => a.status === 'rejected');
    
    userReqs[reqIndex].status = rejected ? 'rejected' : (approved === total ? 'approved' : 'pending');

    updated = true;
    break;
  }

  if (updated) saveData(data);

  const status = action === 'approved' ? '✅ Approved' : '❌ Rejected';
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${status}</title>
      <style>
        body{font-family:Arial,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#1f2937}
        .status{font-size:36px;font-weight:700;margin:25px 0;line-height:1.2}
        .success .status{color:#059669}.error .status{color:#dc2626}
        p{font-size:15px;line-height:1.7;margin-bottom:25px;max-width:400px;margin-left:auto;margin-right:auto}
        a{display:inline-block;background:#3b82f6;color:white;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;margin-top:20px}
        a:hover{background:#2563eb}
      </style>
    </head>
    <body class="${action}">
      <div class="status">${status}</div>
      <p>Your response has been recorded. The permission request status has been updated for the applicant.</p>
      <a href="http://localhost:3000">← Back to App</a>
    </body>
    </html>`);
});

app.listen(PORT, () => {
  console.log(`🚀 Digital Approval Backend: http://localhost:${PORT}`);
  console.log('📧 EmailJS Configured:', EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID);
  console.log('✅ Ready for real emails + live updates!');
});
