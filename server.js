const express = require('express');
console.log("--- INICIANDO VERSAO CORRIGIDA V3 (Database Check) ---");
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000; // Force port 3000 as requested for Easypanel

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const userId = req.headers['x-user-id'] || 'unknown';
        const ext = path.extname(file.originalname);
        cb(null, `logo-${userId}-${Date.now()}${ext}`);
    }
});
const upload = multer({ storage: storage });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Redirect root to login
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// Database Setup
let dbPath = process.env.DB_PATH;
if (!dbPath) {
    // Check if /app/data exists (Docker volume standard)
    const dockerDataDir = '/app/data';
    if (fs.existsSync(dockerDataDir)) {
        dbPath = path.join(dockerDataDir, 'clients.db');
        console.log('Detectado ambiente Docker com volume, usando banco em:', dbPath);
    } else {
        dbPath = path.join(__dirname, 'clients.db');
        console.log('Usando banco local:', dbPath);
    }
}

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)){
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao abrir banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        db.run(`CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            product TEXT,
            due_date TEXT NOT NULL,
            value REAL NOT NULL,
            status TEXT DEFAULT 'Pendente',
            paid_at TEXT
        )`, (err) => {
            if (!err) {
                 // Migration: Add user_id if not exists
                 db.run("ALTER TABLE clients ADD COLUMN user_id INTEGER", (err) => {
                     // Ignore error if column exists
                     if (!err) {
                         // Assign existing clients to admin (id 1) for migration
                         db.run("UPDATE clients SET user_id = 1 WHERE user_id IS NULL");
                     }
                 });
            }
        });

        // Create Users Table
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT UNIQUE,
                password TEXT,
                whatsapp TEXT,
                cpf TEXT,
                plan TEXT DEFAULT 'free',
                status TEXT DEFAULT 'active',
                role TEXT DEFAULT 'user'
            )`, (err) => {
                if (err) console.error(err);
            });
            
            // Migration: Add columns if they don't exist
            const columnsToAdd = [
                "ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'",
                "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'",
                "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'",
                "ALTER TABLE users ADD COLUMN name TEXT",
                "ALTER TABLE users ADD COLUMN whatsapp TEXT",
                "ALTER TABLE users ADD COLUMN cpf TEXT",
                "ALTER TABLE users ADD COLUMN payment_method TEXT DEFAULT 'whatsapp'",
                "ALTER TABLE users ADD COLUMN payment_pix_key TEXT",
                "ALTER TABLE users ADD COLUMN payment_instructions TEXT",
                "ALTER TABLE users ADD COLUMN logo TEXT",
                "ALTER TABLE users ADD COLUMN smtp_user TEXT",
                "ALTER TABLE users ADD COLUMN smtp_pass TEXT",
                "ALTER TABLE users ADD COLUMN created_at TEXT",
                "ALTER TABLE users ADD COLUMN payment_status TEXT DEFAULT 'pending'",
                "ALTER TABLE users ADD COLUMN due_date TEXT"
            ];

            columnsToAdd.forEach(sql => {
                db.run(sql, (err) => {
                    // Ignore error if column already exists
                });
            });

            seedUsers();
            
            // Verify schema and start server
            db.all("PRAGMA table_info(users)", (err, rows) => {
                if (err) {
                    console.error("CRITICAL ERROR: Could not verify table schema:", err);
                    return;
                }
                const hasRole = rows.some(r => r.name === 'role');
                if (!hasRole) {
                    console.error("CRITICAL ERROR: 'role' column missing in users table after migration!");
                    // Attempt emergency fix
                    db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'", (err) => {
                        if (err) console.error("Emergency fix failed:", err);
                        else console.log("Emergency fix applied: 'role' column added.");
                        startServer();
                    });
                } else {
                    console.log("Database schema verified: 'role' column exists.");
                    startServer();
                }
            });
        });
        
        db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            product TEXT,
            value REAL NOT NULL,
            day_of_month INTEGER NOT NULL,
            status TEXT DEFAULT 'active',
            last_generated_month TEXT
        )`, (err) => {});

        // Shared Invoices Table
        db.run(`CREATE TABLE IF NOT EXISTS invoice_shares (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            client_name TEXT,
            value TEXT,
            due_date TEXT,
            logo TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        setInterval(runSubscriptionsGeneration, 60 * 60 * 1000);
        runSubscriptionsGeneration();
    }
});

function startServer() {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

function runSubscriptionsGeneration() {
    const today = new Date();
    const currentMonth = today.toISOString().slice(0, 7);
    const day = today.getDate();
    db.all("SELECT * FROM subscriptions WHERE status = 'active'", (err, subs) => {
        if (err || !subs) return;
        subs.forEach(sub => {
            if (sub.last_generated_month === currentMonth) return;
            if (sub.day_of_month > day) return;
            const due_day = String(sub.day_of_month).padStart(2, '0');
            const due_date = `${currentMonth}-${due_day}`;
            const params = [sub.user_id, sub.name, sub.email, sub.phone, sub.product, due_date, sub.value];
            db.run(
                `INSERT INTO clients (user_id, name, email, phone, product, due_date, value, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente')`,
                params,
                function(err2) {
                    if (err2) return;
                    
                    // Send Email
                    if (sub.email) {
                         db.get("SELECT payment_pix_key, payment_instructions FROM users WHERE id = ?", [sub.user_id], (err, userSettings) => {
                             if (!err && userSettings) {
                                const html = getInvoiceHtml(sub.name, sub.value, due_date, sub.product, userSettings.payment_pix_key, userSettings.payment_instructions);
                                sendClientEmail(sub.user_id, sub.email, `Fatura Recorrente - ${sub.product}`, html);
                            }
                         });
                    }

                    db.run("UPDATE subscriptions SET last_generated_month = ? WHERE id = ?", [currentMonth, sub.id]);
                }
            );
        });
    });
}

