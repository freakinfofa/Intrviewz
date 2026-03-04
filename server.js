require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const rateLimit = require('express-rate-limit');
const sgMail = require('@sendgrid/mail');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Serve module directories (legacy standalone quiz pages) ──
// Express mount paths don't reliably match URL-encoded spaces,
// so we use explicit route handlers instead.
app.get('/AD%20Management/:file', (req, res) => {
    res.sendFile(path.join(__dirname, 'AD Management', req.params.file));
});
app.get('/OneDrive%20Managament/:file', (req, res) => {
    res.sendFile(path.join(__dirname, 'OneDrive Managament', req.params.file));
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
        { id: 'networking', name: 'Networking Fundamentals', icon: '🌐', description: 'TCP/IP, subnetting, routing protocols, VLANs, and network troubleshooting.', url: null, sort_order: 2, is_active: 0 },
        { id: 'security', name: 'Security & Compliance', icon: '🔒', description: 'Cybersecurity principles, threat vectors, access control, and compliance frameworks.', url: null, sort_order: 3, is_active: 0 },
        { id: 'powershell', name: 'PowerShell & Scripting', icon: '⚡', description: 'PowerShell cmdlets, scripting best practices, and AD automation.', url: null, sort_order: 4, is_active: 0 },
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
        ]
    }
};

(function seedIfEmpty() {
    const count = db.prepare('SELECT COUNT(*) as c FROM modules').get().c;
    if (count > 0) return;
    console.log('🌱  Seeding question banks into database...');
    const insertModule = db.prepare(
        `INSERT OR IGNORE INTO modules (id, name, icon, description, url, is_active, sort_order)
         VALUES (@id, @name, @icon, @description, @url, @is_active, @sort_order)`
    );
    const insertQuestion = db.prepare(
        `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, sort_order)
         VALUES (@module_id, @question, @opt0, @opt1, @opt2, @opt3, @correct_idx, @sort_order)`
    );
    const seedTx = db.transaction(() => {
        for (const m of SEED_DATA.modules) {
            insertModule.run({ is_active: 1, ...m });
        }
        for (const [moduleId, qs] of Object.entries(SEED_DATA.questions)) {
            qs.forEach((q, i) => {
                insertQuestion.run({
                    module_id: moduleId,
                    question: q.q,
                    opt0: q.opts[0], opt1: q.opts[1],
                    opt2: q.opts[2], opt3: q.opts[3],
                    correct_idx: q.ans,
                    sort_order: i
                });
            });
        }
    });
    seedTx();
    console.log('✅  Seed complete.');
})();

// ── GET /api/questions/:moduleId ─────────────────────────
// Returns questions WITHOUT the answer index (stripped server-side)
app.get('/api/questions/:moduleId', auth, (req, res) => {
    const mod = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const qs = db.prepare(
        'SELECT question as q, opt0, opt1, opt2, opt3 FROM questions WHERE module_id = ? ORDER BY sort_order, id'
    ).all(req.params.moduleId);
    res.json(qs.map(r => ({ q: r.q, opts: [r.opt0, r.opt1, r.opt2, r.opt3] })));
});

// ── Candidate auth middleware ─────────────────────────────
// Verifies a regular-user JWT (no role field required)
function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token provided' });
    const token = header.split(' ')[1];
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
// Verifies a JWT that has role === 'admin'
function adminAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token provided' });
    const token = header.split(' ')[1];
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
    if (!name || !email || !password)
        return res.status(400).json({ error: 'Name, email and password are required.' });

    // Prevent registering with the admin email
    if (email.toLowerCase() === ADMIN_EMAIL)
        return res.status(409).json({ error: 'That email address is not available.' });

    const existing = db.prepare('SELECT id FROM candidates WHERE email = ?').get(email.toLowerCase());
    if (existing)
        return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
        'INSERT INTO candidates (name, email, password_hash) VALUES (?, ?, ?)'
    ).run(name.trim(), email.toLowerCase(), hash);

    const token = jwt.sign(
        { id: result.lastInsertRowid, name: name.trim(), email: email.toLowerCase() },
        SECRET, { expiresIn: '8h' }
    );
    res.json({ token, name: name.trim(), id: result.lastInsertRowid });
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
    res.json({ token, name: candidate.name, id: candidate.id });
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
    res.json({ token });
});

