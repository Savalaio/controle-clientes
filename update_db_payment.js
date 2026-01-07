const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clients.db');

db.run("ALTER TABLE users ADD COLUMN payment_status TEXT DEFAULT 'pending'", (err) => {
    if (err) {
        if (err.message.includes('duplicate column name')) {
            console.log("Coluna 'payment_status' já existe.");
        } else {
            console.error("Erro ao adicionar coluna:", err);
        }
    } else {
        console.log("Coluna 'payment_status' adicionada com sucesso.");
        
        // Update existing users to have a random status for demo purposes
        db.run("UPDATE users SET payment_status = 'paid' WHERE plan = 'free'"); // Free users are always "paid" (or N/A)
        console.log("Status de pagamento atualizado para usuários Free.");
    }
    db.close();
});