function seedUsers() {
    // Create default user if not exists
    const adminEmail = 'realizadorsonho@gmail.com';
    db.get("SELECT * FROM users WHERE email = ?", [adminEmail], (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (name, email, password, plan, status, role) VALUES (?, ?, ?, ?, ?, ?)", ['Administrador', adminEmail, '123456', 'premium', 'active', 'admin'], (err) => {
                if (err) console.error("Erro ao criar usuário padrão:", err.message);
                else console.log(`Usuário padrão criado: ${adminEmail} / 123456`);
            });
        }
    });
    
    // Seed dummy data for visualization if table is empty (except admin)
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row && row.count <= 1) {
            const dummyUsers = [
                ['User 1', 'user1@test.com', '123', 'free', 'active'],
                ['User 2', 'user2@test.com', '123', 'free', 'active'],
                ['User 3', 'user3@test.com', '123', 'free', 'active'],
                ['User 4', 'user4@test.com', '123', 'free', 'active'],
                ['User 5', 'user5@test.com', '123', 'free', 'active'],
                ['Pro User 1', 'pro1@test.com', '123', 'pro', 'active'],
                ['Pro User 2', 'pro2@test.com', '123', 'pro', 'active'],
                ['Blocked User', 'blocked1@test.com', '123', 'free', 'blocked']
            ];
            dummyUsers.forEach(u => db.run("INSERT INTO users (name, email, password, plan, status) VALUES (?, ?, ?, ?, ?)", u, (err) => {
                 if (err) console.log("Skipping duplicate dummy user");
            }));
        }
    });
}

// Email Configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Email Helper Function
function sendClientEmail(userId, to, subject, htmlContent) {
    if (!to) return;

    // Helper to send using specific credentials
    const send = (user, pass) => {
        if (!user || !pass) {
            console.log("Sem credenciais SMTP para envio.");
            return;
        }
        const transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: { user, pass }
        });
        const mailOptions = {
            from: `"Meus Clientes" <${user}>`,
            to: to,
            subject: subject,
            html: htmlContent
        };
        transport.sendMail(mailOptions, (error, info) => {
            if (error) console.error("Erro ao enviar email para cliente:", error);
            else console.log('Email enviado para cliente: ' + info.response);
        });
    };

    if (userId) {
        db.get("SELECT smtp_user, smtp_pass FROM users WHERE id = ?", [userId], (err, row) => {
            if (!err && row && row.smtp_user && row.smtp_pass) {
                send(row.smtp_user, row.smtp_pass);
            } else {
                // Fallback to system env
                send(process.env.SMTP_USER, process.env.SMTP_PASS);
            }
        });
    } else {
        send(process.env.SMTP_USER, process.env.SMTP_PASS);
    }
}

