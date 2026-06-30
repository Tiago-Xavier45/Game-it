import os
import pyotp
import qrcode
import io
import base64
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Blueprint, request, jsonify, session, render_template, redirect

auth_bp = Blueprint('auth', __name__)


def usuario_atual():
    uid = session.get('user_id')
    if not uid:
        return None
    from database import get_connection
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id = %s", (uid,))
    user = cur.fetchone()
    cur.close(); conn.close()
    return user


# ── Páginas ──────────────────────────────────────────
@auth_bp.route('/login')
def login_page():
    if session.get('user_id'):
        return redirect('/')
    return render_template('login.html')


@auth_bp.route('/configuracoes')
def settings_page():
    if not session.get('user_id'):
        return redirect('/login')
    return render_template('settings.html')


# ── Register ─────────────────────────────────────────
@auth_bp.route('/api/auth/register', methods=['POST'])
def register():
    from database import get_connection
    d = request.json or {}

    email     = d.get('email', '').strip().lower()
    password  = d.get('password', '')
    name      = d.get('name', '').strip()
    steam_key = d.get('steam_api_key', '').strip() or None
    steam_id  = d.get('steam_id', '').strip() or None
    gem_key   = d.get('gemini_api_key', '').strip() or None

    if not email or not password:
        return jsonify({'status': 'error', 'message': 'Email e senha obrigatórios'})
    if len(password) < 6:
        return jsonify({'status': 'error', 'message': 'Senha deve ter pelo menos 6 caracteres'})

    ph = generate_password_hash(password)
    conn = get_connection()
    cur  = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO users (email, password_hash, name, steam_api_key, steam_id, gemini_api_key)
            VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, email, name
        """, (email, ph, name, steam_key, steam_id, gem_key))
        user = cur.fetchone()
        conn.commit()
        session['user_id']    = user['id']
        session['user_email'] = user['email']
        session['user_name']  = user['name']
        return jsonify({'status': 'success'})
    except Exception as e:
        conn.rollback()
        msg = 'Email já cadastrado.' if 'unique' in str(e).lower() else str(e)
        return jsonify({'status': 'error', 'message': msg})
    finally:
        cur.close(); conn.close()


# ── Login ─────────────────────────────────────────────
@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    from database import get_connection
    d          = request.json or {}
    email      = d.get('email', '').strip().lower()
    password   = d.get('password', '')
    totp_code  = d.get('totp_code', '')

    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = %s", (email,))
    user = cur.fetchone()
    cur.close(); conn.close()

    if not user or not user['password_hash']:
        return jsonify({'status': 'error', 'message': 'Email ou senha incorretos'})
    if not check_password_hash(user['password_hash'], password):
        return jsonify({'status': 'error', 'message': 'Email ou senha incorretos'})

    if user['two_factor_enabled']:
        if not totp_code:
            return jsonify({'status': '2fa_required'})
        if not pyotp.TOTP(user['two_factor_secret']).verify(totp_code):
            return jsonify({'status': 'error', 'message': 'Código 2FA inválido'})

    session['user_id']    = user['id']
    session['user_email'] = user['email']
    session['user_name']  = user['name']
    return jsonify({'status': 'success'})


# ── Logout ────────────────────────────────────────────
@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'status': 'success'})


# ── Me ────────────────────────────────────────────────
@auth_bp.route('/api/auth/me')
def me():
    user = usuario_atual()
    if not user:
        return jsonify({'status': 'error'}), 401
    return jsonify({
        'status': 'success',
        'user': {
            'id':                 user['id'],
            'email':              user['email'],
            'name':               user['name'],
            'has_steam':          bool(user['steam_id']),
            'has_gemini':         bool(user['gemini_api_key']),
            'two_factor_enabled': user['two_factor_enabled']
        }
    })


# ── Update Profile ────────────────────────────────────
@auth_bp.route('/api/auth/profile', methods=['PUT'])
def update_profile():
    from database import get_connection
    user = usuario_atual()
    if not user:
        return jsonify({'status': 'error', 'message': 'Não autenticado'}), 401

    d = request.json or {}
    allowed = ['name', 'steam_api_key', 'steam_id', 'gemini_api_key']
    fields  = {k: (d[k] or None) for k in allowed if k in d}

    if not fields:
        return jsonify({'status': 'error', 'message': 'Nada para atualizar'})

    set_clause = ', '.join(f"{k} = %s" for k in fields)
    values     = list(fields.values()) + [user['id']]

    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(f"UPDATE users SET {set_clause}, updated_at=NOW() WHERE id=%s", values)
    conn.commit()
    cur.close(); conn.close()
    return jsonify({'status': 'success', 'message': 'Perfil atualizado!'})


# ── Change Password ───────────────────────────────────
@auth_bp.route('/api/auth/password', methods=['PUT'])
def change_password():
    from database import get_connection
    user = usuario_atual()
    if not user:
        return jsonify({'status': 'error', 'message': 'Não autenticado'}), 401

    d        = request.json or {}
    cur_pass = d.get('current_password', '')
    new_pass = d.get('new_password', '')

    if not check_password_hash(user['password_hash'], cur_pass):
        return jsonify({'status': 'error', 'message': 'Senha atual incorreta'})
    if len(new_pass) < 6:
        return jsonify({'status': 'error', 'message': 'Nova senha deve ter pelo menos 6 caracteres'})

    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("UPDATE users SET password_hash=%s, updated_at=NOW() WHERE id=%s",
                (generate_password_hash(new_pass), user['id']))
    conn.commit()
    cur.close(); conn.close()
    return jsonify({'status': 'success', 'message': 'Senha alterada!'})


# ── 2FA Setup ─────────────────────────────────────────
@auth_bp.route('/api/auth/2fa/setup', methods=['POST'])
def setup_2fa():
    user = usuario_atual()
    if not user:
        return jsonify({'status': 'error'}), 401

    secret = pyotp.random_base32()
    uri    = pyotp.TOTP(secret).provisioning_uri(name=user['email'], issuer_name='Game It')

    img    = qrcode.make(uri)
    buf    = io.BytesIO()
    img.save(buf, format='PNG')
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    session['2fa_temp'] = secret
    return jsonify({'status': 'success', 'secret': secret, 'qr': f'data:image/png;base64,{qr_b64}'})


@auth_bp.route('/api/auth/2fa/confirm', methods=['POST'])
def confirm_2fa():
    from database import get_connection
    user   = usuario_atual()
    if not user:
        return jsonify({'status': 'error'}), 401

    code   = (request.json or {}).get('code', '')
    secret = session.get('2fa_temp')
    if not secret:
        return jsonify({'status': 'error', 'message': 'Sessão expirada'})
    if not pyotp.TOTP(secret).verify(code):
        return jsonify({'status': 'error', 'message': 'Código inválido'})

    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("UPDATE users SET two_factor_secret=%s, two_factor_enabled=TRUE WHERE id=%s",
                (secret, user['id']))
    conn.commit()
    cur.close(); conn.close()
    session.pop('2fa_temp', None)
    return jsonify({'status': 'success', 'message': '2FA ativado!'})


@auth_bp.route('/api/auth/2fa/disable', methods=['POST'])
def disable_2fa():
    from database import get_connection
    user = usuario_atual()
    if not user:
        return jsonify({'status': 'error'}), 401

    code = (request.json or {}).get('code', '')
    if not pyotp.TOTP(user['two_factor_secret']).verify(code):
        return jsonify({'status': 'error', 'message': 'Código inválido'})

    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("UPDATE users SET two_factor_secret=NULL, two_factor_enabled=FALSE WHERE id=%s",
                (user['id'],))
    conn.commit()
    cur.close(); conn.close()
    return jsonify({'status': 'success', 'message': '2FA desativado!'})
