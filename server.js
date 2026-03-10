require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const rateLimit = require('express-rate-limit');
const sgMail = require('@sendgrid/mail');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    console.error('❌  FATAL: JWT_SECRET environment variable is required. Set it in your .env file.');
    process.exit(1);
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@company.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
    console.error('❌  FATAL: ADMIN_PASSWORD environment variable is required. Set it in your .env file.');
    process.exit(1);
}

// ── Input Validation & Sanitization ────────────────────────────
// Length limits for user inputs
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const MAX_QUESTION_LENGTH = 2000;
const MAX_OPTION_LENGTH = 500;
const MAX_MODULE_ID_LENGTH = 50;
const MAX_MODULE_NAME_LENGTH = 100;

// HTML escape function to prevent XSS in emails and displayed content
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#x60;');
}

// Validate string length and trim
function sanitizeString(str, maxLen, fieldName) {
    if (!str || typeof str !== 'string') {
        return { error: `${fieldName} is required.` };
    }
    const trimmed = str.trim();
    if (trimmed.length === 0) {
        return { error: `${fieldName} cannot be empty.` };
    }
    if (trimmed.length > maxLen) {
        return { error: `${fieldName} must be ${maxLen} characters or less.` };
    }
    return { value: trimmed };
}

// Validate email format
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { error: 'Invalid email format.' };
    }
    return { value: email.toLowerCase() };
}

// Validate password strength
function validatePassword(password) {
    if (password.length < 6) {
        return { error: 'Password must be at least 6 characters.' };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return { error: `Password must be ${MAX_PASSWORD_LENGTH} characters or less.` };
    }
    return { value: password };
}

// ── SendGrid setup ────────────────────────────────────────
const SG_KEY = process.env.SENDGRID_API_KEY || '';
const SG_FROM = process.env.SENDGRID_FROM || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';
if (SG_KEY && SG_KEY !== 'SG.your-api-key-here') {
    sgMail.setApiKey(SG_KEY);
    console.log('✉️   SendGrid enabled – results will be emailed to:', NOTIFY_EMAIL);
} else {
    console.log('⚠️   SendGrid not configured – email notifications disabled.');
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'Public')));

// ── Serve module directories (legacy standalone quiz pages) ──
// Express mount paths don't reliably match URL-encoded spaces,
// so we use explicit route handlers instead.
app.get('/AD%20Management/:file', (req, res) => {
    const file = path.basename(req.params.file);
    if (!file || file.startsWith('.')) return res.status(400).end();
    res.sendFile(path.join(__dirname, 'AD Management', file));
});
app.get('/OneDrive%20Managament/:file', (req, res) => {
    const file = path.basename(req.params.file);
    if (!file || file.startsWith('.')) return res.status(400).end();
    res.sendFile(path.join(__dirname, 'OneDrive Managament', file));
});

// ── Rate limiter for auth endpoints ──────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 15,                     // limit each IP to 15 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' }
});

