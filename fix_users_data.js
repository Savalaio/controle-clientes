const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clients.db');

db.serialize(() => {
    console.log("Iniciando correção de dados de usuários...");

    // 1. Atualizar Admin
    db.run(`UPDATE users SET 
        name = 'Administrador Principal', 
        whatsapp = '11 99999-9999', 
        cpf = '000.000.000-00' 
        WHERE email = 'admin@admin.com'`, (err) => {
            if (err) console.error("Erro ao atualizar admin:", err);
            else console.log("Admin atualizado.");
    });

    // 2. Atualizar usuários dummy (User 1, User 2, etc) que têm nome NULL
    // Vamos dar nomes genéricos e dados fictícios
    db.all("SELECT id, email FROM users WHERE name IS NULL OR whatsapp IS NULL", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        rows.forEach(user => {
            const fakePhone = `11 9${Math.floor(Math.random() * 10000)}-${Math.floor(Math.random() * 10000)}`;
            const fakeCPF = `${Math.floor(Math.random() * 999)}.${Math.floor(Math.random() * 999)}.${Math.floor(Math.random() * 999)}-00`;
            const name = user.email.split('@')[0].toUpperCase(); // Usa parte do email como nome provisório

            db.run(`UPDATE users SET 
                name = COALESCE(name, ?), 
                whatsapp = COALESCE(whatsapp, ?), 
                cpf = COALESCE(cpf, ?) 
                WHERE id = ?`, 
                [name, fakePhone, fakeCPF, user.id], 
                (err) => {
                    if (err) console.error(`Erro ao atualizar user ${user.id}:`, err);
                    else console.log(`Usuário ${user.id} (${user.email}) atualizado.`);
            });
        });
    });
});

// Fechar conexão após um tempo para garantir que os updates terminem
setTimeout(() => {
    db.close();
    console.log("Conexão fechada.");
}, 2000);
