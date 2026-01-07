const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clients.db');

const columnsToAdd = [
    "ALTER TABLE users ADD COLUMN created_at TEXT",
    "ALTER TABLE users ADD COLUMN due_date TEXT"
];

let completed = 0;

columnsToAdd.forEach(sql => {
    db.run(sql, (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log(`Coluna já existe: ${sql.split('ADD COLUMN ')[1]}`);
            } else {
                console.error("Erro ao adicionar coluna:", err);
            }
        } else {
            console.log(`Coluna adicionada: ${sql.split('ADD COLUMN ')[1]}`);
        }
        
        completed++;
        if (completed === columnsToAdd.length) {
            // Populate created_at for existing users with current date
            const today = new Date().toISOString().split('T')[0];
            db.run("UPDATE users SET created_at = ? WHERE created_at IS NULL", [today], (err) => {
                if (err) console.error("Erro ao atualizar created_at:", err);
                else console.log("Datas de cadastro preenchidas para usuários existentes.");
                db.close();
            });
        }
    });
});
