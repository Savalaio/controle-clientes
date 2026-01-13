const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'clients.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("--- Checking Master Admin ---");
    db.all("SELECT id, name, email, role, owner_id FROM users WHERE email = 'realizadorsonho@gmail.com' OR id = 1", (err, rows) => {
        if (err) {
            console.error("Error:", err);
            return;
        }
        console.log("Users found:", rows);
    });
});

db.close();