// ── Seed initial question banks into DB on first run ──────
const SEED_DATA = {
    modules: [
        { id: 'ad-management', name: 'Active Directory Management', icon: '🗂️', description: 'AD concepts, FSMO roles, replication, group scopes, DNS integration, and common AD tools.', url: 'AD Management/index.html', sort_order: 0 },
        { id: 'onedrive-management', name: 'OneDrive Management', icon: '☁️', description: 'OneDrive administration, sharing permissions, DLP policies, storage limits, and Microsoft 365 integration.', url: 'OneDrive Managament/index.html', sort_order: 1 },
        { id: 'networking', name: 'Networking Fundamentals', icon: '🌐', description: 'TCP/IP, subnetting, routing protocols, VLANs, and network troubleshooting.', url: null, sort_order: 2, is_active: 1 },
        { id: 'security', name: 'Security & Compliance', icon: '🔒', description: 'Cybersecurity principles, threat vectors, access control, and compliance frameworks.', url: null, sort_order: 3, is_active: 1 },
        { id: 'powershell', name: 'PowerShell & Scripting', icon: '⚡', description: 'PowerShell cmdlets, scripting best practices, and AD automation.', url: null, sort_order: 4, is_active: 0 },
        { id: 'diagram-design', name: 'Diagram Design', icon: '📐', description: 'Draw a network layout, application architecture, or infrastructure diagram using the interactive whiteboard.', url: 'diagram.html?module=diagram-design', sort_order: 5, is_active: 1, module_type: 'diagram' },
    ],
    questions: {
        'ad-management': [
            { q: "What is Active Directory (AD)?", opts: ["A type of computer virus", "A Microsoft directory service that stores information about objects on a network", "A network protocol for data transmission", "A software application for managing databases"], ans: 1 },
            { q: "What does LDAP stand for?", opts: ["Lightweight Directory Access Protocol", "Local Data Access Protocol", "Lightweight Data Application Protocol", "Local Directory Access Protocol"], ans: 0 },
            { q: "What port does LDAP use by default?", opts: ["21", "80", "389", "443"], ans: 2 },
            { q: "What is the role of a Domain Controller (DC) in Active Directory?", opts: ["It manages internet connections", "It stores and manages security information and authenticates users", "It provides DHCP services", "It manages file storage"], ans: 1 },
            { q: "What are FSMO roles in Active Directory?", opts: ["File System Management Operations", "Flexible Single Master Operations", "Fast Secure Management Options", "Functional System Monitoring Operations"], ans: 1 },
            { q: "How many FSMO roles are there in Active Directory?", opts: ["3", "4", "5", "6"], ans: 2 },
            { q: "What is the Global Catalog in Active Directory?", opts: ["A list of all software installed on the network", "A distributed data repository that contains a searchable, partial representation of every object in every domain", "A backup of the Active Directory database", "A list of all users in the domain"], ans: 1 },
            { q: "What is the purpose of Active Directory replication?", opts: ["To back up Active Directory data", "To ensure all domain controllers have the same up-to-date information", "To synchronize time across the network", "To distribute software updates"], ans: 1 },
            { q: "What type of group is primarily used to assign permissions to resources in Active Directory?", opts: ["Global groups", "Universal groups", "Domain local groups", "Distribution groups"], ans: 2 },
            { q: "What is the difference between a Security Group and a Distribution Group in Active Directory?", opts: ["Security groups are used for email distribution, distribution groups for permissions", "Security groups are used to assign permissions, distribution groups are used for email", "There is no difference", "Security groups are only for local resources, distribution groups are for domain resources"], ans: 1 },
            { q: "What is an Organizational Unit (OU) in Active Directory?", opts: ["A physical location of a server", "A container used to organize objects within a domain", "A type of user account", "A network segment"], ans: 1 },
            { q: "What is the purpose of Group Policy in Active Directory?", opts: ["To manage user and computer settings across the network", "To control internet access", "To manage hardware configurations", "To monitor network traffic"], ans: 0 },
            { q: "What is the Active Directory database file called?", opts: ["ad.mdb", "ntds.dit", "active.db", "directory.mdb"], ans: 1 },
            { q: "What tool is used to manage Active Directory objects?", opts: ["Active Directory Users and Computers (ADUC)", "Windows Explorer", "Control Panel", "Task Manager"], ans: 0 },
            { q: "What is the Kerberos protocol used for in Active Directory?", opts: ["File sharing", "Authentication", "Email communication", "Network routing"], ans: 1 },
            { q: "What is a Trust in Active Directory?", opts: ["A security certificate", "A relationship between domains that allows users in one domain to access resources in another", "A type of user account", "A backup mechanism"], ans: 1 },
            { q: "What is the purpose of the Active Directory Recycle Bin?", opts: ["To store deleted files", "To allow recovery of deleted Active Directory objects", "To manage disk space", "To store backup configurations"], ans: 1 },
            { q: "What is the role of DNS in Active Directory?", opts: ["To manage email routing", "To provide name resolution and help clients locate domain controllers", "To manage IP addresses", "To control internet access"], ans: 1 },
            { q: "What is Active Directory Federation Services (AD FS)?", opts: ["A file sharing service", "A service that provides single sign-on access to systems across organizational boundaries", "A backup service", "A network monitoring service"], ans: 1 },
            { q: "What command-line tool is commonly used to manage Active Directory?", opts: ["ipconfig", "ping", "PowerShell with AD module", "netstat"], ans: 2 }
        ],
        'onedrive-management': [
            { q: "What is Files On-Demand in OneDrive?", opts: ["A service for streaming music files", "A service for sharing files", "A service for viewing video files", "A feature that allows you to access all your files in OneDrive without having to download them"], ans: 3 },
            { q: "You need to upload a large file to OneDrive, but it's taking too long. What can you do to speed up the process?", opts: ["Try uploading the file during peak hours", "Try uploading the file to a different cloud storage", "Reduce the size of your OneDrive storage", "Ensure a stable and fast internet connection"], ans: 3 },
            { q: "You're an administrator who needs to implement a data loss prevention (DLP) policy in OneDrive. Where should you go to configure this?", opts: ["Windows Control Panel", "Microsoft 365 compliance center", "OneDrive for Business admin center", "OneDrive settings"], ans: 1 },
            { q: "You are migrating from a different cloud storage service to OneDrive. What is a recommended way to move your files?", opts: ["Print out all documents and scan them to OneDrive", "Email all files to yourself", "Use the built-in migration tools", "Manually copy each file"], ans: 2 },
            { q: "Can you edit Office files in OneDrive without an Office 365 subscription?", opts: ["Yes, using Office for the web", "Yes, using the OneDrive desktop app", "No, you need an Office 365 subscription", "Yes, using the OneDrive mobile app"], ans: 0 },
            { q: "How can you prevent someone from editing a file that you have shared with them through OneDrive?", opts: ["By moving the file to a different folder", "By password protecting the file", "By deleting the file", "By adjusting the link settings to 'view only'"], ans: 3 },
            { q: "What types of files can you store in OneDrive?", opts: ["All types of files (except those explicitly restricted by Microsoft)", "Only video files", "Only image files", "Only Microsoft Office files"], ans: 0 },
            { q: "You received a link to a shared OneDrive folder from a colleague, but you can't access the folder. What could be the issue?", opts: ["Your colleague has not shared the folder properly", "The permissions on the shared link are set to 'Specific People' and you are not included", "Your internet connection is not working", "You are not signed in to OneDrive"], ans: 1 },
            { q: "What does Microsoft OneDrive primarily function as?", opts: ["A video conferencing tool", "A data analysis software", "A cloud storage service", "A programming language"], ans: 2 },
            { q: "How can you restore your OneDrive to a previous state?", opts: ["By contacting Microsoft support", "The entire OneDrive cannot be restored to a previous state", "By deleting and re-installing OneDrive", "By using the 'Restore your OneDrive' feature"], ans: 3 },
            { q: "What is the default storage limit for OneDrive for Business users?", opts: ["10 GB", "2TB", "1 TB (can be increased to 5 TB per user)", "5 GB"], ans: 2 },
            { q: "Your team is working on a large project and the files need to be accessed and edited by multiple team members. How could you set up the file permissions in OneDrive?", opts: ["Set the shared link to 'Anyone with the link cannot access'", "Do not share the file", "Set the shared link to 'view only'", "Set the shared link to 'Anyone with the link can edit'"], ans: 3 },
            { q: "How can you make a file or folder available offline on your mobile device using the OneDrive app?", opts: ["By selecting 'Make Available Offline'", "The OneDrive app does not support offline access", "By emailing the file or folder to yourself", "By moving the file or folder to the 'Offline' folder"], ans: 0 },
            { q: "You are a OneDrive administrator and need to enforce a two-factor authentication for all users. What should you do?", opts: ["Enforce it through the Microsoft 365 admin center", "Enforce it through the Windows Control Panel", "Enforce it through the OneDrive mobile app", "Enforce it through the OneDrive desktop app"], ans: 0 },
            { q: "How can you protect a file in OneDrive with a password?", opts: ["By renaming the file with a password", "By moving the file to a password-protected folder", "This feature is not directly available in OneDrive", "By using the 'Protect with password' feature"], ans: 3 },
            { q: "In the context of OneDrive, what does Ransomware detection do?", opts: ["It alerts you when your OneDrive files have been attacked by ransomware", "It detects spam in your email", "It detects viruses in your device", "It detects if your device has been hacked"], ans: 0 },
            { q: "How do you add a shortcut to a shared folder to your OneDrive?", opts: ["By selecting 'Add shortcut to My files'", "By deleting the folder", "By copying and pasting the folder", "By moving the folder"], ans: 0 },
            { q: "What happens to your files in OneDrive when you delete your Microsoft account?", opts: ["The files are saved on your device", "The files are moved to a different cloud storage", "The files are emailed to you", "The files are deleted"], ans: 3 },
            { q: "You are a OneDrive administrator and you need to track the activity of a specific user. What feature should you use?", opts: ["OneDrive audit log", "OneDrive settings", "OneDrive Recycle Bin", "OneDrive file version history"], ans: 0 },
            { q: "Which Microsoft Office application can be directly integrated with OneDrive?", opts: ["MS Paint", "Notepad", "Microsoft Word", "Windows Media Player"], ans: 2 }
        ],
        'networking': [
            { q: "What does TCP stand for?", opts: ["Transport Control Protocol", "Transmission Control Protocol", "Transfer Communication Protocol", "Terminal Control Protocol"], ans: 1 },
            { q: "What is the purpose of a subnet mask?", opts: ["To encrypt network traffic", "To identify which portion of an IP address is the network and which is the host", "To assign IP addresses automatically", "To route traffic between networks"], ans: 1 },
            { q: "Which OSI model layer is responsible for routing packets between networks?", opts: ["Layer 2 – Data Link", "Layer 3 – Network", "Layer 4 – Transport", "Layer 5 – Session"], ans: 1 },
            { q: "What is the default subnet mask for a Class C network?", opts: ["255.0.0.0", "255.255.0.0", "255.255.255.0", "255.255.255.128"], ans: 2 },
            { q: "Which protocol automatically assigns IP addresses to devices on a network?", opts: ["DNS", "DHCP", "FTP", "SNMP"], ans: 1 },
            { q: "What is the purpose of ARP (Address Resolution Protocol)?", opts: ["To translate domain names to IP addresses", "To map IP addresses to MAC addresses", "To route packets between networks", "To encrypt data in transit"], ans: 1 },
            { q: "Which of the following is a valid RFC 1918 private IP address range?", opts: ["172.16.0.0 – 172.31.255.255", "192.169.0.0 – 192.169.255.255", "10.255.0.0 – 11.0.0.0", "8.8.0.0 – 8.8.255.255"], ans: 0 },
            { q: "What is the purpose of a VLAN?", opts: ["To increase available bandwidth", "To segment a physical network into logical isolated networks", "To provide wireless connectivity", "To encrypt network traffic"], ans: 1 },
            { q: "What port does HTTPS use by default?", opts: ["80", "443", "8080", "8443"], ans: 1 },
            { q: "What is the key difference between TCP and UDP?", opts: ["TCP is faster; UDP guarantees delivery", "TCP guarantees reliable delivery; UDP is connectionless and lower overhead", "UDP is used for web traffic; TCP is used for streaming", "They are functionally identical"], ans: 1 },
            { q: "What does DNS stand for?", opts: ["Dynamic Network Service", "Domain Name System", "Distributed Name Server", "Data Network Standard"], ans: 1 },
            { q: "What is the purpose of NAT (Network Address Translation)?", opts: ["To assign static IP addresses to servers", "To translate private IP addresses to a public IP for internet access", "To filter malicious network packets", "To monitor bandwidth usage"], ans: 1 },
            { q: "Which routing protocol is used to exchange routing information between autonomous systems on the internet?", opts: ["OSPF", "RIP", "BGP", "EIGRP"], ans: 2 },
            { q: "What does CIDR notation /24 represent as a subnet mask?", opts: ["255.0.0.0", "255.255.0.0", "255.255.255.0", "255.255.255.128"], ans: 2 },
            { q: "What does the ping command test?", opts: ["The route packets take to a destination", "Connectivity to a host and round-trip latency", "The current routing table", "Open ports on a remote host"], ans: 1 },
            { q: "What is a MAC address?", opts: ["A 32-bit logical address assigned by administrators", "A 48-bit hardware address burned into a network interface card", "An address used for routing across the internet", "A temporary address assigned by DHCP"], ans: 1 },
            { q: "What is the function of the Spanning Tree Protocol (STP)?", opts: ["To encrypt traffic between switches", "To prevent switching loops in Ethernet networks", "To assign IP addresses to VLANs", "To route packets between subnets"], ans: 1 },
            { q: "Which command displays the IP routing table on a Windows system?", opts: ["ipconfig /all", "arp -a", "nslookup", "route print"], ans: 3 },
            { q: "What is QoS (Quality of Service) in networking?", opts: ["A security protocol for encrypting data", "A mechanism to prioritise certain types of network traffic", "A protocol for dynamically assigning IP addresses", "A method for creating VLANs"], ans: 1 },
            { q: "What is the key difference between a hub and a switch?", opts: ["A hub operates at Layer 3; a switch at Layer 2", "A hub broadcasts to all ports; a switch forwards frames only to the destination MAC address port", "A switch broadcasts to all ports; a hub forwards to a specific port", "They are functionally identical devices"], ans: 1 }
        ],
        'security': [
            { q: "What does the CIA triad stand for in cybersecurity?", opts: ["Confidentiality, Integrity, Availability", "Classification, Identification, Authentication", "Control, Investigation, Assessment", "Cyber, Internet, Application"], ans: 0 },
            { q: "What is phishing?", opts: ["A network scanning technique", "A social engineering attack that tricks users into revealing sensitive information", "A method for encrypting data at rest", "A vulnerability in web application authentication"], ans: 1 },
            { q: "What is multi-factor authentication (MFA)?", opts: ["Using a very long and complex password", "Requiring two or more distinct verification factors to authenticate a user", "A method for storing passwords in encrypted form", "A firewall rule that blocks unauthorised access"], ans: 1 },
            { q: "What does the principle of least privilege mean?", opts: ["Granting users only the permissions they need to perform their job", "Giving administrators unrestricted access to all systems", "Restricting all users from accessing sensitive data entirely", "Applying the minimum encryption standard that satisfies requirements"], ans: 0 },
            { q: "What is ransomware?", opts: ["Spyware that monitors user activity without consent", "Malware that encrypts a victim's files and demands payment for decryption", "A denial-of-service attack that floods a target with traffic", "A vulnerability in web application session handling"], ans: 1 },
            { q: "What is the primary purpose of a firewall?", opts: ["To scan endpoints for viruses", "To monitor and control incoming and outgoing network traffic based on defined rules", "To encrypt data transmitted across a network", "To assign IP addresses to devices on the network"], ans: 1 },
            { q: "What is an SQL injection attack?", opts: ["A DDoS attack targeting database servers", "Inserting malicious SQL code into an input field to manipulate or extract database data", "Encrypting a database without authorisation", "Brute-forcing database login credentials"], ans: 1 },
            { q: "What is the primary purpose of GDPR?", opts: ["To regulate financial reporting standards", "To protect the personal data and privacy of individuals in the EU", "To govern international trade agreements", "To standardise cybersecurity practices globally"], ans: 1 },
            { q: "What is a zero-day vulnerability?", opts: ["A flaw disclosed and patched but not yet deployed", "A security flaw unknown to the vendor with no available patch", "A vulnerability found on the release day of software", "A low-severity bug with no known exploit"], ans: 1 },
            { q: "What is the difference between symmetric and asymmetric encryption?", opts: ["Symmetric uses two keys; asymmetric uses one", "Symmetric uses one shared key for both encryption and decryption; asymmetric uses a public/private key pair", "Symmetric is slower than asymmetric encryption", "They are equivalent in all practical scenarios"], ans: 1 },
            { q: "What is a VPN primarily used for?", opts: ["To increase internet connection speed", "To create an encrypted tunnel for secure communication over untrusted networks", "To block access to malicious websites", "To scan a network for open vulnerabilities"], ans: 1 },
            { q: "What protection does HTTPS add compared to HTTP?", opts: ["It prevents all categories of cyberattack", "It encrypts data in transit, protecting it from eavesdropping and tampering", "It increases web page load speed", "It prevents server-side code vulnerabilities"], ans: 1 },
            { q: "What is social engineering in cybersecurity?", opts: ["Recruiting staff to build a security team", "Manipulating people into divulging confidential information or performing actions that compromise security", "Implementing security policies across an organisation", "Designing inherently secure software architectures"], ans: 1 },
            { q: "What is a penetration test?", opts: ["Testing the physical security controls of a building", "An authorised simulated cyberattack used to evaluate the security of a system", "An automated port scan of a network", "A review of written security policies and procedures"], ans: 1 },
            { q: "What is the purpose of encrypting data at rest?", opts: ["To speed up data retrieval from storage", "To protect stored data from unauthorised access if physical media is compromised", "To reduce the storage space data occupies", "To comply with network packet transmission standards"], ans: 1 },
            { q: "What is an Intrusion Detection System (IDS)?", opts: ["A system that blocks all inbound network traffic by default", "A system that monitors network or host activity for signs of malicious behaviour and raises alerts", "A tool for centralised management of user passwords", "A next-generation firewall that filters web traffic"], ans: 1 },
            { q: "Which compliance framework specifically governs security standards in the payment card industry?", opts: ["HIPAA", "SOC 2", "PCI DSS", "ISO 27001"], ans: 2 },
            { q: "What is the purpose of an access control list (ACL)?", opts: ["To maintain a directory of all users in an organisation", "To define which users or systems are permitted to access specific resources", "To log all failed login attempts", "To push firewall rules to all network devices simultaneously"], ans: 1 },
            { q: "What is a DDoS (Distributed Denial of Service) attack?", opts: ["An attack that encrypts files on a target system for ransom", "An attack that overwhelms a target with traffic from many sources to disrupt availability", "A man-in-the-middle attack that intercepts communications", "An attack that exploits a specific software vulnerability to gain access"], ans: 1 },
            { q: "What is the purpose of a security audit?", opts: ["To deploy security software updates across all systems", "To systematically evaluate an organisation's security controls against defined standards or policies", "To monitor real-time network traffic for anomalies", "To deliver security awareness training to employees"], ans: 1 }
        ]
    }
};

