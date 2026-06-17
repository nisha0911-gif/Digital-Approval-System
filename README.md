# Digital Approval System

A modern, web-based permission request and approval system for educational institutions and organizations.

## Features

✅ **Multi-user System** - Multiple students/staff can submit requests simultaneously
✅ **Custom Authorities** - Type in any authority name and email address
✅ **Institutional Names** - Enter your institution name, it appears in all documents
✅ **Department Dropdown** - Pre-configured departments for easy selection
✅ **Auto-generated Letters** - Professional permission letters generated automatically
✅ **Email Integration** - Send requests directly to authorities' email addresses
✅ **Approval Tracking** - Track approval status in real-time
✅ **Official Slips** - Download approved permission slips as official documents
✅ **Live Dashboard** - View all requests and track their status

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm

### Step 1: Install Dependencies

```bash
cd digitalApprovalSystem
npm install
```

### Step 2: Configure Email (Optional)

By default, the system runs in **TEST MODE** - emails are logged to console instead of sent.

To enable real email sending:

1. Copy `.env.example` to `.env` (if not already done)
2. For Gmail:
   - Enable 2-Step Verification: https://myaccount.google.com/security
   - Generate App Password: https://myaccount.google.com/apppasswords
   - Add to `.env`:
     ```
     EMAIL_USER=your-email@gmail.com
     EMAIL_PASS=your-16-char-app-password
     ```

### Step 3: Start the Server

```bash
npm start
```

You'll see:
```
🚀 Digital Approval System Backend
══════════════════════════════════════════════════
🔗 Server running: http://localhost:3000
📁 Database: ./approval-system/data/requests.json
📧 Email: TEST MODE (set EMAIL_USER and EMAIL_PASS in .env for real emails)
══════════════════════════════════════════════════
```

### Step 4: Access the Application

Open your browser and go to: **http://localhost:3000**

## How It Works

### For Users (Applicants)

1. **Welcome** → Click "Get Started"
2. **Select Role** → Choose Student or Staff
3. **Fill Details** → Enter:
   - Institution Name
   - Your Full Name
   - Department (from dropdown or custom)
   - For Students: Register Number and Year
   - Permission Type
   - Date and Times
4. **Write Reason** → Explain why you need permission
5. **Add Authorities** → Enter authority names and email addresses
6. **Submit** → Emails are sent to all authorities
7. **Track Status** → Monitor approvals in real-time
8. **Download Slip** → Once fully approved, download the permission slip

### For Authorities (Approvers)

1. **Receive Email** → Authorities get professional permission letter with two buttons
2. **Review Request** → Check all details
3. **Click Approve/Reject** → Respond with one click
4. **System Updates** → Applicant sees approval status in real-time

## Data Storage

All requests are stored in:
```
approval-system/data/requests.json
```

Each request contains:
- Request ID
- User details (name, department, role, etc.)
- Permission details (type, date, times)
- Reason for request
- Authority list with their approval status
- Overall request status (pending/approved/rejected)

## API Endpoints

### Health Check
```
GET /api/health
```
Returns: `{ status: "ok", timestamp: "..." }`

### Submit Permission Request
```
POST /api/requests
```
Body:
```json
{
  "requestId": "REQ-123456",
  "institution": "ABC College",
  "userName": "John Doe",
  "dept": "Computer Science",
  "role": "student",
  "regno": "2021CS001",
  "year": "2nd Year",
  "permissionType": "Medical Leave",
  "date": "2024-04-15",
  "outTime": "10:00",
  "inTime": "14:00",
  "reason": "Doctor's appointment",
  "authorities": [
    {
      "id": "auth_1",
      "name": "Class Advisor",
      "email": "advisor@college.edu"
    }
  ]
}
```

### Handle Approval/Rejection
```
GET /action?req=REQUEST_ID&email=AUTHORITY_EMAIL&action=approve|reject
```

### Get Request Status
```
GET /api/requests/:requestId
```

## File Structure

