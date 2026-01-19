const express = require('express');
console.log("--- INICIANDO VERSAO CORRIGIDA V4 (Bcrypt Fix) ---");
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
            cpf TEXT,
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
                 
                 // Migration: Add cpf if not exists
                 db.all("PRAGMA table_info(clients)", (err2, columns) => {
                     if (err2 || !columns) return;
                     const hasCpf = columns.some(col => col.name === 'cpf');
                     if (!hasCpf) {
                        db.run("ALTER TABLE clients ADD COLUMN cpf TEXT");
                    }
                });

                // Migration: Add last_notification_sent if not exists
                db.all("PRAGMA table_info(clients)", (err3, columns) => {
                    if (err3 || !columns) return;
                    const hasNotif = columns.some(col => col.name === 'last_notification_sent');
                    if (!hasNotif) {
                        db.run("ALTER TABLE clients ADD COLUMN last_notification_sent TEXT");
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
                due_date TEXT,
                role TEXT DEFAULT 'user',
                payment_status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                owner_id INTEGER DEFAULT 1
            )`, (err) => {
                if (err) console.error("Error creating users table:", err);
                else {
                    // Migration: Check if owner_id exists
                    db.all("PRAGMA table_info(users)", (err, columns) => {
                        if (err) return;
                        const hasOwnerId = columns.some(col => col.name === 'owner_id');
                        if (!hasOwnerId) {
                            console.log("Migrating users table: Adding owner_id column...");
                            db.run("ALTER TABLE users ADD COLUMN owner_id INTEGER DEFAULT 1", (err) => {
                                if (err) console.error("Error adding owner_id:", err);
                                else console.log("Added owner_id column to users table.");
                            });
                        }
                    });
                }
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
            
            // Create Settings Table
            db.run(`CREATE TABLE IF NOT EXISTS settings (
                user_id INTEGER,
                key TEXT,
                value TEXT,
                PRIMARY KEY (user_id, key)
            )`, (err) => {
                if (err) console.error("Error creating settings table:", err);
                else {
                    // Migration: Check if we need to migrate from old schema (key, value)
                    db.all("PRAGMA table_info(settings)", (err, columns) => {
                        if (err) return;
                        const hasUserId = columns.some(col => col.name === 'user_id');
                        if (!hasUserId) {
                            console.log("Migrating settings table to support user_id...");
                            db.serialize(() => {
                                db.run("ALTER TABLE settings RENAME TO settings_old");
                                db.run(`CREATE TABLE settings (
                                    user_id INTEGER,
                                    key TEXT,
                                    value TEXT,
                                    PRIMARY KEY (user_id, key)
                                )`);
                                // Migrate existing settings to Master Admin (ID 1)
                                db.run("INSERT INTO settings (user_id, key, value) SELECT 1, key, value FROM settings_old");
                                db.run("DROP TABLE settings_old");
                                console.log("Settings table migrated successfully.");
                            });
                        }
                    });
                }
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
            status TEXT,
            paid_at TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) return;
            db.all("PRAGMA table_info(invoice_shares)", (err2, columns) => {
                if (err2 || !columns) return;
                const hasStatus = columns.some(col => col.name === 'status');
                const hasPaidAt = columns.some(col => col.name === 'paid_at');
                if (!hasStatus) {
                    db.run("ALTER TABLE invoice_shares ADD COLUMN status TEXT");
                }
                if (!hasPaidAt) {
                    db.run("ALTER TABLE invoice_shares ADD COLUMN paid_at TEXT");
                }
            });
        });
        
        setInterval(runSubscriptionsGeneration, 60 * 60 * 1000);
        runSubscriptionsGeneration();
        
        // Cron Job: Verificação diária de vencimentos (09:00 AM)
        cron.schedule('0 9 * * *', () => {
            console.log('--- [Cron] Iniciando verificação automática de vencimentos ---');
            checkDueDatesAndNotify();
        });
    }
});

function startServer() {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

function checkDueDatesAndNotify() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Calcular data de aviso prévio (ex: 3 dias antes)
    const warningDate = new Date(today);
    warningDate.setDate(today.getDate() + 3);
    const warningDateStr = warningDate.toISOString().split('T')[0];

    console.log(`[Cron] Verificando vencimentos para hoje (${todayStr}) e prévia (${warningDateStr})`);

    // Buscar clientes pendentes que vencem hoje ou na data de aviso
    // E que ainda não foram notificados hoje
    const query = `
        SELECT c.*, u.id as owner_id, u.plan as owner_plan, u.role as owner_role, u.payment_pix_key, u.payment_instructions, u.smtp_user, u.smtp_pass
        FROM clients c
        JOIN users u ON c.user_id = u.id
        WHERE c.status = 'Pendente'
        AND (c.due_date = ? OR c.due_date = ?)
        AND (c.last_notification_sent IS NULL OR c.last_notification_sent != ?)
    `;

    db.all(query, [todayStr, warningDateStr, todayStr], (err, clients) => {
        if (err) {
            console.error('[Cron] Erro ao buscar clientes:', err);
            return;
        }

        if (!clients || clients.length === 0) {
            console.log('[Cron] Nenhum cliente para notificar hoje.');
            return;
        }

        console.log(`[Cron] Encontrados ${clients.length} clientes para notificar.`);

        clients.forEach(client => {
            // Lógica de Envio de Notificação
            
            // 1. Envio por E-mail (Nativo)
            if (client.email) {
                const isToday = client.due_date === todayStr;
                const subject = isToday 
                    ? `Lembrete: Sua fatura vence HOJE - ${client.product}`
                    : `Lembrete: Sua fatura vence em breve - ${client.product}`;
                
                const html = getInvoiceHtml(
                    client.name, 
                    client.value, 
                    client.due_date, 
                    client.product, 
                    client.payment_pix_key, 
                    client.payment_instructions
                );

                console.log(`[Cron] Enviando e-mail para ${client.name} (${client.email})...`);
                sendClientEmail(client.user_id, client.email, subject, html);
            }

            // 2. Envio por WhatsApp (Integração Evolution API)
            // Apenas para usuários PRO, PREMIUM ou ADMIN
            const allowedPlans = ['pro', 'premium'];
            const isAllowed = allowedPlans.includes(client.owner_plan) || client.owner_role === 'admin';

            if (client.phone && isAllowed) {
                const message = generateWhatsappMessageText(client);
                console.log(`[Cron] Tentando enviar WhatsApp para ${client.name} (${client.phone}) via Owner ID ${client.owner_id}...`);
                
                sendWhatsappMessage(client.phone, message, client.owner_id)
                    .then(() => console.log(`[Cron] WhatsApp enviado para ${client.name}`))
                    .catch(err => console.error(`[Cron] Erro ao enviar WhatsApp para ${client.name}:`, err.message));
            } else if (client.phone && !isAllowed) {
                console.log(`[Cron] WhatsApp pulado para ${client.name} (Plano ${client.owner_plan} não permite automação).`);
            }

            // Atualizar last_notification_sent
            db.run("UPDATE clients SET last_notification_sent = ? WHERE id = ?", [todayStr, client.id], (err) => {
                if (err) console.error(`[Cron] Erro ao atualizar status de notificação do cliente ${client.id}:`, err);
            });
        });
    });
}

function runSubscriptionsGeneration() {
    const today = new Date();
    const currentMonth = today.toISOString().slice(0, 7);
    const day = today.getDate();
    db.all(`
        SELECT s.*, u.plan AS user_plan
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        WHERE s.status = 'active'
    `, (err, subs) => {
        if (err || !subs) return;
        subs.forEach(sub => {
            // Skip automatic generation for FREE plan users
            if (sub.user_plan === 'free') return;
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

// --- Evolution API Helpers ---

function formatPhoneForEvolution(phone) {
    // Remove non-digits
    let clean = phone.replace(/\D/g, '');
    // Check DDI (assuming BR 55 if not present and length suggests it)
    if (clean.length >= 10 && clean.length <= 11) {
        clean = '55' + clean;
    }
    return clean;
}

function generateWhatsappMessageText(client) {
    // Simplified text generator for server-side
    // Reuse logic similar to frontend but without DOM dependency
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(client.value);
    const [year, month, day] = client.due_date.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    
    // Check if overdue
    const today = new Date();
    today.setHours(0,0,0,0);
    const dueDate = new Date(client.due_date + 'T00:00:00');
    
    const diffTime = dueDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let statusText = '';
    if (diffDays < 0) {
        statusText = `que está em atraso. Ela venceu em *${formattedDate}*`;
    } else if (diffDays === 0) {
        statusText = `que vence *hoje* (${formattedDate})`;
    } else {
        statusText = `com vencimento em *${formattedDate}*`;
    }

    let message = `Olá ${client.name}, lembramos que sua fatura referente a *${client.product}* no valor de *${formattedValue}* ${statusText}.`;
    
    if (client.payment_pix_key) {
        message += `\n\nChave PIX: ${client.payment_pix_key}`;
    }
    
    if (client.payment_instructions) {
        message += `\n\n${client.payment_instructions}`;
    }

    return message;
}

async function sendWhatsappMessage(phone, message, userId = null) {
    const apiUrl = process.env.EVOLUTION_API_URL; // e.g., https://evolution.seudominio.com
    const apiKey = process.env.EVOLUTION_API_KEY; // Global API Key
    const instanceName = getInstanceName(userId);

    if (!apiUrl || !apiKey) {
        throw new Error('Evolution API URL ou Key não configurada no servidor.');
    }

    const formattedPhone = formatPhoneForEvolution(phone);

    try {
        const url = `${apiUrl}/message/sendText/${instanceName}`;
        const body = {
            number: formattedPhone,
            text: message,
            options: {
                delay: 1200,
                presence: "composing",
                linkPreview: true
            }
        };

        const response = await axios.post(url, body, {
            headers: {
                'apikey': apiKey,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('Evolution API Error:', error.response ? error.response.data : error.message);
        throw error;
    }
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

// Admin: Get all users (Scoped by Owner)
app.get('/api/admin/users', (req, res) => {
    // 1. Get the admin's ID from the header (passed by frontend)
    // NOTE: In a real app, this should be extracted from the JWT token for security.
    // Assuming the frontend sends 'x-user-id' header or we use the 'authenticateToken' middleware properly.
    // For now, let's look for x-user-id header which we use in other routes.
    const adminId = parseInt(req.headers['x-user-id']);

    if (!adminId) {
        return res.status(401).json({ error: "Unauthorized: Missing Admin ID" });
    }

    // 2. Check if this Admin is the "Master" (ID=1) or a Sub-Admin
    // If ID=1, show ALL users.
    // If ID!=1, show only users where owner_id = adminId
    
    let query = `
        SELECT users.id, users.name, users.email, users.whatsapp, users.plan, users.status, 
               users.due_date, users.payment_status, users.role, users.created_at, users.owner_id,
               (SELECT COUNT(*) FROM clients WHERE clients.user_id = users.id) as client_count
        FROM users
    `;
    let params = [];

    if (adminId !== 1) {
        query += " WHERE owner_id = ?";
        params.push(adminId);
    } else {
        // Master Admin sees everyone, maybe order by owner_id to group them?
        query += " ORDER BY owner_id ASC, id DESC";
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin: Force Run Notification Check (Manual Trigger)
app.post('/api/admin/force-notifications', (req, res) => {
    console.log("--- [Manual] Forçando verificação de notificações ---");
    checkDueDatesAndNotify();
    res.json({ message: "Verificação de notificações iniciada em background." });
});

// --- Evolution API Admin Routes ---

// Check Status
app.get('/api/admin/evolution/status', async (req, res) => {
    const userId = req.headers['x-user-id'];
    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instanceName = getInstanceName(userId);

    if (!apiUrl || !apiKey) {
        return res.json({ configured: false, message: "Variáveis de ambiente não configuradas." });
    }

    try {
        // Try to fetch instance state
        const response = await axios.get(`${apiUrl}/instance/connectionState/${instanceName}`, {
            headers: { 'apikey': apiKey }
        });
        res.json({ 
            configured: true, 
            instanceName,
            state: response.data?.instance?.state || 'UNKNOWN',
            full_response: response.data
        });
    } catch (error) {
        // If 404, instance might not exist
        if (error.response && error.response.status === 404) {
             res.json({ configured: true, instanceName, state: 'NOT_FOUND' });
        } else {
             res.json({ configured: true, instanceName, state: 'ERROR', error: error.message });
        }
    }
});

// Init Instance
app.post('/api/admin/evolution/init', async (req, res) => {
    const userId = req.headers['x-user-id'];
    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instanceName = getInstanceName(userId);

    try {
        // Create Instance
        const response = await axios.post(`${apiUrl}/instance/create`, {
            instanceName: instanceName,
            token: "", // Optional
            qrcode: true,
            integration: "WHATSAPP-BAILEYS"
        }, {
            headers: { 'apikey': apiKey }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.response ? error.response.data : error.message });
    }
});

// Get Connect/QR Code
app.get('/api/admin/evolution/connect', async (req, res) => {
    const userId = req.headers['x-user-id'];
    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instanceName = getInstanceName(userId);

    try {
        const response = await axios.get(`${apiUrl}/instance/connect/${instanceName}`, {
            headers: { 'apikey': apiKey }
        });
        // Evolution v2 returns base64 or code
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.response ? error.response.data : error.message });
    }
});

// Test Send Message
app.post('/api/admin/evolution/test', async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { phone } = req.body;
    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    // const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'Controle'; // Removido para usar helper

    if (!phone) return res.status(400).json({ error: "Telefone obrigatório" });

    try {
        const result = await sendWhatsappMessage(phone, "Teste de conexão do Sistema Controle com Evolution API! 🚀", userId);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.response ? error.response.data : error.message });
    }
});

// Admin: Update User Role (Promote/Demote)
app.put('/api/admin/users/:id/role', (req, res) => {
    const adminId = parseInt(req.headers['x-user-id']);
    const targetUserId = req.params.id;
    const { role } = req.body;

    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: "Invalid role. Use 'user' or 'admin'." });
    }

    // Check permissions
    // First, get the requester's details to verify if they are the Master
    db.get("SELECT * FROM users WHERE id = ?", [adminId], (err, requester) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!requester) return res.status(401).json({ error: "Requester not found" });

        const isMaster = requester.id === 1 || requester.email === 'realizadorsonho@gmail.com';

        db.get("SELECT owner_id FROM users WHERE id = ?", [targetUserId], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(404).json({ error: "User not found" });

            // Master Admin can do anything
            // Sub-Admin can only edit their own users
            if (!isMaster && user.owner_id != adminId) {
                return res.status(403).json({ error: "Você não tem permissão para alterar este usuário." });
            }

            // Restriction: Only Master Admin can promote/demote to ADMIN role
            if (!isMaster && role === 'admin') {
                return res.status(403).json({ error: "Apenas o Administrador Principal pode promover usuários a ADMIN." });
            }

            db.run("UPDATE users SET role = ? WHERE id = ?", [role, targetUserId], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "success", changes: this.changes });
            });
        });
    });
});

// Admin Create User (Scoped)
app.post('/api/admin/users', (req, res) => {
    const adminId = parseInt(req.headers['x-user-id']);
    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    const { name, email, password, whatsapp, cpf } = req.body;
    
    // Hash password
    try {
        const hashedPassword = bcrypt.hashSync(password, 8);
        
        // Use adminId as owner_id
        db.run(`INSERT INTO users (name, email, password, whatsapp, cpf, owner_id) VALUES (?, ?, ?, ?, ?, ?)`, 
            [name, email, hashedPassword, whatsapp, cpf, adminId], 
            function(err) {
                if (err) {
                    if (err.message.includes("UNIQUE constraint failed")) {
                        return res.status(400).json({ error: "Email já cadastrado." });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({ id: this.lastID, message: "User created" });
            }
        );
    } catch (e) {
        return res.status(500).json({ error: "Erro ao criptografar senha: " + e.message });
    }
});

// Admin: Delete User (Master Only)
app.delete('/api/admin/users/:id', (req, res) => {
    const adminId = parseInt(req.headers['x-user-id']);
    const targetUserId = req.params.id;

    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    db.get("SELECT * FROM users WHERE id = ?", [adminId], (err, requester) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!requester) return res.status(401).json({ error: "Requester not found" });

        const isMaster = requester.id === 1 || requester.email === 'realizadorsonho@gmail.com';

        if (!isMaster) {
            return res.status(403).json({ error: "Apenas o Administrador Principal pode excluir usuários." });
        }

        db.run("DELETE FROM users WHERE id = ?", [targetUserId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "User deleted" });
        });
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
    const adminId = parseInt(req.headers['x-user-id']);
    const { id } = req.params;
    const { plan } = req.body;

    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    db.get("SELECT * FROM users WHERE id = ?", [adminId], (err, requester) => {
        if (err || !requester) return res.status(401).json({ error: "Unauthorized" });

        const isMaster = requester.id === 1 || requester.email === 'realizadorsonho@gmail.com';

        db.get("SELECT owner_id FROM users WHERE id = ?", [id], (err, targetUser) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!targetUser) return res.status(404).json({ error: "User not found" });

            if (!isMaster && targetUser.owner_id != adminId) {
                return res.status(403).json({ error: "Permission denied" });
            }

            db.run("UPDATE users SET plan = ? WHERE id = ?", [plan, id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "success", changes: this.changes });
            });
        });
    });
});

// Admin: Update user status
app.put('/api/admin/users/:id/status', (req, res) => {
    const adminId = parseInt(req.headers['x-user-id']);
    const { id } = req.params;
    const { status } = req.body;

    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    db.get("SELECT * FROM users WHERE id = ?", [adminId], (err, requester) => {
        if (err || !requester) return res.status(401).json({ error: "Unauthorized" });

        const isMaster = requester.id === 1 || requester.email === 'realizadorsonho@gmail.com';

        db.get("SELECT owner_id FROM users WHERE id = ?", [id], (err, targetUser) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!targetUser) return res.status(404).json({ error: "User not found" });

            if (!isMaster && targetUser.owner_id != adminId) {
                return res.status(403).json({ error: "Permission denied" });
            }

            db.run("UPDATE users SET status = ? WHERE id = ?", [status, id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "success", changes: this.changes });
            });
        });
    });
});

// Admin Stats
app.get('/api/admin/stats', (req, res) => {
    const adminId = parseInt(req.headers['x-user-id']);
    console.log(`[DEBUG] GET /api/admin/stats - AdminID: ${adminId}`);
    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

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
    db.all("SELECT key, value FROM settings WHERE user_id = ?", [adminId], (err, settings) => {
        if (!err && settings) {
            settings.forEach(s => {
                if (s.key === 'price_free') stats.prices.free = parseFloat(s.value);
                if (s.key === 'price_pro') stats.prices.pro = parseFloat(s.value);
                if (s.key === 'price_premium') stats.prices.premium = parseFloat(s.value);
                if (s.key === 'pix_key') stats.pix_key = s.value;
            });
        }

        let userQuery = "SELECT id, plan, status FROM users";
        let userParams = [];

        if (adminId !== 1) {
            userQuery += " WHERE owner_id = ?";
            userParams.push(adminId);
        }

        db.all(userQuery, userParams, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            const userIds = rows.map(r => r.id);

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

            // Calculate total clients for these users
            if (userIds.length > 0) {
                const placeholders = userIds.map(() => '?').join(',');
                db.get(`SELECT count(*) as count FROM clients WHERE user_id IN (${placeholders})`, userIds, (err, row) => {
                    if (err) return res.status(500).json({ error: err.message });
                    stats.total_clients = row.count;
                    res.json(stats);
                });
            } else {
                res.json(stats);
            }
        });
    });
});

// Admin: Update Settings
app.put('/api/admin/settings', (req, res) => {
    const adminId = parseInt(req.headers['x-user-id']);
    console.log(`[DEBUG] PUT /api/admin/settings - AdminID: ${adminId}`);
    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    const { prices, pix_key } = req.body;
    
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)");
    
    if (prices) {
        stmt.run(adminId, 'price_free', prices.free);
        stmt.run(adminId, 'price_pro', prices.pro);
        stmt.run(adminId, 'price_premium', prices.premium);
    }
    
    if (pix_key !== undefined) {
        stmt.run(adminId, 'pix_key', pix_key);
    }
    
    stmt.finalize();

    res.json({ message: "Configurações atualizadas" });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    // First, find user by email
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (row) {
            // Verify Password
            let passwordIsValid = false;
            
            // Check if password is hashed (bcrypt hashes start with $2)
            if (row.password && row.password.startsWith('$2')) {
                const bcrypt = require('bcryptjs');
                passwordIsValid = bcrypt.compareSync(password, row.password);
            } else {
                // Legacy plain text check
                passwordIsValid = (row.password === password);
            }

            if (!passwordIsValid) {
                return res.status(401).json({ error: "Credenciais inválidas" });
            }

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

    // Hash password
    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync(password, 8);

    const sql = `INSERT INTO users (name, email, password, whatsapp, cpf, plan, status, created_at) 
                 VALUES (?, ?, ?, ?, ?, 'free', 'active', ?)`;
    
    db.run(sql, [name, email, hashedPassword, whatsapp, cpf, created_at], function(err) {
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

        // Generate new random password
        const newPassword = Math.random().toString(36).slice(-8);
        const bcrypt = require('bcryptjs');
        const hashedPassword = bcrypt.hashSync(newPassword, 8);

        // Update user password
        db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, user.id], (err) => {
            if (err) return res.status(500).json({ error: "Erro ao redefinir senha." });

            const mailOptions = {
                from: `"Meus Clientes" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'Recuperação de Senha - Meus Clientes',
                text: `Olá ${user.name},\n\nRecebemos uma solicitação de recuperação de senha.\n\nSua NOVA senha é: ${newPassword}\n\nAcesse: ${req.protocol}://${req.get('host')}/login.html\n\nRecomendamos que você altere esta senha após o login.\n\nSe você não solicitou isso, entre em contato conosco imediatamente.`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error("Erro ao enviar email:", error);
                    return res.status(500).json({ error: "Erro ao enviar e-mail." });
                }
                res.json({ message: "E-mail de recuperação enviado." });
            });
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
    
    // Block automatic subscriptions for FREE plan users
    db.get("SELECT plan FROM users WHERE id = ?", [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (user.plan === 'free') {
            return res.status(403).json({ error: 'Usuário do plano FREE não pode usar cobrança automática (assinaturas).' });
        }

        db.run(
            `INSERT INTO subscriptions (user_id, name, email, phone, product, value, day_of_month, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
            [userId, name, email, phone, product, value, day_of_month],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, user_id: userId, name, email, phone, product, value, day_of_month, status: 'active' });
            }
        );
    });
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

// AI Message Generation Route
app.post('/api/ai/generate-message', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get("SELECT plan FROM users WHERE id = ?", [userId], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }
        if (user.plan === 'free') {
            return res.status(403).json({ error: "Usuário do plano FREE não pode usar mensagens com IA." });
        }

        const { clientName, value, dueDate, product, tone } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ 
                error: "Chave de API do Google Gemini não configurada. Configure a variável de ambiente GEMINI_API_KEY." 
            });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        
        const modelsToTry = [
            { model: "gemini-2.0-flash", config: {} },
            { model: "gemini-2.0-flash-lite", config: {} },
            { model: "gemini-flash-latest", config: {} },
            { model: "gemini-1.5-flash", config: {} }, 
            { model: "gemini-1.5-flash", config: { apiVersion: "v1" } }, 
            { model: "gemini-pro", config: { apiVersion: "v1" } }
        ];

        let lastError = null;

        for (const option of modelsToTry) {
            try {
                const modelName = option.model;
                console.log(`Tentando gerar mensagem com modelo: ${modelName} (API: ${option.config.apiVersion || 'default'})`);
                
                const model = genAI.getGenerativeModel({ 
                    model: modelName,
                    ...option.config
                });

                const prompt = `Escreva uma mensagem curta de cobrança para WhatsApp (apenas o texto da mensagem).
                Cliente: ${clientName}
                Valor: R$ ${value}
                Vencimento: ${dueDate}
                Produto: ${product}
                Tom: ${tone || 'educado'}
                
                Instruções:
                - Seja ${tone || 'educado'}.
                - Inclua os dados da dívida.
                - Não coloque "Assunto:".
                - Use emojis se o tom permitir.
                - Mantenha curto e direto para leitura no celular.`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                
                return res.json({ message: text, model_used: `${modelName} (${option.config.apiVersion || 'v1beta'})` });
            } catch (error) {
                console.warn(`Falha com modelo ${option.model}:`, error.message);
                lastError = error;
            }
        }

        try {
            console.log("Tentando listar modelos disponíveis para diagnóstico...");
            const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            
            if (listResponse.ok) {
                const listData = await listResponse.json();
                const availableModels = listData.models ? listData.models.map(m => m.name).join(', ') : 'Nenhum modelo retornado';
                console.error("DIAGNÓSTICO - Modelos Disponíveis:", availableModels);
                
                return res.status(500).json({ 
                    error: `Falha em todos os modelos. Modelos disponíveis na sua conta: ${availableModels}. Erro original: ${lastError?.message}`
                });
            } else {
                const errorText = await listResponse.text();
                console.error("DIAGNÓSTICO - Falha ao listar modelos:", errorText);
                return res.status(500).json({ 
                    error: `Falha total. Não foi possível nem listar os modelos. Verifique se a API 'Generative Language API' está habilitada no Google Cloud Console. Erro da API: ${errorText}`
                });
            }
        } catch (diagError) {
            console.error("Erro no diagnóstico:", diagError);
        }

        res.status(500).json({ error: "Falha ao gerar mensagem com IA (todos os modelos falharam): " + (lastError ? lastError.message : "Erro desconhecido") });
    });
});

// Upload Logo Route

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
        query += " AND (name LIKE ? OR email LIKE ? OR cpf LIKE ?)";
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
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
        const { name, email, phone, cpf, product, due_date, value } = req.body;
        const sql = `INSERT INTO clients (user_id, name, email, phone, cpf, product, due_date, value, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')`;
        const params = [userId, name, email, phone, cpf, product, due_date, value];
        
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
    const { name, email, phone, cpf, product, due_date, value } = req.body;
    const sql = `UPDATE clients SET name = ?, email = ?, phone = ?, cpf = ?, product = ?, due_date = ?, value = ? WHERE id = ? AND user_id = ?`;
    const params = [name, email, phone, cpf, product, due_date, value, id, userId];

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

// Update client status (Mark as Paid) and optionally create next month invoice
app.patch('/api/clients/:id/pay', (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const paid_at = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const updateSql = `UPDATE clients SET status = 'Pago', paid_at = ? WHERE id = ? AND user_id = ?`;
    
    db.run(updateSql, [paid_at, id, userId], function (err) {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        // Fetch original invoice to clone
        db.get("SELECT * FROM clients WHERE id = ? AND user_id = ?", [id, userId], (err2, client) => {
            if (err2 || !client) {
                return res.json({ message: "success", changes: this.changes });
            }

            if (!client.due_date) {
                return res.json({ message: "success", changes: this.changes });
            }

            // Calculate next month due date (keeping day when possible - User request: "A DATA É A DO VENCIMENTO SEMPRE")
            const parts = client.due_date.split('-');
            if (parts.length !== 3) {
                return res.json({ message: "success", changes: this.changes });
            }
            let year = parseInt(parts[0], 10);
            let month = parseInt(parts[1], 10);
            const day = parseInt(parts[2], 10);
            if (isNaN(year) || isNaN(month) || isNaN(day)) {
                return res.json({ message: "success", changes: this.changes });
            }
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
            const base = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0).getDate();
            const finalDay = Math.min(day, lastDay);
            const mm = String(month).padStart(2, '0');
            const dd = String(finalDay).padStart(2, '0');
            const nextDueDate = `${year}-${mm}-${dd}`;

            const insertSql = `INSERT INTO clients (user_id, name, email, phone, cpf, product, due_date, value, status) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')`;
            const params = [
                userId,
                client.name,
                client.email,
                client.phone,
                client.cpf,
                client.product,
                nextDueDate,
                client.value
            ];

            db.run(insertSql, params, function (err3) {
                if (err3) {
                    console.error("Erro ao criar próxima fatura:", err3);
                }
                res.json({
                    message: "success",
                    changes: this.changes,
                    next_invoice: {
                        id: this.lastID,
                        due_date: nextDueDate
                    }
                });
            });
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
    const { client_name, value, due_date, logo, status, paid_at } = req.body;
    const crypto = require('crypto');
    const id = crypto.randomBytes(4).toString('hex');

    const insertShare = (finalLogo) => {
        db.run(
            `INSERT INTO invoice_shares (id, user_id, client_name, value, due_date, logo, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, userId || null, client_name, value, due_date, finalLogo || null, status || null, paid_at || null],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id, url: `${req.protocol}://${req.get('host')}/share/${id}` });
            }
        );
    };

    if (userId) {
        db.get("SELECT logo FROM users WHERE id = ?", [userId], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            const finalLogo = (user && user.logo) ? user.logo : logo;
            insertShare(finalLogo);
        });
    } else {
        insertShare(logo);
    }
});

// Dynamic Invoice Card for WhatsApp Preview (Short Link)
app.get('/share/:id', (req, res) => {
    const { id } = req.params;
    
    db.get("SELECT * FROM invoice_shares WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).send('Fatura não encontrada');
        
        const { client_name, value, due_date, logo, status, paid_at } = row;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const logoUrl = logo ? (logo.startsWith('http') ? logo : `${baseUrl}${logo}`) : '';
        
        let paymentInfoRows = `
                    <div class="flex justify-between border-b border-gray-600 pb-2">
                        <span class="text-gray-400">Valor</span>
                        <span class="font-bold text-green-400 text-xl">${value}</span>
                    </div>
                    <div class="flex justify-between border-b border-gray-600 py-2">
                        <span class="text-gray-400">Vencimento</span>
                        <span class="font-bold text-white">${due_date}</span>
                    </div>
        `;

        if (status) {
            const normalizedStatus = status.toString().trim().toLowerCase();
            let statusColor = 'text-blue-400';
            let statusLabel = status;
            if (normalizedStatus === 'pago' || normalizedStatus === 'paid') {
                statusColor = 'text-green-400';
                statusLabel = 'Pago';
            } else if (normalizedStatus === 'pendente' || normalizedStatus === 'pending') {
                statusColor = 'text-yellow-400';
                statusLabel = 'Pendente';
            } else if (normalizedStatus === 'em atraso' || normalizedStatus === 'overdue') {
                statusColor = 'text-red-400';
                statusLabel = 'Em atraso';
            }
            paymentInfoRows += `
                    <div class="flex justify-between pt-2">
                        <span class="text-gray-400">Status</span>
                        <span class="font-bold ${statusColor}">${statusLabel}</span>
                    </div>
            `;
        }

        if (paid_at) {
            paymentInfoRows += `
                    <div class="flex justify-between pt-2">
                        <span class="text-gray-400">Pago em</span>
                        <span class="font-bold text-white">${paid_at}</span>
                    </div>
            `;
        }
        
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
                    ${paymentInfoRows}
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