// ── GET /api/admin/verify ────────────────────────────────
// Used by admin.html on load to confirm the token is valid admin
app.get('/api/admin/verify', adminAuth, (req, res) => {
    res.json({ ok: true });
});

// ── GET /api/modules ─────────────────────────────────────
app.get('/api/modules', auth, (req, res) => {
    const mods = db.prepare(
        'SELECT id, name, icon, description, url, is_active FROM modules WHERE is_active = 1 ORDER BY sort_order, id'
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
        questions: countMap[m.id] || 0,
        ready: (countMap[m.id] || 0) > 0,
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
    const { id, name, icon, description, url, sort_order } = req.body;
    if (!id || !name)
        return res.status(400).json({ error: 'id and name are required.' });
    if (!/^[a-z0-9-]+$/.test(id))
        return res.status(400).json({ error: 'id must be lowercase letters, numbers, and hyphens only.' });
    const existing = db.prepare('SELECT id FROM modules WHERE id = ?').get(id);
    if (existing)
        return res.status(409).json({ error: 'A module with that ID already exists.' });
    db.prepare(
        `INSERT INTO modules (id, name, icon, description, url, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(id, name.trim(), icon || '📋', (description || '').trim(), url || null, sort_order ?? 99);
    res.json({ ok: true, id });
});

// ── PUT /api/admin/modules/:id ────────────────────────────
app.put('/api/admin/modules/:id', adminAuth, (req, res) => {
    const mod = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Module not found.' });
    const { name, icon, description, url, sort_order } = req.body;
    db.prepare(
        `UPDATE modules SET name = ?, icon = ?, description = ?, url = ?, sort_order = ? WHERE id = ?`
    ).run(
        (name ?? mod.name).trim(),
        icon ?? mod.icon,
        description !== undefined ? description.trim() : mod.description,
        url !== undefined ? (url || null) : mod.url,
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
    const { question, opt0, opt1, opt2, opt3, correct_idx } = req.body;
    if (!question || opt0 === undefined || opt1 === undefined || opt2 === undefined || opt3 === undefined || correct_idx === undefined)
        return res.status(400).json({ error: 'question, opt0–opt3, and correct_idx are all required.' });
    if (![0, 1, 2, 3].includes(Number(correct_idx)))
        return res.status(400).json({ error: 'correct_idx must be 0, 1, 2, or 3.' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM questions WHERE module_id = ?').get(req.params.id).m ?? -1;
    const result = db.prepare(
        `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.id, question.trim(), opt0.trim(), opt1.trim(), opt2.trim(), opt3.trim(), Number(correct_idx), maxOrder + 1);
    res.json({ ok: true, id: result.lastInsertRowid });
});

// ── PUT /api/admin/questions/:qid ────────────────────────
app.put('/api/admin/questions/:qid', adminAuth, (req, res) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Question not found.' });
    const { question, opt0, opt1, opt2, opt3, correct_idx } = req.body;
    if (correct_idx !== undefined && ![0, 1, 2, 3].includes(Number(correct_idx)))
        return res.status(400).json({ error: 'correct_idx must be 0, 1, 2, or 3.' });
    db.prepare(
        `UPDATE questions SET question = ?, opt0 = ?, opt1 = ?, opt2 = ?, opt3 = ?, correct_idx = ? WHERE id = ?`
    ).run(
        (question ?? q.question).trim(),
        (opt0 ?? q.opt0).trim(),
        (opt1 ?? q.opt1).trim(),
        (opt2 ?? q.opt2).trim(),
        (opt3 ?? q.opt3).trim(),
        correct_idx !== undefined ? Number(correct_idx) : q.correct_idx,
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
        `INSERT INTO questions (module_id, question, opt0, opt1, opt2, opt3, correct_idx, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const doImport = db.transaction(() => {
        if (replace) {
            db.prepare('DELETE FROM questions WHERE module_id = ?').run(req.params.id);
        }
        let order = replace ? 0
            : (db.prepare('SELECT MAX(sort_order) as m FROM questions WHERE module_id = ?').get(req.params.id).m ?? -1) + 1;

        dataRows.forEach((fields, i) => {
            const rowNum = (hasHeader ? i + 2 : i + 1);
            // Expected: question, opt0, opt1, opt2, opt3, correct_idx
            if (fields.length < 6) {
                skipped.push({ row: rowNum, reason: 'Not enough columns (need 6: question, A, B, C, D, correct_index)' });
                return;
            }
            const [question, opt0, opt1, opt2, opt3, correctRaw] = fields;
            const correct_idx = parseInt(correctRaw, 10);
            if (!question) { skipped.push({ row: rowNum, reason: 'Question text is empty' }); return; }
            if (!opt0 || !opt1 || !opt2 || !opt3) { skipped.push({ row: rowNum, reason: 'One or more options are empty' }); return; }
            if (![0, 1, 2, 3].includes(correct_idx)) { skipped.push({ row: rowNum, reason: `correct_index must be 0–3, got "${correctRaw}"` }); return; }

            insertStmt.run(req.params.id, question, opt0, opt1, opt2, opt3, correct_idx, order++);
            imported.push(rowNum);
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
        'SELECT id, question, opt0, opt1, opt2, opt3, correct_idx FROM questions WHERE module_id = ? ORDER BY sort_order, id'
    ).all(moduleId);
    if (!bank.length) return res.status(400).json({ error: 'Unknown module or no questions found.' });

    // Score server-side — client never sends is_correct or correct_option
    const scored = answers.map((a, i) => {
        const question = bank[a.question_index ?? i];
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
    });

    const correct = scored.filter(a => a.is_correct).length;
    const total = scored.length;
    const pct = Math.round((correct / total) * 100);

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

    const passed = pct >= 70;
    const scoreColor = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
    const resultText = passed ? '✅ PASSED' : '❌ NEEDS REVIEW';

    const answersHtml = answers.map((a, i) => {
        const correct = !!a.is_correct;
        const icon = correct ? '✅' : (a.chosen_option ? '❌' : '⬜');
        const chosen = a.chosen_option || '<em style="color:#888">Not answered</em>';
        return `
        <tr style="border-bottom:1px solid #2e3350;">
          <td style="padding:10px 12px;color:#8b90b0;font-size:13px;vertical-align:top;">${icon} Q${i + 1}</td>
          <td style="padding:10px 12px;font-size:13px;vertical-align:top;">${a.question_text}</td>
          <td style="padding:10px 12px;font-size:13px;vertical-align:top;color:${correct ? '#22c55e' : '#ef4444'};">${chosen}</td>
          <td style="padding:10px 12px;font-size:13px;vertical-align:top;color:#22c55e;">${a.correct_option}</td>
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
          <div style="font-size:14px;color:rgba(255,255,255,.75);margin-top:4px;">${moduleName}</div>
        </div>

        <!-- Score card -->
        <div style="padding:28px 32px;border-bottom:1px solid #2e3350;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-size:13px;color:#8b90b0;margin-bottom:4px;">Candidate</div>
                <div style="font-size:16px;font-weight:600;">${candidateName}</div>
                <div style="font-size:13px;color:#8b90b0;">${candidateEmail}</div>
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
app.get('/api/results/:candidateId', auth, (req, res) => {
    const id = parseInt(req.params.candidateId);
    if (req.candidate.id !== id)
        return res.status(403).json({ error: 'Access denied.' });

    const sessions = db.prepare(`
        SELECT ts.*, c.name as candidate_name
        FROM test_sessions ts
        JOIN candidates c ON c.id = ts.candidate_id
        WHERE ts.candidate_id = ?
        ORDER BY ts.submitted_at DESC
    `).all(id);

    const detailed = sessions.map(s => {
        const ans = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY question_index').all(s.id);
        return { ...s, answers: ans };
    });

    res.json(detailed);
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

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n✅  Assessment Portal running at http://localhost:${PORT}`);
    console.log(`    Admin login: http://localhost:${PORT}/admin-login.html\n`);
});