function getInvoiceHtml(clientName, value, dueDate, product, pixKey, instructions) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #333;">Olá, ${clientName}</h2>
        <p>Você tem uma nova cobrança gerada.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Produto/Serviço:</strong> ${product}</p>
            <p><strong>Valor:</strong> R$ ${value}</p>
            <p><strong>Vencimento:</strong> ${dueDate}</p>
        </div>

        ${pixKey ? `
        <div style="margin-bottom: 20px;">
            <h3 style="color: #007bff;">Pagamento via PIX</h3>
            <p>Chave PIX: <strong>${pixKey}</strong></p>
        </div>` : ''}

        ${instructions ? `
        <div style="margin-bottom: 20px;">
            <h3>Instruções</h3>
            <p>${instructions}</p>
        </div>` : ''}

        <p style="font-size: 12px; color: #777;">Este é um e-mail automático. Por favor, não responda.</p>
    </div>
    `;
}

// Routes

// Admin: List Users
app.get('/api/admin/users', (req, res) => {
    // Debug log
    console.log('Fetching users list for admin...');
    
    db.all(`
        SELECT u.id, u.name, u.email, u.plan, u.status, u.role, u.whatsapp, u.cpf, u.payment_status, u.created_at, u.due_date, COUNT(c.id) as client_count 
        FROM users u 
        LEFT JOIN clients c ON u.id = c.user_id 
        GROUP BY u.id
    `, (err, rows) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log(`Found ${rows ? rows.length : 0} users`);
        res.json(rows);
    });
});

// Admin: Update User Role
app.put('/api/admin/users/:id/role', (req, res) => {
    const { role } = req.body;
    db.run("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Role atualizado" });
    });
});

// Admin: Get ticket stats (count of open tickets)
app.get('/api/tickets/stats', (req, res) => {
    db.get("SELECT count(*) as count FROM tickets WHERE status = 'open'", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ open_count: row.count });
    });
});

// Support Routes

// Get all tickets (Admin) or User tickets
app.get('/api/tickets', (req, res) => {
    const userId = req.query.userId;
    let sql = `SELECT t.*, u.name as user_name FROM tickets t JOIN users u ON t.user_id = u.id`;
    let params = [];

    if (userId) {
        sql += ` WHERE t.user_id = ?`;
        params.push(userId);
    }
    
    sql += ` ORDER BY t.updated_at DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get single ticket with messages
app.get('/api/tickets/:id', (req, res) => {
    const ticketId = req.params.id;
    
    db.get(`SELECT t.*, u.name as user_name FROM tickets t JOIN users u ON t.user_id = u.id WHERE t.id = ?`, [ticketId], (err, ticket) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });

        db.all(`SELECT tm.*, u.name as sender_name FROM ticket_messages tm JOIN users u ON tm.user_id = u.id WHERE tm.ticket_id = ? ORDER BY tm.created_at ASC`, [ticketId], (err, messages) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ticket, messages });
        });
    });
});

// Create new ticket
app.post('/api/tickets', (req, res) => {
    const { user_id, subject, message } = req.body;
    
    db.run(`INSERT INTO tickets (user_id, subject) VALUES (?, ?)`, [user_id, subject], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const ticketId = this.lastID;
        
        db.run(`INSERT INTO ticket_messages (ticket_id, user_id, message) VALUES (?, ?, ?)`, [ticketId, user_id, message], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Ticket created", ticketId });
        });
    });
});

