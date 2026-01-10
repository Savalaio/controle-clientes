const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clients.db');

db.serialize(() => {
    console.log("Iniciando normalização de datas de vencimento...");

    db.all("SELECT id, due_date FROM users", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        rows.forEach(user => {
            let newDate = null;
            
            // Tenta corrigir datas estranhas
            if (user.due_date) {
                if (typeof user.due_date === 'object') {
                     // Se por milagre o driver retornou objeto
                     try {
                        newDate = new Date(user.due_date).toISOString().split('T')[0];
                     } catch (e) { newDate = null; }
                } else if (user.due_date.includes('{')) {
                    // Se for string JSON
                    try {
                        const parsed = JSON.parse(user.due_date);
                        newDate = parsed.date || null; 
                    } catch (e) { newDate = null; }
                } else {
                    // Já é string, valida formato
                    const parts = user.due_date.split('-');
                    if (parts.length === 3) {
                        newDate = user.due_date;
                    } else {
                        newDate = null;
                    }
                }
            }

            // Se for nulo e não for free, define para data futura ou passada padrão?
            // Melhor deixar null se não sabemos, mas vamos garantir que seja string NULL no banco
            
            if (newDate !== user.due_date) {
                db.run("UPDATE users SET due_date = ? WHERE id = ?", [newDate, user.id], (err) => {
                    if (err) console.error(`Erro user ${user.id}:`, err);
                    else console.log(`User ${user.id} atualizado: ${user.due_date} -> ${newDate}`);
                });
            }
        });
    });
});

setTimeout(() => db.close(), 2000);