(function seedModules() {
    // Always ensure all seed modules exist (INSERT OR IGNORE preserves existing data)
    const insertModule = db.prepare(
        `INSERT OR IGNORE INTO modules (id, name, icon, description, url, module_type, is_active, sort_order)
         VALUES (@id, @name, @icon, @description, @url, @module_type, @is_active, @sort_order)`
    );
    const insertQuestion = db.prepare(
        `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, question_type, sort_order)
         VALUES (@module_id, @question, @opt0, @opt1, @opt2, @opt3, @correct_idx, @question_type, @sort_order)`
    );
    const seedTx = db.transaction(() => {
        let added = 0;
        for (const m of SEED_DATA.modules) {
            const result = insertModule.run({ module_type: 'quiz', is_active: 1, ...m });
            if (result.changes > 0) added++;
        }
        // Only seed questions for modules that had zero questions
        for (const [moduleId, qs] of Object.entries(SEED_DATA.questions)) {
            const qCount = db.prepare('SELECT COUNT(*) as c FROM questions WHERE module_id = ?').get(moduleId).c;
            if (qCount > 0) continue; // already has questions
            qs.forEach((q, i) => {
                insertQuestion.run({
                    module_id: moduleId,
                    question: q.q,
                    opt0: q.opts[0], opt1: q.opts[1],
                    opt2: q.opts[2], opt3: q.opts[3],
                    correct_idx: q.ans,
                    question_type: 'multiple_choice',
                    sort_order: i
                });
            });
            // Activate the module now that it has questions (handles pre-existing inactive rows)
            db.prepare('UPDATE modules SET is_active = 1 WHERE id = ? AND is_active = 0').run(moduleId);
        }
        if (added > 0) console.log(`🌱  Seeded ${added} new module(s) into database.`);
    });
    seedTx();
})();

// ── GET /api/questions/:moduleId ─────────────────────────
// Returns questions WITHOUT the answer index (stripped server-side)
app.get('/api/questions/:moduleId', auth, (req, res) => {
    const mod = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const qs = db.prepare(
        'SELECT question as q, opt0, opt1, opt2, opt3, question_type FROM questions WHERE module_id = ? ORDER BY sort_order, id'
    ).all(req.params.moduleId);
    res.json(qs.map(r => ({
        q: r.q,
        question_type: r.question_type || 'multiple_choice',
        opts: r.question_type === 'open_ended' ? null : [r.opt0, r.opt1, r.opt2, r.opt3].filter(Boolean)
    })));
});