// Reply to ticket
app.post('/api/tickets/:id/messages', (req, res) => {
    const ticketId = req.params.id;
    const { user_id, message, status } = req.body; // status update optional
    
    db.run(`INSERT INTO ticket_messages (ticket_id, user_id, message) VALUES (?, ?, ?)`, [ticketId, user_id, message], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        if (status) {
            db.run(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, ticketId]);
        } else {
            db.run(`UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [ticketId]);
        }
        
        res.json({ message: "Reply added" });
    });
});

// Admin: Update user payment status and due date
app.put('/api/admin/users/:id/payment_status', (req, res) => {
    const { id } = req.params;
    const { payment_status, due_date } = req.body;
    
    let updates = ["payment_status = ?"];
    let params = [payment_status];

    if (due_date !== undefined) {
        updates.push("due_date = ?");
        params.push(due_date);
    }

    // Auto-unblock if paid
    if (payment_status === 'paid') {
        updates.push("status = 'active'");
    }

    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "success", changes: this.changes });
    });
});

// Admin: Reset user password
app.put('/api/admin/users/:id/password', (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password) return res.status(400).json({ error: "Nova senha é obrigatória" });

    db.run("UPDATE users SET password = ? WHERE id = ?", [password, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "success", changes: this.changes });
    });
});

// Admin: Update user plan
app.put('/api/admin/users/:id/plan', (req, res) => {
    const { id } = req.params;
    const { plan } = req.body;
    db.run("UPDATE users SET plan = ? WHERE id = ?", [plan, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "success", changes: this.changes });
    });
});

// Admin: Update user status
app.put('/api/admin/users/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.run("UPDATE users SET status = ? WHERE id = ?", [status, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "success", changes: this.changes });
    });
});

// Admin Stats
app.get('/api/admin/stats', (req, res) => {
    const stats = {
        users_free: 0,
        users_pro: 0,
        users_premium: 0,
        users_blocked: 0,
        total_users: 0,
        total_clients: 0,
        prices: { free: 0, pro: 0, premium: 0 }
    };

    // Get Prices and Settings
    db.all("SELECT key, value FROM settings", (err, settings) => {
        if (!err && settings) {
            settings.forEach(s => {
                if (s.key === 'price_free') stats.prices.free = parseFloat(s.value);
                if (s.key === 'price_pro') stats.prices.pro = parseFloat(s.value);
                if (s.key === 'price_premium') stats.prices.premium = parseFloat(s.value);
                if (s.key === 'pix_key') stats.pix_key = s.value;
            });
        }

        db.all("SELECT plan, status FROM users", (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            rows.forEach(row => {
                stats.total_users++;
                
                // Count Plans (regardless of status)
                if (row.plan === 'free') stats.users_free++;
                else if (row.plan === 'pro') stats.users_pro++;
                else if (row.plan === 'premium') stats.users_premium++;

                // Count Blocked
                if (row.status === 'blocked') {
                    stats.users_blocked++;
                }
            });

            db.get("SELECT count(*) as count FROM clients", (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                stats.total_clients = row.count;
                res.json(stats);
            });
        });
    });
});

// Admin: Update Settings
app.put('/api/admin/settings', (req, res) => {
    const { prices, pix_key } = req.body;
    
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    
    if (prices) {
        stmt.run('price_free', prices.free);
        stmt.run('price_pro', prices.pro);
        stmt.run('price_premium', prices.premium);
    }
    
    if (pix_key !== undefined) {
        stmt.run('pix_key', pix_key);
    }
    
    stmt.finalize();

    res.json({ message: "Configurações atualizadas" });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (row) {
            // Check Blocked Status
            if (row.status === 'blocked') {
                return res.status(403).json({ error: "Conta bloqueada. Contate o administrador." });
            }

            // Check Payment Status (Auto-Block Logic)
            if (row.plan !== 'free' && row.role !== 'admin') {
                const today = new Date().toISOString().split('T')[0];
                if (row.due_date && row.due_date < today && row.payment_status !== 'paid') {
                     // Opcional: Atualizar status para 'blocked' no banco para persistir
                     // Mas por enquanto vamos apenas impedir o login
                     return res.status(402).json({ 
                        error: "Plano vencido. Realize o pagamento para continuar.",
                        is_overdue: true
                     });
                }
            }

            res.json({ 
                message: "success", 
                user: { 
                    id: row.id, 
                    email: row.email, 
                    name: row.name,
                    plan: row.plan,
                    role: row.role || 'user'
                } 
            });
        } else {
            res.status(401).json({ error: "Credenciais inválidas" });
        }
    });
});

// Register
app.post('/api/register', (req, res) => {
    const { name, email, password, whatsapp, cpf } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Nome, email e senha são obrigatórios" });
    }

    const created_at = new Date().toISOString().split('T')[0];

    const sql = `INSERT INTO users (name, email, password, whatsapp, cpf, plan, status, created_at) 
                 VALUES (?, ?, ?, ?, ?, 'free', 'active', ?)`;
    
    db.run(sql, [name, email, password, whatsapp, cpf, created_at], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: "Email já cadastrado" });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ 
            message: "success", 
            user: { id: this.lastID, name, email } 
        });
    });
});

// Forgot Password
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: "E-mail não encontrado." });

        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.error("SMTP credentials not configured");
            return res.status(500).json({ error: "Servidor de e-mail não configurado." });
        }

        const mailOptions = {
            from: `"Meus Clientes" <${process.env.SMTP_USER}>`,
            to: email,
            subject: 'Recuperação de Senha - Meus Clientes',
            text: `Olá ${user.name},\n\nRecebemos uma solicitação de recuperação de senha.\n\nSua senha é: ${user.password}\n\nAcesse: ${req.protocol}://${req.get('host')}/login.html\n\nSe você não solicitou isso, ignore este e-mail.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Erro ao enviar email:", error);
                return res.status(500).json({ error: "Erro ao enviar e-mail. Verifique os logs." });
            }
            console.log('Email enviado: ' + info.response);
            res.json({ message: "success" });
        });
    });
});

