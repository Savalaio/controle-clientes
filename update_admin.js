const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./clients.db');

db.run("UPDATE users SET plan = 'free' WHERE email = 'admin@admin.com'", function(err) {
    if (err) {
        console.error(err);
    } else {
        console.log(`Updated admin to free. Changes: ${this.changes}`);
    }
});