// ── Candidate auth middleware ─────────────────────────────
// Verifies a regular-user JWT from httpOnly cookie
function auth(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const payload = jwt.verify(token, SECRET);
        // Reject admin tokens on candidate-only routes
        if (payload.role === 'admin')
            return res.status(403).json({ error: 'Use candidate credentials for this endpoint.' });
        req.candidate = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── Admin auth middleware ─────────────────────────────────
// Verifies a JWT that has role === 'admin' from httpOnly cookie
function adminAuth(req, res, next) {
    const token = req.cookies.adminToken;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const payload = jwt.verify(token, SECRET);
        if (payload.role !== 'admin')
            return res.status(403).json({ error: 'Admin access required.' });
        req.admin = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── POST /api/register ───────────────────────────────────
app.post('/api/register', authLimiter, async (req, res) => {
    const { name, email, password } = req.body;
    
    // Validate name
    const nameResult = sanitizeString(name, MAX_NAME_LENGTH, 'Name');
    if (nameResult.error) return res.status(400).json({ error: nameResult.error });
    
    // Validate email
    const emailResult = sanitizeString(email, MAX_EMAIL_LENGTH, 'Email');
    if (emailResult.error) return res.status(400).json({ error: emailResult.error });
    const validatedEmail = validateEmail(emailResult.value);
    if (validatedEmail.error) return res.status(400).json({ error: validatedEmail.error });
    
    // Validate password
    const passwordResult = validatePassword(password);
    if (passwordResult.error) return res.status(400).json({ error: passwordResult.error });

    // Prevent registering with the admin email
    if (validatedEmail.value === ADMIN_EMAIL)
        return res.status(409).json({ error: 'That email address is not available.' });

    const existing = db.prepare('SELECT id FROM candidates WHERE email = ?').get(validatedEmail.value);
    if (existing)
        return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(passwordResult.value, 10);
    const result = db.prepare(
        'INSERT INTO candidates (name, email, password_hash) VALUES (?, ?, ?)'
    ).run(nameResult.value, validatedEmail.value, hash);

    const token = jwt.sign(
        { id: result.lastInsertRowid, name: nameResult.value, email: validatedEmail.value },
        SECRET, { expiresIn: '8h' }
    );
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 8 * 3600 * 1000 });
    res.json({ name: nameResult.value, id: result.lastInsertRowid });
});

// ── POST /api/login ──────────────────────────────────────
app.post('/api/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email and password are required.' });

    const candidate = db.prepare('SELECT * FROM candidates WHERE email = ?').get(email.toLowerCase());
    if (!candidate || !(await bcrypt.compare(password, candidate.password_hash)))
        return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
        { id: candidate.id, name: candidate.name, email: candidate.email },
        SECRET, { expiresIn: '8h' }
    );
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 8 * 3600 * 1000 });
    res.json({ name: candidate.name, id: candidate.id });
});

// ── POST /api/admin/login ────────────────────────────────
app.post('/api/admin/login', authLimiter, (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email and password are required.' });

    if (email.toLowerCase() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD)
        return res.status(401).json({ error: 'Invalid admin credentials.' });

    const token = jwt.sign(
        { role: 'admin', email: ADMIN_EMAIL },
        SECRET, { expiresIn: '8h' }
    );
    res.cookie('adminToken', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 8 * 3600 * 1000 });
    res.json({ ok: true });
});

// ── GET /api/admin/verify ────────────────────────────────
// Used by admin.html on load to confirm the token is valid admin
app.get('/api/admin/verify', adminAuth, (req, res) => {
    res.json({ ok: true });
});

// ── POST /api/logout ─────────────────────────────────────
app.post('/api/logout', (req, res) => {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict' });
    res.json({ ok: true });
});

// ── POST /api/admin/logout ───────────────────────────────
app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('adminToken', { httpOnly: true, secure: true, sameSite: 'strict' });
    res.json({ ok: true });
});

// ── GET /api/modules ─────────────────────────────────────
app.get('/api/modules', auth, (req, res) => {
    const mods = db.prepare(
        'SELECT id, name, icon, description, url, module_type, is_active FROM modules WHERE is_active = 1 ORDER BY sort_order, id'
    ).all();
    const grants = db.prepare(
        'SELECT module_id FROM retake_grants WHERE candidate_id = ?'
    ).all(req.candidate.id);
    const grantedSet = new Set(grants.map(g => g.module_id));
    const qCounts = db.prepare(
        'SELECT module_id, COUNT(*) as cnt FROM questions GROUP BY module_id'
    ).all();
    const countMap = {};
    qCounts.forEach(r => countMap[r.module_id] = r.cnt);
    res.json(mods.map(m => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        desc: m.description,
        url: m.url || null,
        module_type: m.module_type || 'quiz',
        questions: countMap[m.id] || 0,
        // Diagram modules are always ready (they have no questions by design).
        // Quiz modules need at least 1 question to be ready.
        ready: m.module_type === 'diagram' ? true : (countMap[m.id] || 0) > 0,
        retakeGranted: grantedSet.has(m.id)
    })));
});

// ── POST /api/admin/grant-retake ─────────────────────────
app.post('/api/admin/grant-retake', adminAuth, (req, res) => {
    const { candidateId, moduleId } = req.body;
    if (!candidateId || !moduleId)
        return res.status(400).json({ error: 'candidateId and moduleId are required.' });
    db.prepare(
        'INSERT OR REPLACE INTO retake_grants (candidate_id, module_id) VALUES (?, ?)'
    ).run(candidateId, moduleId);
    res.json({ ok: true, message: 'Retake granted.' });
});

// ── DELETE /api/admin/revoke-retake ──────────────────────
app.delete('/api/admin/revoke-retake', adminAuth, (req, res) => {
    const { candidateId, moduleId } = req.body;
    if (!candidateId || !moduleId)
        return res.status(400).json({ error: 'candidateId and moduleId are required.' });
    db.prepare(
        'DELETE FROM retake_grants WHERE candidate_id = ? AND module_id = ?'
    ).run(candidateId, moduleId);
    res.json({ ok: true, message: 'Retake revoked.' });
});

// ── GET /api/admin/modules ────────────────────────────────
// Lists all modules (active + inactive) with question counts
app.get('/api/admin/modules', adminAuth, (req, res) => {
    const mods = db.prepare(
        `SELECT m.*, COUNT(q.id) as question_count
         FROM modules m
         LEFT JOIN questions q ON q.module_id = m.id
         GROUP BY m.id
         ORDER BY m.sort_order, m.id`
    ).all();
    res.json(mods);
});