app.get('/api/user/payment', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    db.get(
        "SELECT payment_method, payment_pix_key, payment_instructions, logo, smtp_user, smtp_pass FROM users WHERE id = ?",
        [userId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(row || { payment_method: 'whatsapp' });
        }
    );
});

app.put('/api/user/smtp', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { smtp_user, smtp_pass } = req.body;
    db.run("UPDATE users SET smtp_user = ?, smtp_pass = ? WHERE id = ?", [smtp_user, smtp_pass, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'success' });
    });
});

app.put('/api/user/payment', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { payment_method, payment_pix_key, payment_instructions } = req.body;
    const allowedMethods = ['whatsapp', 'pix', 'boleto', 'link'];
    const method = allowedMethods.includes(payment_method) ? payment_method : 'whatsapp';
    db.run(
        "UPDATE users SET payment_method = ?, payment_pix_key = ?, payment_instructions = ? WHERE id = ?",
        [method, payment_pix_key || null, payment_instructions || null, userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'success', changes: this.changes });
        }
    );
});

app.get('/api/subscriptions', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    db.all("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY day_of_month ASC", [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/subscriptions', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { name, email, phone, product, value, day_of_month } = req.body;
    if (!name || !value || !day_of_month) return res.status(400).json({ error: 'Nome, valor e dia são obrigatórios' });
    db.run(
        `INSERT INTO subscriptions (user_id, name, email, phone, product, value, day_of_month, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
        [userId, name, email, phone, product, value, day_of_month],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, user_id: userId, name, email, phone, product, value, day_of_month, status: 'active' });
        }
    );
});

app.put('/api/subscriptions/:id', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { name, email, phone, product, value, day_of_month, status } = req.body;
    db.run(
        `UPDATE subscriptions SET name = ?, email = ?, phone = ?, product = ?, value = ?, day_of_month = ?, status = ? WHERE id = ? AND user_id = ?`,
        [name, email, phone, product, value, day_of_month, status, id, userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'success', changes: this.changes });
        }
    );
});

app.delete('/api/subscriptions/:id', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    db.run("DELETE FROM subscriptions WHERE id = ? AND user_id = ?", [id, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'deleted', changes: this.changes });
    });
});

app.post('/api/subscriptions/run', (req, res) => {
    runSubscriptionsGeneration();
    res.json({ message: 'executed' });
});

// Get all clients
app.get('/api/clients', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { status, search } = req.query;
    let query = "SELECT * FROM clients WHERE user_id = ?";
    const params = [userId];

    if (status && status !== 'Todos') {
        query += " AND status = ?";
        params.push(status);
    }

    if (search) {
        query += " AND (name LIKE ? OR email LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }

    query += " ORDER BY due_date ASC";

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({
            message: "success",
            data: rows
        });
    });
});

// Add new client
app.post('/api/clients', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Check Plan Limits
    db.get("SELECT plan FROM users WHERE id = ?", [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: "User not found" });

        if (user.plan === 'free') {
            db.get("SELECT count(*) as count FROM clients WHERE user_id = ?", [userId], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                
                if (row.count >= 5) {
                    return res.status(403).json({ 
                        error: "Limite de 5 clientes atingido para o plano Grátis. Atualize para Pro ou Premium!" 
                    });
                }

                // Proceed to insert
                insertClient();
            });
        } else {
            // Pro/Premium/Admin - no limit
            insertClient();
        }
    });

    function insertClient() {
        const { name, email, phone, product, due_date, value } = req.body;
        const sql = `INSERT INTO clients (user_id, name, email, phone, product, due_date, value, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente')`;
        const params = [userId, name, email, phone, product, due_date, value];
        
        db.run(sql, params, function (err) {
            if (err) {
                res.status(400).json({ error: err.message });
                return;
            }
            
            // Send Email Notification if email provided
            if (email) {
                db.get("SELECT payment_pix_key, payment_instructions FROM users WHERE id = ?", [userId], (err, userSettings) => {
                    if (!err && userSettings) {
                        const html = getInvoiceHtml(name, value, due_date, product, userSettings.payment_pix_key, userSettings.payment_instructions);
                        sendClientEmail(userId, email, `Nova Fatura - ${product}`, html);
                    }
                });
            }

            res.json({
                message: "success",
                data: { id: this.lastID, ...req.body, status: 'Pendente' }
            });
        });
    }
});

// Update client details
app.put('/api/clients/:id', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const { name, email, phone, product, due_date, value } = req.body;
    const sql = `UPDATE clients SET name = ?, email = ?, phone = ?, product = ?, due_date = ?, value = ? WHERE id = ? AND user_id = ?`;
    const params = [name, email, phone, product, due_date, value, id, userId];

    db.run(sql, params, function (err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({
            message: "success",
            changes: this.changes
        });
    });
});

// Update client status (Mark as Paid)
app.patch('/api/clients/:id/pay', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const paid_at = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sql = `UPDATE clients SET status = 'Pago', paid_at = ? WHERE id = ? AND user_id = ?`;
    
    db.run(sql, [paid_at, id, userId], function (err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({
            message: "success",
            changes: this.changes
        });
    });
});

