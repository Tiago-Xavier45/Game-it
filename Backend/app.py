import os
import sys
from datetime import timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'backend'))

from flask import Flask, render_template, session, redirect
from database import init_db
from security import load_secret_key
from routes.steam  import steam_bp
from routes.gemini import gemini_bp
from routes.notes  import notes_bp
from routes.auth   import auth_bp
from routes.social import social_bp

app = Flask(
    __name__,
    template_folder=os.path.join(ROOT, 'Frontend', 'template'),
    static_folder=os.path.join(ROOT,  'Frontend', 'static')
)

# ── Segurança ───────────────────────────────────────────
app.secret_key = load_secret_key(ROOT)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,                                   # JS não acessa o cookie
    SESSION_COOKIE_SAMESITE='Lax',                                  # mitiga CSRF
    SESSION_COOKIE_SECURE=os.getenv('COOKIE_SECURE', '0') == '1',   # HTTPS em produção
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,                             # uploads até 5 MB
)


@app.after_request
def security_headers(resp):
    """Cabeçalhos de segurança aplicados a todas as respostas."""
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return resp


app.register_blueprint(auth_bp)
app.register_blueprint(steam_bp)
app.register_blueprint(gemini_bp)
app.register_blueprint(notes_bp)
app.register_blueprint(social_bp)


# ── Rotas de Página ──────────────────────────────────
def login_required(f):
    from functools import wraps
    @wraps(f)
    def check_session(*args, **kwargs):
        if not session.get('user_id'):
            return redirect('/login')
        return f(*args, **kwargs)
    return check_session


@app.route('/login')
def login_page():
    if session.get('user_id'):
        return redirect('/')
    return render_template('login.html')


@app.route('/')
@login_required
def index():
    return render_template('profile.html')


@app.route('/perfil')
@login_required
def perfil():
    return render_template('profile.html')


@app.route('/progresso')
@login_required
def progresso():
    return render_template('index.html')


@app.route('/jogo/<appid>')
@login_required
def jogo(appid):
    return render_template('game.html', appid=appid)

@app.route('/game/<appid>')
def game_page(appid):
    if not session.get('user_id'):
        return redirect('/login')
    return render_template('game.html', appid=appid)


def init_app():
    init_db()
