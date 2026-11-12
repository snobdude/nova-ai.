
import os
import sqlite3
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "nova_memory.db"))

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

SYSTEM_PROMPT = """
You are Nova, a friendly and intelligent AI assistant.
Be honest about your identity and abilities.
Be helpful, natural, and clear.
Use conversation history when relevant.
"""

def db_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def initialize_database():
    with db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

initialize_database()

@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/health")
def health():
    return jsonify({"name": "Nova", "status": "online"})

@app.route("/history")
def history():
    user_id = (request.args.get("user_id") or "nova-owner")[:100]

    with db_connection() as conn:
        rows = conn.execute("""
            SELECT role, content FROM messages
            WHERE user_id = ?
            ORDER BY id DESC LIMIT 50
        """, (user_id,)).fetchall()

    return jsonify({
        "messages": [
            {"role": row["role"], "content": row["content"]}
            for row in reversed(rows)
        ]
    })

@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}

    message = str(
        data.get("message")
        or data.get("text")
        or ""
    ).strip()

    user_id = str(data.get("user_id", "nova-owner"))[:100]

    if not message:
        return jsonify({"error": "Message is empty"}), 400

    api_key = os.environ.get("GROQ_API_KEY", "").strip()

    if not api_key:
        return jsonify({
            "error": "Server is missing its Groq API key."
        }), 500

    with db_connection() as conn:
        rows = conn.execute("""
            SELECT role, content FROM messages
            WHERE user_id = ?
            ORDER BY id DESC LIMIT 12
        """, (user_id,)).fetchall()

    conversation = [
        {"role": row["role"], "content": row["content"]}
        for row in reversed(rows)
    ]

    conversation.append({
        "role": "user",
        "content": message
    })

    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json"
            },
            json={
                "model": os.environ.get(
                    "GROQ_MODEL", "openai/gpt-oss-120b"
                ),
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT}
                ] + conversation,
                "temperature": 0.7,
                "max_tokens": 1000
            },
            timeout=60
        )

        if not response.ok:
            return jsonify({
                "error": "AI provider error",
                "details": response.text[:500]
            }), 502

        result = response.json()
        answer = result["choices"][0]["message"]["content"]

        with db_connection() as conn:
            conn.executemany("""
                INSERT INTO messages (user_id, role, content)
                VALUES (?, ?, ?)
            """, [
                (user_id, "user", message),
                (user_id, "assistant", answer)
            ])

        return jsonify({"reply": answer})

    except requests.RequestException:
        app.logger.exception("Groq connection failed")
        return jsonify({
            "error": "Could not connect to the AI provider."
        }), 502

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False
    )