// Delete client
app.delete('/api/clients/:id', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    db.run(`DELETE FROM clients WHERE id = ? AND user_id = ?`, [id, userId], function (err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ message: "deleted", changes: this.changes });
    });
});

// Resend Client Email
app.post('/api/clients/:id/email', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    db.get("SELECT * FROM clients WHERE id = ? AND user_id = ?", [id, userId], (err, client) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!client) return res.status(404).json({ error: "Cliente/Fatura não encontrada" });
        if (!client.email) return res.status(400).json({ error: "Cliente sem e-mail cadastrado" });

        db.get("SELECT payment_pix_key, payment_instructions FROM users WHERE id = ?", [userId], (err, userSettings) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const html = getInvoiceHtml(client.name, client.value, client.due_date, client.product, userSettings?.payment_pix_key, userSettings?.payment_instructions);
            
            sendClientEmail(userId, client.email, `Lembrete de Fatura - ${client.product}`, html);
            res.json({ message: "E-mail enviado com sucesso!" });
        });
    });
});

// Stats
app.get('/api/stats', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    const sql = `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'Pendente' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN status = 'Pendente' THEN value ELSE 0 END) as pending_value,
            SUM(CASE WHEN status = 'Pendente' AND due_date < date('now') THEN value ELSE 0 END) as overdue_value,
            SUM(CASE WHEN status = 'Pago' THEN value ELSE 0 END) as total_received,
            SUM(CASE WHEN status = 'Pago' AND strftime('%Y-%m', paid_at) = ? THEN value ELSE 0 END) as month_received,
            SUM(CASE WHEN strftime('%Y-%m', due_date) = ? THEN value ELSE 0 END) as month_projected
        FROM clients
        WHERE user_id = ?
    `;
    db.get(sql, [currentMonth, currentMonth, userId], (err, row) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }

        // Fetch recurring revenue (active subscriptions)
        db.get("SELECT SUM(value) as recurring FROM subscriptions WHERE user_id = ? AND status = 'active'", [userId], (err2, subRow) => {
            const stats = row;
            stats.recurring = (subRow && subRow.recurring) ? subRow.recurring : 0;
            
            res.json({
                data: stats
            });
        });
    });
});

