from flask import Blueprint, jsonify, request
from database import get_connection
from security import login_required, current_user_id

notes_bp = Blueprint('notes', __name__)

@notes_bp.route('/api/notes/<appid>', methods=['GET'])
@login_required
def get_notes(appid):
    user_id = current_user_id()
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "SELECT * FROM notes WHERE appid = %s AND user_id = %s ORDER BY created_at DESC",
        (appid, user_id)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    result = []
    for r in rows:
        row = dict(r)
        row['created_at'] = str(row['created_at'])
        row['updated_at'] = str(row['updated_at'])
        result.append(row)
    return jsonify({'status': 'success', 'notes': result})

@notes_bp.route('/api/notes', methods=['POST'])
@login_required
def create_note():
    user_id   = current_user_id()
    data      = request.get_json() or {}
    appid     = str(data.get('appid'))
    game_name = (data.get('game_name', '') or '')[:255]
    title     = (data.get('title', 'Anotacao') or 'Anotacao')[:255]
    content   = (data.get('content', '') or '')[:10000]
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        """
        INSERT INTO notes (appid, game_name, title, content, user_id)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, appid, game_name, title, content, created_at, updated_at
        """,
        (appid, game_name, title, content, user_id)
    )
    row = dict(cur.fetchone())
    row['created_at'] = str(row['created_at'])
    row['updated_at'] = str(row['updated_at'])
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'note': row})

@notes_bp.route('/api/notes/<int:note_id>', methods=['PUT'])
@login_required
def update_note(note_id):
    user_id = current_user_id()
    data    = request.get_json() or {}
    title   = (data.get('title', 'Anotacao') or 'Anotacao')[:255]
    content = (data.get('content', '') or '')[:10000]
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        """
        UPDATE notes SET title = %s, content = %s, updated_at = NOW()
        WHERE id = %s AND user_id = %s
        RETURNING id, title, content, updated_at
        """,
        (title, content, note_id, user_id)
    )
    found = cur.fetchone()
    if not found:
        conn.rollback()
        cur.close()
        conn.close()
        return jsonify({'status': 'error', 'message': 'Nota não encontrada'}), 404
    row = dict(found)
    row['updated_at'] = str(row['updated_at'])
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'note': row})

@notes_bp.route('/api/notes/<int:note_id>', methods=['DELETE'])
@login_required
def delete_note(note_id):
    user_id = current_user_id()
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("DELETE FROM notes WHERE id = %s AND user_id = %s", (note_id, user_id))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})