// ── POST /api/admin/modules ───────────────────────────────
app.post('/api/admin/modules', adminAuth, (req, res) => {
    const { id, name, icon, description, url, sort_order, module_type } = req.body;
    if (!id || !name)
        return res.status(400).json({ error: 'id and name are required.' });
    if (!/^[a-z0-9-]+$/.test(id))
        return res.status(400).json({ error: 'id must be lowercase letters, numbers, and hyphens only.' });
    const existing = db.prepare('SELECT id FROM modules WHERE id = ?').get(id);
    if (existing)
        return res.status(409).json({ error: 'A module with that ID already exists.' });
    const type = (module_type === 'diagram') ? 'diagram' : 'quiz';
    db.prepare(
        `INSERT INTO modules (id, name, icon, description, url, module_type, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, name.trim(), icon || '📋', (description || '').trim(), url || null, type, sort_order ?? 99);
    res.json({ ok: true, id });
});

// ── PUT /api/admin/modules/:id ────────────────────────────
app.put('/api/admin/modules/:id', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const { name, icon, description, url, sort_order, module_type } = req.body;
    const type = module_type !== undefined
        ? ((module_type === 'diagram') ? 'diagram' : 'quiz')
        : mod.module_type;
    db.prepare(
        `UPDATE modules SET name = ?, icon = ?, description = ?, url = ?, module_type = ?, sort_order = ? WHERE id = ?`
    ).run(
        (name ?? mod.name).trim(),
        icon ?? mod.icon,
        description !== undefined ? description.trim() : mod.description,
        url !== undefined ? (url || null) : mod.url,
        type,
        sort_order !== undefined ? sort_order : mod.sort_order,
        req.params.id
    );
    res.json({ ok: true });
});

// ── PATCH /api/admin/modules/:id/toggle ──────────────────
app.patch('/api/admin/modules/:id/toggle', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT id, is_active FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const newState = mod.is_active ? 0 : 1;
    db.prepare('UPDATE modules SET is_active = ? WHERE id = ?').run(newState, req.params.id);
    res.json({ ok: true, is_active: newState });
});

// ── DELETE /api/admin/modules/:id ────────────────────────
app.delete('/api/admin/modules/:id', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    db.prepare('DELETE FROM modules WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// ── GET /api/admin/modules/:id/export ───────────────────
// Export a complete module with all questions as JSON
app.get('/api/admin/modules/:id/export', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT id, name, icon, description, module_type, sort_order FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    
    const questions = db.prepare(
        'SELECT question, opt0, opt1, opt2, opt3, correct_idx, question_type, model_answer, sort_order FROM questions WHERE module_id = ? ORDER BY sort_order, id'
    ).all(req.params.id);
    
    const exportData = {
        exportVersion: '1.0',
        exportDate: new Date().toISOString(),
        module: mod,
        questions: questions
    };
    
    res.json(exportData);
});

// ── POST /api/admin/modules/import ──────────────────────
// Import a complete module with all questions from JSON
app.post('/api/admin/modules/import', adminAuth, (req, res) => {
    const { module, questions, overwrite } = req.body;
    
    if (!module || !module.id || !module.name)
        return res.status(400).json({ error: 'Module data with id and name is required.' });
    
    if (!/^[a-z0-9-]+$/.test(module.id))
        return res.status(400).json({ error: 'Module ID must be lowercase letters, numbers, and hyphens only.' });
    
    // Check if module already exists
    const existing = db.prepare('SELECT id FROM modules WHERE id = ?').get(module.id);
    if (existing && !overwrite)
        return res.status(409).json({ error: 'A module with that ID already exists. Set overwrite=true to replace it.' });
    
    const importTx = db.transaction(() => {
        // Delete existing module and questions if overwriting
        if (existing && overwrite) {
            db.prepare('DELETE FROM questions WHERE module_id = ?').run(module.id);
            db.prepare('DELETE FROM modules WHERE id = ?').run(module.id);
        }
        
        // Create the module
        db.prepare(
            `INSERT INTO modules (id, name, icon, description, url, module_type, is_active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(
            module.id,
            module.name.trim(),
            module.icon || '📋',
            (module.description || '').trim(),
            module.url || null,
            module.module_type || 'quiz',
            module.sort_order ?? 99
        );
        
        // Insert questions
        if (questions && questions.length > 0) {
            const insertQuestion = db.prepare(
                `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, question_type, model_answer, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            
            questions.forEach((q, i) => {
                insertQuestion.run(
                    module.id,
                    q.question?.trim() || '',
                    q.opt0?.trim() || null,
                    q.opt1?.trim() || null,
                    q.opt2?.trim() || null,
                    q.opt3?.trim() || null,
                    q.correct_idx !== undefined ? q.correct_idx : null,
                    q.question_type || 'multiple_choice',
                    q.model_answer?.trim() || null,
                    q.sort_order !== undefined ? q.sort_order : i
                );
            });
        }
    });
    
    try {
        importTx();
        const qCount = db.prepare('SELECT COUNT(*) as c FROM questions WHERE module_id = ?').get(module.id).c;
        res.json({ 
            ok: true, 
            id: module.id, 
            action: existing && overwrite ? 'overwritten' : 'created',
            questionsImported: questions?.length || 0,
            totalQuestions: qCount
        });
    } catch (err) {
        res.status(500).json({ error: 'Import failed: ' + err.message });
    }
});

// ── GET /api/admin/modules/:id/questions ─────────────────
// Returns questions WITH correct answer index — admin-only
app.get('/api/admin/modules/:id/questions', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const qs = db.prepare(
        'SELECT * FROM questions WHERE module_id = ? ORDER BY sort_order, id'
    ).all(req.params.id);
    res.json(qs);
});

// ── POST /api/admin/modules/:id/questions ─────────────────
app.post('/api/admin/modules/:id/questions', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const { question, opt0, opt1, opt2, opt3, correct_idx, question_type, model_answer } = req.body;
    
    // Validate based on question type
    const qType = question_type || 'multiple_choice';
    if (qType === 'multiple_choice') {
        if (!question || opt0 === undefined || opt1 === undefined || opt2 === undefined || opt3 === undefined || correct_idx === undefined)
            return res.status(400).json({ error: 'question, opt0–opt3, and correct_idx are all required for multiple choice questions.' });
        if (![0, 1, 2, 3].includes(Number(correct_idx)))
            return res.status(400).json({ error: 'correct_idx must be 0, 1, 2, or 3.' });
    } else if (qType === 'open_ended') {
        if (!question)
            return res.status(400).json({ error: 'question is required for open-ended questions.' });
    }
    
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM questions WHERE module_id = ?').get(req.params.id).m ?? -1;
    const result = db.prepare(
        `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, question_type, model_answer, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        req.params.id, 
        question.trim(), 
        opt0?.trim() || null, 
        opt1?.trim() || null, 
        opt2?.trim() || null, 
        opt3?.trim() || null, 
        correct_idx !== undefined ? Number(correct_idx) : null,
        qType,
        model_answer?.trim() || null,
        maxOrder + 1
    );
    res.json({ ok: true, id: result.lastInsertRowid });
});

// ── PUT /api/admin/questions/:qid ────────────────────────
app.put('/api/admin/questions/:qid', adminAuth, (req, res) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Question not found.' });
    const { question, opt0, opt1, opt2, opt3, correct_idx, question_type, model_answer } = req.body;
    
    // Validate correct_idx if provided
    if (correct_idx !== undefined && correct_idx !== null && ![0, 1, 2, 3].includes(Number(correct_idx)))
        return res.status(400).json({ error: 'correct_idx must be 0, 1, 2, or 3.' });
    
    const qType = question_type ?? q.question_type;
    
    db.prepare(
        `UPDATE questions SET question = ?, opt0 = ?, opt1 = ?, opt2 = ?, opt3 = ?, correct_idx = ?, question_type = ?, model_answer = ? WHERE id = ?`
    ).run(
        (question ?? q.question).trim(),
        opt0 !== undefined ? (opt0?.trim() || null) : q.opt0,
        opt1 !== undefined ? (opt1?.trim() || null) : q.opt1,
        opt2 !== undefined ? (opt2?.trim() || null) : q.opt2,
        opt3 !== undefined ? (opt3?.trim() || null) : q.opt3,
        correct_idx !== undefined ? (correct_idx !== null ? Number(correct_idx) : null) : q.correct_idx,
        qType,
        model_answer !== undefined ? (model_answer?.trim() || null) : q.model_answer,
        q.id
    );
    res.json({ ok: true });
});

// ── DELETE /api/admin/questions/:qid ─────────────────────
app.delete('/api/admin/questions/:qid', adminAuth, (req, res) => {
    const q = db.prepare('SELECT id FROM questions WHERE id = ?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Question not found.' });
    db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
    res.json({ ok: true });
});

// ── PATCH /api/admin/questions/:qid/reorder ───────────────
// Move a question up or down in the sort order
// Body: { direction: 'up' | 'down' }
app.patch('/api/admin/questions/:qid/reorder', adminAuth, (req, res) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Question not found.' });
    
    const { direction } = req.body;
    if (!direction || !['up', 'down'].includes(direction))
        return res.status(400).json({ error: 'direction must be "up" or "down".' });

    // Find the adjacent question to swap with
    const adjacentQ = db.prepare(
        direction === 'up'
            ? 'SELECT * FROM questions WHERE module_id = ? AND (sort_order < ? OR (sort_order = ? AND id < ?)) ORDER BY sort_order DESC, id DESC LIMIT 1'
            : 'SELECT * FROM questions WHERE module_id = ? AND (sort_order > ? OR (sort_order = ? AND id > ?)) ORDER BY sort_order ASC, id ASC LIMIT 1'
    ).get(q.module_id, q.sort_order, q.sort_order, q.id);

    if (!adjacentQ)
        return res.status(400).json({ error: `Cannot move ${direction}: already at the ${direction === 'up' ? 'top' : 'bottom'}.` });

    // Swap sort_order values
    const updateStmt = db.prepare('UPDATE questions SET sort_order = ? WHERE id = ?');
    const doSwap = db.transaction(() => {
        updateStmt.run(adjacentQ.sort_order, q.id);
        updateStmt.run(q.sort_order, adjacentQ.id);
    });
    doSwap();

    res.json({ ok: true });
});

