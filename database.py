import sqlite3
import os

DB_NAME = "clients.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            product TEXT,
            due_date TEXT NOT NULL,
            value REAL NOT NULL,
            status TEXT DEFAULT 'Pendente',
            paid_at TEXT
        )
    ''')
    conn.commit()
    conn.close()
    print(f"Banco de dados {DB_NAME} inicializado.")

if __name__ == "__main__":
    init_db()