// Upload Logo
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const logoPath = `/uploads/${req.file.filename}`;
    db.run("UPDATE users SET logo = ? WHERE id = ?", [logoPath, userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logo: logoPath });
    });
});

// Create Shared Invoice Link
app.post('/api/invoice-share', (req, res) => {
    const userId = req.headers['x-user-id'];
    const { client_name, value, due_date, logo } = req.body;
    
    // Generate short ID (8 chars)
    const crypto = require('crypto');
    const id = crypto.randomBytes(4).toString('hex');
    
    db.run(
        `INSERT INTO invoice_shares (id, user_id, client_name, value, due_date, logo) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, userId || null, client_name, value, due_date, logo],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, url: `${req.protocol}://${req.get('host')}/share/${id}` });
        }
    );
});

// Dynamic Invoice Card for WhatsApp Preview (Short Link)
app.get('/share/:id', (req, res) => {
    const { id } = req.params;
    
    db.get("SELECT * FROM invoice_shares WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).send('Fatura não encontrada');
        
        const { client_name, value, due_date, logo } = row;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const logoUrl = logo ? (logo.startsWith('http') ? logo : `${baseUrl}${logo}`) : '';
        
        const html = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Fatura de ${client_name}</title>
            <meta property="og:title" content="Fatura - ${client_name}">
            <meta property="og:description" content="Valor: ${value} - Vencimento: ${due_date}">
            ${logoUrl ? `<meta property="og:image" content="${logoUrl}">` : ''}
            <meta property="og:image:width" content="300">
            <meta property="og:image:height" content="300">
            <meta property="og:type" content="website">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4">
            <div class="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-700 text-center">
                ${logoUrl ? `<img src="${logoUrl}" class="w-32 h-32 mx-auto mb-6 object-contain bg-white rounded-xl p-2">` : ''}
                <h1 class="text-2xl font-bold mb-2">Detalhes da Cobrança</h1>
                <p class="text-gray-400 mb-6">Olá <strong>${client_name}</strong>, aqui estão os detalhes da sua fatura.</p>
                
                <div class="bg-gray-700/50 p-4 rounded-xl mb-6 space-y-3">
                    <div class="flex justify-between border-b border-gray-600 pb-2">
                        <span class="text-gray-400">Valor</span>
                        <span class="font-bold text-green-400 text-xl">${value}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Vencimento</span>
                        <span class="font-bold text-white">${due_date}</span>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;
        res.send(html);
    });
});

// Deprecated: Dynamic Invoice Card for WhatsApp Preview
app.get('/share-invoice', (req, res) => {
    const { name, value, due_date, logo } = req.query;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const logoUrl = logo ? (logo.startsWith('http') ? logo : `${baseUrl}${logo}`) : '';
    
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fatura de ${name}</title>
        <meta property="og:title" content="Fatura - ${name}">
        <meta property="og:description" content="Valor: ${value} - Vencimento: ${due_date}">
        ${logoUrl ? `<meta property="og:image" content="${logoUrl}">` : ''}
        <meta property="og:image:width" content="300">
        <meta property="og:image:height" content="300">
        <meta property="og:type" content="website">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4">
        <div class="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-700 text-center">
            ${logoUrl ? `<img src="${logoUrl}" class="w-32 h-32 mx-auto mb-6 object-contain bg-white rounded-xl p-2">` : ''}
            <h1 class="text-2xl font-bold mb-2">Detalhes da Cobrança</h1>
            <p class="text-gray-400 mb-6">Olá <strong>${name}</strong>, aqui estão os detalhes da sua fatura.</p>
            
            <div class="bg-gray-700/50 p-4 rounded-xl mb-6 space-y-3">
                <div class="flex justify-between border-b border-gray-600 pb-2">
                    <span class="text-gray-400">Valor</span>
                    <span class="font-bold text-green-400 text-xl">${value}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-400">Vencimento</span>
                    <span class="font-bold text-white">${due_date}</span>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// Server listening handled by startServer()