// ── POST /api/admin/modules/:id/import-csv ───────────────
// Body: { csv: "<raw csv string>", replace: false }
// replace=true clears existing questions before importing
app.post('/api/admin/modules/:id/import-csv', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });

    const { csv, replace } = req.body;
    if (!csv || typeof csv !== 'string')
        return res.status(400).json({ error: 'csv string is required.' });

    // ── Minimal CSV parser (handles quoted fields with commas inside) ──
    function parseCSV(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        return lines.map(line => {
            const fields = [];
            let cur = '', inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuote = !inQuote;
                } else if (ch === ',' && !inQuote) {
                    fields.push(cur.trim()); cur = '';
                } else {
                    cur += ch;
                }
            }
            fields.push(cur.trim());
            return fields;
        });
    }

    const rows = parseCSV(csv).filter(r => r.some(f => f !== ''));
    if (!rows.length) return res.status(400).json({ error: 'CSV appears to be empty.' });

    // Detect and skip header row
    const firstRow = rows[0].map(f => f.toLowerCase().replace(/[^a-z_]/g, ''));
    const hasHeader = firstRow.includes('question') || firstRow.includes('option_a') || firstRow.includes('optiona') || firstRow.includes('correct');
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const imported = [], skipped = [];

    const insertStmt = db.prepare(
        `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, question_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const doImport = db.transaction(() => {
        if (replace) {
            db.prepare('DELETE FROM questions WHERE module_id = ?').run(req.params.id);
        }
        let order = replace ? 0
            : (db.prepare('SELECT MAX(sort_order) as m FROM questions WHERE module_id = ?').get(req.params.id).m ?? -1) + 1;

        dataRows.forEach((fields, i) => {
            const rowNum = (hasHeader ? i + 2 : i + 1);
            
            // Check for question_type column (optional, defaults to multiple_choice)
            const hasTypeCol = fields.length >= 7;
            const qType = hasTypeCol ? fields[6]?.trim() : 'multiple_choice';
            const isMultipleChoice = !qType || qType === 'multiple_choice';
            
            if (isMultipleChoice) {
                // Expected: question, opt0, opt1, opt2, opt3, correct_idx [, question_type]
                if (fields.length < 6) {
                    skipped.push({ row: rowNum, reason: 'Not enough columns (need 6: question, A, B, C, D, correct_index)' });
                    return;
                }
                const [question, opt0, opt1, opt2, opt3, correctRaw] = fields;
                const correct_idx = parseInt(correctRaw, 10);
                if (!question) { skipped.push({ row: rowNum, reason: 'Question text is empty' }); return; }
                if (!opt0 || !opt1 || !opt2 || !opt3) { skipped.push({ row: rowNum, reason: 'One or more options are empty' }); return; }
                if (![0, 1, 2, 3].includes(correct_idx)) { skipped.push({ row: rowNum, reason: `correct_index must be 0–3, got "${correctRaw}"` }); return; }

                insertStmt.run(req.params.id, question, opt0, opt1, opt2, opt3, correct_idx, 'multiple_choice', order++);
                imported.push(rowNum);
            } else {
                // Open-ended question: question [, question_type, model_answer]
                const question = fields[0];
                const modelAnswer = fields[2] || null;
                if (!question) { skipped.push({ row: rowNum, reason: 'Question text is empty' }); return; }
                
                insertStmt.run(req.params.id, question, null, null, null, null, null, 'open_ended', order++);
                imported.push(rowNum);
            }
        });
    });

    try {
        doImport();
        res.json({ ok: true, imported: imported.length, skipped });
    } catch (err) {
        res.status(500).json({ error: 'Database error during import: ' + err.message });
    }
});


// ── POST /api/submit ─────────────────────────────────────
app.post('/api/submit', auth, (req, res) => {
    const { moduleId, moduleName, answers } = req.body;
    if (!moduleId || !moduleName || !Array.isArray(answers))
        return res.status(400).json({ error: 'moduleId, moduleName, and answers array are required.' });

    // Load questions from DB (ordered the same way the client received them)
    const bank = db.prepare(
        'SELECT id, question, opt0, opt1, opt2, opt3, correct_idx, question_type FROM questions WHERE module_id = ? ORDER BY sort_order, id'
    ).all(moduleId);
    if (!bank.length) return res.status(400).json({ error: 'Unknown module or no questions found.' });

    // Score server-side — client never sends is_correct or correct_option
    const scored = answers.map((a, i) => {
        const question = bank[a.question_index ?? i];
        const isOpenEnded = question?.question_type === 'open_ended';
        
        if (isOpenEnded) {
            // Open-ended questions: no scoring, just record the response
            return {
                question_index: a.question_index ?? i,
                question_text: question ? question.question : (a.question_text || ''),
                chosen_option: a.chosen_option ?? null,
                correct_option: '(Open-ended - no correct answer)',
                is_correct: false // Open-ended questions don't count toward score
            };
        } else {
            // Multiple choice: score normally
            const correctOpt = question ? [question.opt0, question.opt1, question.opt2, question.opt3][question.correct_idx] : '';
            const isCorrect = a.chosen_option !== null && a.chosen_option !== undefined
                && a.chosen_option === correctOpt;
            return {
                question_index: a.question_index ?? i,
                question_text: question ? question.question : (a.question_text || ''),
                chosen_option: a.chosen_option ?? null,
                correct_option: correctOpt,
                is_correct: isCorrect
            };
        }
    });

    // Only count multiple choice questions for scoring
    const mcQuestions = scored.filter(a => a.correct_option !== '(Open-ended - no correct answer)');
    const correct = mcQuestions.filter(a => a.is_correct).length;
    const total = mcQuestions.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    const session = db.prepare(
        'INSERT INTO test_sessions (candidate_id, module_id, module_name, score, total, pct) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.candidate.id, moduleId, moduleName, correct, total, pct);

    const insertAnswer = db.prepare(
        'INSERT INTO answers (session_id, question_index, question_text, chosen_option, correct_option, is_correct) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertMany = db.transaction((rows) => {
        for (const a of rows) {
            insertAnswer.run(session.lastInsertRowid, a.question_index, a.question_text,
                a.chosen_option ?? null, a.correct_option, a.is_correct ? 1 : 0);
        }
    });
    insertMany(scored);

    // Consume the retake grant (single-use) if one existed
    db.prepare(
        'DELETE FROM retake_grants WHERE candidate_id = ? AND module_id = ?'
    ).run(req.candidate.id, moduleId);

    // Send email notification (non-blocking)
    sendResultsEmail({
        candidateName: req.candidate.name,
        candidateEmail: req.candidate.email,
        moduleName,
        score: correct,
        total,
        pct,
        answers: scored
    });

    res.json({ sessionId: session.lastInsertRowid, score: correct, total, pct });
});

// ── sendResultsEmail ──────────────────────────────────────
async function sendResultsEmail({ candidateName, candidateEmail, moduleName, score, total, pct, answers }) {
    if (!SG_KEY || SG_KEY === 'SG.your-api-key-here' || !NOTIFY_EMAIL || !SG_FROM) return;

    // Escape user-generated content to prevent XSS
    const safeName = escapeHtml(candidateName);
    const safeEmail = escapeHtml(candidateEmail);
    const safeModuleName = escapeHtml(moduleName);

    const passed = pct >= 70;
    const scoreColor = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
    const resultText = passed ? '✅ PASSED' : '❌ NEEDS REVIEW';

    const answersHtml = answers.map((a, i) => {
        const isOpenEnded = a.correct_option === '(Open-ended - no correct answer)';
        const correct = !!a.is_correct;
        const icon = isOpenEnded ? '📝' : (correct ? '✅' : (a.chosen_option ? '❌' : '⬜'));
        const chosen = a.chosen_option 
            ? escapeHtml(a.chosen_option) 
            : '<em style="color:#888">Not answered</em>';
        const correctAns = isOpenEnded 
            ? '<em style="color:#8b90b0">Open-ended response</em>' 
            : escapeHtml(a.correct_option || '');
        const answerColor = isOpenEnded ? '#8b90b0' : (correct ? '#22c55e' : '#ef4444');
        
        return `
        <tr style="border-bottom:1px solid #2e3350;">
          <td style="padding:10px 12px;color:#8b90b0;font-size:13px;vertical-align:top;">${icon} Q${i + 1}</td>
          <td style="padding:10px 12px;font-size:13px;vertical-align:top;">${escapeHtml(a.question_text || '')}</td>
          <td style="padding:10px 12px;font-size:13px;vertical-align:top;color:${answerColor};">${chosen}</td>
          <td style="padding:10px 12px;font-size:13px;vertical-align:top;color:#22c55e;">${correctAns}</td>
        </tr>`;
    }).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;color:#e8eaf6;">
      <div style="max-width:680px;margin:32px auto;background:#1a1d27;border:1px solid #2e3350;border-radius:14px;overflow:hidden;">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#4f8ef7,#7c5cfc);padding:28px 32px;">
          <div style="font-size:22px;font-weight:700;color:#fff;">Assessment Results</div>
          <div style="font-size:14px;color:rgba(255,255,255,.75);margin-top:4px;">${safeModuleName}</div>
        </div>

        <!-- Score card -->
        <div style="padding:28px 32px;border-bottom:1px solid #2e3350;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-size:13px;color:#8b90b0;margin-bottom:4px;">Candidate</div>
                <div style="font-size:16px;font-weight:600;">${safeName}</div>
                <div style="font-size:13px;color:#8b90b0;">${safeEmail}</div>
              </td>
              <td style="text-align:right;">
                <div style="font-size:42px;font-weight:700;color:${scoreColor};">${pct}%</div>
                <div style="font-size:13px;color:#8b90b0;">${score} / ${total} correct</div>
                <div style="margin-top:6px;font-size:13px;font-weight:600;color:${scoreColor};">${resultText}</div>
              </td>
            </tr>
          </table>
        </div>

        <!-- Answer breakdown -->
        <div style="padding:24px 32px 8px;">
          <div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#8b90b0;margin-bottom:12px;">Answer Breakdown</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2e3350;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background:#22263a;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#8b90b0;font-weight:600;">#</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#8b90b0;font-weight:600;">Question</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#8b90b0;font-weight:600;">Answer Given</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#8b90b0;font-weight:600;">Correct Answer</th>
              </tr>
            </thead>
            <tbody>${answersHtml}</tbody>
          </table>
        </div>

        <!-- Footer -->
        <div style="padding:20px 32px;font-size:12px;color:#4a5080;text-align:center;">
          Sent automatically by Assessment Portal · ${new Date().toLocaleString()}
        </div>
      </div>
    </body>
    </html>`;

    try {
        await sgMail.send({
            to: NOTIFY_EMAIL,
            from: SG_FROM,
            subject: `[Assessment] ${candidateName} – ${moduleName} – ${pct}%`,
            html
        });
        console.log(`✉️  Results email sent for ${candidateName} (${moduleName} ${pct}%)`);
    } catch (err) {
        console.error('SendGrid error:', err.response?.body?.errors || err.message);
    }
}