```
digitalApprovalSystem/
├── index.html                    # Main application (HTML + JavaScript + CSS)
├── server.js                     # Express backend server
├── package.json                  # Dependencies
├── .env                          # Configuration (email credentials)
├── .env.example                  # Configuration template
├── README.md                     # This file
└── approval-system/
    └── data/
        └── requests.json         # Database file (auto-created)
```

## Configuration Options

### Change Port
Edit `.env`:
```
PORT=5000
```

### Use Different Email Service
Edit `server.js` in the `initEmailService()` function to configure:
- Outlook/Office365
- SendGrid
- AWS SES
- Custom SMTP

## Troubleshooting

### Emails Not Sending?
- Check `.env` file has EMAIL_USER and EMAIL_PASS
- For Gmail, use App Password (not regular password)
- Check console logs for errors
- Allowed less secure apps

### Port Already in Use?
```bash
# Change PORT in .env to 3001, 3002, etc.
```

### Database Not Creating?
- Check folder permissions
- Ensure `approval-system/data/` directory exists
- Server needs write access to this directory

### Can't Access from Other Machines?
- Make sure firewall allows port 3000
- Access using machine IP: `http://192.168.x.x:3000`

## Features Explained

### Multi-User Support
Each user has their own request history stored in browser localStorage and server database. Multiple users can submit requests simultaneously without interference.

### Custom Authorities
Instead of a fixed list, users can:
- Type any authority name (Class Advisor, HOD, Dean, etc.)
- Enter email addresses directly
- Add multiple authorities for same request

### Institutional Identity
- Users enter their institution name when submitting
- Appears in all generated documents and letters
- Maintains professional appearance

### Department Selection
Pre-configured departments include:
- Computer Science & Engineering
- Electronics & Communication
- Electrical Engineering
- Mechanical Engineering
- Civil Engineering
- Information Technology
- And more...

Users can also type custom departments if needed.

## Security Notes

⚠️ **For Production Use:**
- Use HTTPS instead of HTTP
- Implement user authentication
- Add request signing to email links
- Store sensitive data in encrypted form
- Use environment variables for all credentials
- Implement rate limiting
- Add CSRF protection

## Support & Customization

### To Add More Departments
Edit `index.html`, find the department dropdown, and add more `<option>` tags:
```html
<option>Your Department Name</option>
```

### To Customize Email Template
Edit `server.js`, find `generateLetterHTML()` function and modify the HTML/CSS.

### To Add Custom Fields
1. Add input field to form in `index.html`
2. Update `submitDetails()` function to capture the value
3. Pass to backend in `/api/requests` call
4. Include in email template

## License

MIT License - Feel free to modify and use for your institution!

## Contact & Support

For bug reports and feature requests, please contact your system administrator.

---

**Version:** 1.0.0  
**Last Updated:** 2024  
**Built with:** Express.js, Node.js, HTML5, CSS3, JavaScript
# Digital Approval System

A web-based permission request system with email notifications and approval tracking.

## Features

- Student and Staff login with department selection
- Auto-generated permission letters
- Email notifications to multiple authorities
- Approve/Reject functionality via email links
- Live tracking of approval status
- Official permission slip generation

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure email settings in `.env`:
   ```
   EMAIL_USER=your-gmail@gmail.com
   EMAIL_PASS=your-gmail-app-password
   ```
   Note: Use Gmail App Password, not regular password.

3. Start the server:
   ```bash
   npm start
   ```

4. Open http://localhost:3000 in your browser

## Backend APIs

- `POST /request` - Submit permission request
- `GET /action?id=...&auth=...&action=...` - Approve/Reject via email
- `GET /authorities` - Get list of authorities
- `GET /requests/:mobile` - Get user requests
- `GET /request/:id` - Get specific request

## Letter Format

The auto-generated letter includes:
- Institution name (user-typed)
- From: User details (name, reg no, dept, mobile)
- To: Selected authorities
- Date and time
- Permission type and reason
- Approval section for authorities

## Authorities

Supports 25+ authorities across:
- College (HOD, Principal, Dean, etc.)
- Corporate (Manager, HR, CEO, etc.)
- Company (Supervisor, Site Incharge, etc.)

Each authority can have custom email addresses.