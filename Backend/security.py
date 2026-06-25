"""
security.py — utilitários de segurança centralizados do Game It.

Inclui:
- login_required: protege rotas (API => 401 JSON, páginas => redirect /login)
- current_user_id: id do usuário autenticado (ou None)
- is_valid_image: valida arquivo de imagem por "magic bytes" (não confia na extensão)
- clamp_text: sanitiza/limita textos vindos do cliente
- load_secret_key: carrega/gera SECRET_KEY persistente
"""

import os
import secrets
import functools
from flask import session, jsonify, request, redirect


# ── Autenticação ────────────────────────────────────────
def current_user_id():
    """Retorna o id do usuário logado ou None."""
    return session.get('user_id')


def login_required(view):
    """Bloqueia acesso não autenticado.

    Rotas de API (/api/...) respondem 401 JSON; páginas redirecionam ao login.
    """
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            if request.path.startswith('/api/'):
                return jsonify({'status': 'error', 'message': 'Não autenticado'}), 401
            return redirect('/login')
        return view(*args, **kwargs)
    return wrapper


# ── Upload de imagens ───────────────────────────────────
ALLOWED_IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}


def is_valid_image(stream):
    """Confere os primeiros bytes do arquivo para garantir que é uma imagem real.

    Evita upload de scripts/HTML renomeados com extensão de imagem.
    """
    head = stream.read(12)
    stream.seek(0)
    if head.startswith(b'\x89PNG\r\n\x1a\n'):              # PNG
        return True
    if head[:3] == b'\xff\xd8\xff':                         # JPEG
        return True
    if head[:4] in (b'GIF8',):                              # GIF
        return True
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':       # WEBP
        return True
    return False


# ── Sanitização de texto ────────────────────────────────
def clamp_text(value, maxlen, default=''):
    """Garante string, remove espaços nas pontas e limita o tamanho."""
    if value is None:
        return default
    if not isinstance(value, str):
        value = str(value)
    return value.strip()[:maxlen]


# ── Validação de URL de imagem (para campos vindos do cliente) ──
def safe_image_url(url):
    """Aceita apenas URLs http(s) ou caminhos internos /static/.

    Retorna None se a URL não for confiável (previne XSS/`javascript:`).
    """
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if url.startswith('/static/'):
        return url
    if url.startswith('https://') or url.startswith('http://'):
        return url[:500]
    return None


# ── SECRET_KEY persistente ──────────────────────────────
def load_secret_key(root_dir):
    """Usa SECRET_KEY do ambiente; senão gera e persiste em .secret_key."""
    env = os.getenv('SECRET_KEY')
    if env:
        return env
    path = os.path.join(root_dir, '.secret_key')
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                saved = f.read().strip()
                if saved:
                    return saved
        key = secrets.token_hex(32)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(key)
        return key
    except OSError:
        # Sem permissão de escrita: gera efêmero (sessões expiram no restart)
        return secrets.token_hex(32)