// ── GET /api/results/:candidateId ────────────────────────
// Returns limited session info without scores or answers (candidates shouldn't see results)
app.get('/api/results/:candidateId', auth, (req, res) => {
    const id = parseInt(req.params.candidateId);
    if (req.candidate.id !== id)
        return res.status(403).json({ error: 'Access denied.' });

    const sessions = db.prepare(`
        SELECT ts.id, ts.module_id, ts.module_name, ts.submitted_at
        FROM test_sessions ts
        WHERE ts.candidate_id = ?
        ORDER BY ts.submitted_at DESC
    `).all(id);

    // Return only basic info - no scores, no answers
    res.json(sessions);
});

// ── GET /api/admin/results ───────────────────────────────
// Protected: admin JWT required
app.get('/api/admin/results', adminAuth, (req, res) => {
    const sessions = db.prepare(`
        SELECT ts.*, c.name as candidate_name, c.email as candidate_email
        FROM test_sessions ts
        JOIN candidates c ON c.id = ts.candidate_id
        ORDER BY ts.submitted_at DESC
    `).all();

    const detailed = sessions.map(s => {
        const ans = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY question_index').all(s.id);
        return { ...s, answers: ans };
    });

    res.json(detailed);
});

// ── GET /api/admin/candidates ────────────────────────────
// Returns all registered candidates with session count and latest score
app.get('/api/admin/candidates', adminAuth, (req, res) => {
    const candidates = db.prepare(`
        SELECT
            c.id,
            c.name,
            c.email,
            c.created_at,
            COUNT(ts.id)          AS session_count,
            MAX(ts.submitted_at)  AS last_activity,
            ROUND(AVG(ts.pct), 0) AS avg_score
        FROM candidates c
        LEFT JOIN test_sessions ts ON ts.candidate_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `).all();
    res.json(candidates);
});

// ── GET /api/me ──────────────────────────────────────────
app.get('/api/me', auth, (req, res) => {
    const candidate = db.prepare('SELECT id, name, email, created_at FROM candidates WHERE id = ?').get(req.candidate.id);
    res.json(candidate);
});

// ── GET /api/diagram/prompt/:moduleId ────────────────────
// Returns module description as the diagram prompt
app.get('/api/diagram/prompt/:moduleId', auth, (req, res) => {
    const mod = db.prepare('SELECT id, name, description FROM modules WHERE id = ?').get(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    res.json({ id: mod.id, name: mod.name, prompt: mod.description });
});

// ── POST /api/diagram/submit ─────────────────────────────
// Supports both new submissions and updates to existing ones
app.post('/api/diagram/submit', auth, (req, res) => {
    const { moduleId, moduleName, sceneData, imageData, submissionId } = req.body;
    if (!moduleId || !moduleName || !sceneData)
        return res.status(400).json({ error: 'moduleId, moduleName, and sceneData are required.' });

    // Validate JSON
    try { JSON.parse(sceneData); } catch {
        return res.status(400).json({ error: 'sceneData must be valid JSON.' });
    }

    let resultId;

    if (submissionId) {
        // Update existing submission (verify ownership)
        const existing = db.prepare(
            'SELECT id FROM diagram_submissions WHERE id = ? AND candidate_id = ?'
        ).get(submissionId, req.candidate.id);
        if (!existing) return res.status(404).json({ error: 'Submission not found.' });

        db.prepare(
            `UPDATE diagram_submissions SET scene_data = ?, image_data = ?, submitted_at = datetime('now')
             WHERE id = ?`
        ).run(sceneData, imageData || null, submissionId);
        resultId = submissionId;
    } else {
        // New submission
        const result = db.prepare(
            `INSERT INTO diagram_submissions (candidate_id, module_id, module_name, scene_data, image_data)
             VALUES (?, ?, ?, ?, ?)`
        ).run(req.candidate.id, moduleId, moduleName, sceneData, imageData || null);
        resultId = result.lastInsertRowid;
    }

    // Consume retake grant if one existed
    db.prepare(
        'DELETE FROM retake_grants WHERE candidate_id = ? AND module_id = ?'
    ).run(req.candidate.id, moduleId);

    // Send email notification (non-blocking)
    sendDiagramEmail({
        candidateName: req.candidate.name,
        candidateEmail: req.candidate.email,
        moduleName,
        submissionId: resultId
    });

    res.json({ submissionId: resultId });
});

// ── GET /api/diagram/submission-data/:id ──────────────────
// Candidate can fetch their own submission scene data for re-editing
app.get('/api/diagram/submission-data/:id', auth, (req, res) => {
    const sub = db.prepare(
        'SELECT id, scene_data FROM diagram_submissions WHERE id = ? AND candidate_id = ?'
    ).get(req.params.id, req.candidate.id);
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });
    res.json(sub);
});

