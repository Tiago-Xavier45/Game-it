import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'backend'))

from flask import Flask, render_template, session, redirect
from database import init_db
from routes.steam  import steam_bp
from routes.gemini import gemini_bp
from routes.notes  import notes_bp
from routes.auth   import auth_bp

app = Flask(
    __name__,
    template_folder=os.path.join(ROOT, 'Frontend', 'template'),
    static_folder=os.path.join(ROOT,  'Frontend', 'static')
)

app.secret_key = os.getenv('SECRET_KEY', 'gameit-secret-dev-key')

app.register_blueprint(auth_bp)
app.register_blueprint(steam_bp)
app.register_blueprint(gemini_bp)
app.register_blueprint(notes_bp)


@app.route('/')
def index():
    if not session.get('user_id'):
        return redirect('/login')
    return render_template('profile.html')


@app.route('/perfil')
def perfil():
    if not session.get('user_id'):
        return redirect('/login')
    return render_template('profile.html')


@app.route('/progresso')
def progresso():
    if not session.get('user_id'):
        return redirect('/login')
    return render_template('index.html')


@app.route('/configuracoes')
def configuracoes():
    if not session.get('user_id'):
        return redirect('/login')
    return render_template('settings.html')


@app.route('/login')
def login_page():
    if session.get('user_id'):
        return redirect('/')
    return render_template('login.html')


def init_app():
    init_db()
