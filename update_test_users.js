const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clients.db');

db.serialize(() => {
    // Caso 1: Vencido por Data (Data passada + Status Pendente)
    // ID 4 é PRO
    db.run("UPDATE users SET due_date = '2025-12-01', payment_status = 'pending' WHERE id = 4", (err) => {
        if (err) console.error(err);
        else console.log("User 4 updated: Due Date 2025-12-01, Pending");
    });

    // Caso 2: Vencido por Status Explícito (Overdue)
    // ID 5 é PRO
    db.run("UPDATE users SET payment_status = 'overdue' WHERE id = 5", (err) => {
        if (err) console.error(err);
        else console.log("User 5 updated: Status Overdue");
    });
});

db.close();