// ── sendDiagramEmail ──────────────────────────────────────
async function sendDiagramEmail({ candidateName, candidateEmail, moduleName, submissionId }) {
    if (!SG_KEY || SG_KEY === 'SG.your-api-key-here' || !NOTIFY_EMAIL || !SG_FROM) return;

    // Escape user-generated content to prevent XSS
    const safeName = escapeHtml(candidateName);
    const safeEmail = escapeHtml(candidateEmail);
    const safeModuleName = escapeHtml(moduleName);

    const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Arial,sans-serif;color:#e8eaf6;">
      <div style="max-width:680px;margin:32px auto;background:#1a1d27;border:1px solid #2e3350;border-radius:14px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#4f8ef7,#7c5cfc);padding:28px 32px;">
          <div style="font-size:22px;font-weight:700;color:#fff;">📐 Diagram Submission</div>
          <div style="font-size:14px;color:rgba(255,255,255,.75);margin-top:4px;">${safeModuleName}</div>
        </div>
        <div style="padding:28px 32px;">
          <div style="font-size:13px;color:#8b90b0;margin-bottom:4px;">Candidate</div>
          <div style="font-size:16px;font-weight:600;">${safeName}</div>
          <div style="font-size:13px;color:#8b90b0;">${safeEmail}</div>
          <div style="margin-top:20px;padding:14px;background:#22263a;border:1px solid #2e3350;border-radius:10px;font-size:14px;color:#8b90b0;">
            A diagram has been submitted. Log in to the admin panel to view the full drawing.
          </div>
        </div>
        <div style="padding:20px 32px;font-size:12px;color:#4a5080;text-align:center;">
          Sent automatically by Assessment Portal · ${new Date().toLocaleString()}
        </div>
      </div>
    </body>
    </html>`;

    try {
        await sgMail.send({
            to: NOTIFY_EMAIL,
            from: SG_FROM,
            subject: `[Assessment] ${safeName} – ${safeModuleName} – Diagram Submitted`,
            html
        });
        console.log(`✉️  Diagram email sent for ${safeName} (${safeModuleName})`);
    } catch (err) {
        console.error('SendGrid error:', err.response?.body?.errors || err.message);
    }
}

// ── GET /api/admin/diagram-submissions ───────────────────
app.get('/api/admin/diagram-submissions', adminAuth, (req, res) => {
    const subs = db.prepare(`
        SELECT ds.id, ds.module_id, ds.module_name, ds.submitted_at,
               c.name as candidate_name, c.email as candidate_email
        FROM diagram_submissions ds
        JOIN candidates c ON c.id = ds.candidate_id
        ORDER BY ds.submitted_at DESC
    `).all();
    res.json(subs);
});

// ── GET /api/admin/diagram-submissions/:id ───────────────
app.get('/api/admin/diagram-submissions/:id', adminAuth, (req, res) => {
    const sub = db.prepare(`
        SELECT ds.*, c.name as candidate_name, c.email as candidate_email
        FROM diagram_submissions ds
        JOIN candidates c ON c.id = ds.candidate_id
        WHERE ds.id = ?
    `).get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });
    res.json(sub);
});

// ── DELETE /api/admin/diagram-submissions/:id ────────────
app.delete('/api/admin/diagram-submissions/:id', adminAuth, (req, res) => {
    const result = db.prepare('DELETE FROM diagram_submissions WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Submission not found.' });
    res.json({ success: true });
});

// ── GET /api/diagram/submissions/:candidateId ────────────
// Candidate can check if they already submitted a diagram for a module
app.get('/api/diagram/submissions/:candidateId', auth, (req, res) => {
    const id = parseInt(req.params.candidateId);
    if (req.candidate.id !== id)
        return res.status(403).json({ error: 'Access denied.' });
    const subs = db.prepare(
        'SELECT id, module_id, module_name, submitted_at FROM diagram_submissions WHERE candidate_id = ? ORDER BY submitted_at DESC'
    ).all(id);
    res.json(subs);
});

// ── GET /api/admin/candidate/:id ──────────────────────────
// Returns complete details for a single candidate
app.get('/api/admin/candidate/:id', adminAuth, (req, res) => {
    const candidateId = parseInt(req.params.id);
    if (isNaN(candidateId)) return res.status(400).json({ error: 'Invalid candidate ID.' });

    // Candidate info
    const candidate = db.prepare(`
        SELECT c.id, c.name, c.email, c.created_at as registered_at,
               COUNT(DISTINCT ts.id) as session_count,
               ROUND(AVG(ts.pct), 1) as avg_score
        FROM candidates c
        LEFT JOIN test_sessions ts ON ts.candidate_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
    `).get(candidateId);

    if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });

    // Quiz sessions with answers
    const sessions = db.prepare(`
        SELECT ts.*
        FROM test_sessions ts
        WHERE ts.candidate_id = ?
        ORDER BY ts.submitted_at DESC
    `).all(candidateId);

    const sessionIds = sessions.map(s => s.id);
    let answersBySession = {};
    if (sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => '?').join(',');
        const allAnswers = db.prepare(`
            SELECT * FROM answers WHERE session_id IN (${placeholders}) ORDER BY question_index
        `).all(...sessionIds);
        allAnswers.forEach(a => {
            if (!answersBySession[a.session_id]) answersBySession[a.session_id] = [];
            answersBySession[a.session_id].push(a);
        });
    }

    const quizSessions = sessions.map(s => ({
        ...s,
        answers: answersBySession[s.id] || []
    }));

    // Diagram submissions
    const diagramSubmissions = db.prepare(`
        SELECT ds.id, ds.module_id, ds.module_name, ds.image_data, ds.submitted_at
        FROM diagram_submissions ds
        WHERE ds.candidate_id = ?
        ORDER BY ds.submitted_at DESC
    `).all(candidateId);

    res.json({
        ...candidate,
        quizSessions,
        diagramSubmissions
    });
});

// ── GET /api/admin/report ─────────────────────────────────
// Full aggregated report: all candidates, quiz sessions, diagram submissions
app.get('/api/admin/report', adminAuth, (req, res) => {

    // All registered candidates
    const candidates = db.prepare(`
        SELECT c.id, c.name, c.email, c.created_at,
               COUNT(DISTINCT ts.id) as session_count,
               ROUND(AVG(ts.pct), 1) as avg_score
        FROM candidates c
        LEFT JOIN test_sessions ts ON ts.candidate_id = c.id
        GROUP BY c.id
        ORDER BY c.name ASC
    `).all();

    // All quiz sessions with answers (flat, then grouped per candidate)
    const allSessions = db.prepare(`
        SELECT ts.*, c.name as candidate_name, c.email as candidate_email
        FROM test_sessions ts
        JOIN candidates c ON c.id = ts.candidate_id
        ORDER BY ts.candidate_id, ts.submitted_at DESC
    `).all();

    const allAnswers = db.prepare(
        'SELECT * FROM answers ORDER BY session_id, question_index'
    ).all();
    const answersBySession = {};
    allAnswers.forEach(a => {
        if (!answersBySession[a.session_id]) answersBySession[a.session_id] = [];
        answersBySession[a.session_id].push(a);
    });

    // All diagram submissions (including image_data for PDF embedding)
    const allDiagrams = db.prepare(`
        SELECT ds.id, ds.candidate_id, ds.module_id, ds.module_name,
               ds.image_data, ds.submitted_at,
               c.name as candidate_name, c.email as candidate_email
        FROM diagram_submissions ds
        JOIN candidates c ON c.id = ds.candidate_id
        ORDER BY ds.candidate_id, ds.submitted_at DESC
    `).all();

    // Overall summary stats
    const allPcts = allSessions.map(s => s.pct).filter(p => p != null);
    const avgScore = allPcts.length
        ? Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length)
        : null;

    // Build per-candidate report objects
    const report = candidates.map(c => {
        const quizSessions = allSessions
            .filter(s => s.candidate_id === c.id)
            .map(s => ({
                id: s.id,
                module_id: s.module_id,
                module_name: s.module_name,
                score: s.score,
                total: s.total,
                pct: s.pct,
                submitted_at: s.submitted_at,
                answers: (answersBySession[s.id] || []).map(a => ({
                    question_text: a.question_text,
                    chosen_option: a.chosen_option,
                    correct_option: a.correct_option,
                    is_correct: !!a.is_correct
                }))
            }));

        const diagramSubmissions = allDiagrams
            .filter(d => d.candidate_id === c.id)
            .map(d => ({
                id: d.id,
                module_id: d.module_id,
                module_name: d.module_name,
                submitted_at: d.submitted_at,
                image_data: d.image_data || null
            }));

        return {
            id: c.id,
            name: c.name,
            email: c.email,
            registered_at: c.created_at,
            session_count: c.session_count,
            avg_score: c.avg_score,
            quizSessions,
            diagramSubmissions
        };
    });

    res.json({
        generatedAt: new Date().toISOString(),
        summary: {
            totalCandidates: candidates.length,
            totalSessions: allSessions.length,
            totalDiagrams: allDiagrams.length,
            avgScore
        },
        candidates: report
    });
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n✅  Assessment Portal running at http://localhost:${PORT}`);
    console.log(`    Admin login: http://localhost:${PORT}/admin-login.html\n`);
});