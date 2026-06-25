import os
import re
import uuid
import requests
from collections import Counter
from datetime import datetime, date, timedelta
from flask import Blueprint, request, jsonify, session, current_app
from psycopg.types.json import Json
from database import get_connection
from security import (
    login_required, current_user_id, is_valid_image,
    clamp_text, ALLOWED_IMAGE_EXT
)

social_bp = Blueprint('social', __name__)

STEAM_API = 'https://api.steampowered.com'

MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
         'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

# Palavras ignoradas no cálculo de trending
STOPWORDS = {
    'que', 'para', 'com', 'uma', 'um', 'os', 'as', 'de', 'da', 'do', 'das', 'dos',
    'no', 'na', 'nos', 'nas', 'em', 'por', 'mais', 'mas', 'meu', 'minha', 'seu',
    'sua', 'ele', 'ela', 'isso', 'esse', 'essa', 'este', 'esta', 'ao', 'aos',
    'the', 'and', 'for', 'you', 'are', 'not', 'pra', 'pro', 'tem', 'foi', 'ser',
    'já', 'só', 'também', 'quero', 'vou', 'aqui', 'agora', 'todo', 'toda', 'muito'
}

COVER_URL = 'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg'
HEADER_URL = 'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg'

# Mapeia o status escolhido na review para o status pessoal do jogo
REVIEW_TO_STATUS = {
    'Completed': 'jogado', 'Playing': 'jogando',
    'Backlog': 'backlog', 'Wishlist': 'wishlist'
}
GAME_STATUSES = {'jogando', 'backlog', 'wishlist', 'jogado', 'platinado'}


def _parse_date(value):
    """Converte 'YYYY-MM-DD' em date; retorna None se inválido."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def _is_platinum(cur, user_id, appid):
    """True se a biblioteca do usuário já marca 100% de conquistas no jogo."""
    if not appid:
        return False
    cur.execute("SELECT status, pct FROM user_games WHERE user_id=%s AND appid=%s",
                (user_id, appid))
    row = cur.fetchone()
    if not row:
        return False
    try:
        pct = float(row.get('pct') or 0)
    except (TypeError, ValueError):
        pct = 0
    return pct >= 100 or (row.get('status') == '100%')


def _played_minutes(cur, user_id, appid):
    """Minutos jogados registrados na biblioteca (0 se não houver)."""
    if not appid:
        return 0
    cur.execute("SELECT playtime_forever FROM user_games WHERE user_id=%s AND appid=%s",
                (user_id, appid))
    row = cur.fetchone()
    return int(row['playtime_forever'] or 0) if row else 0


# ── Helpers ─────────────────────────────────────────────
def uid():
    """Id do usuário autenticado (as rotas usam @login_required)."""
    return current_user_id()


def get_steam_creds():
    return os.getenv('STEAM_API_KEY'), os.getenv('STEAM_ID')


def fetch_steam_summary():
    """Retorna o dict do jogador na Steam (ou None)."""
    key, sid = get_steam_creds()
    if not key or not sid:
        return None
    try:
        url = f'{STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key={key}&steamids={sid}'
        players = requests.get(url, timeout=8).json().get('response', {}).get('players', [])
        return players[0] if players else None
    except Exception:
        return None


def get_user_row(user_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row


# ═══════════════════════════════════════════════════════
#  PERFIL
# ═══════════════════════════════════════════════════════
@social_bp.route('/api/profile')
@login_required
def get_profile():
    user_id = uid()
    user = get_user_row(user_id)
    steam = fetch_steam_summary()

    # Nickname
    nickname = None
    if user and user.get('display_name'):
        nickname = user['display_name']
    elif steam and steam.get('personaname'):
        nickname = steam['personaname']
    elif user and user.get('name'):
        nickname = user['name']
    else:
        nickname = 'Jogador'

    # Avatar: preferência manual > steam
    avatar = (user and user.get('avatar_url')) or (steam and steam.get('avatarfull')) \
        or '/static/img/Game It Logo.svg'

    cover = (user and user.get('cover_url')) or None
    bio = (user and user.get('bio')) or ''

    # Data de entrada
    joined = 'Recentemente'
    if user and user.get('created_at'):
        d = user['created_at']
        joined = f'Entrou em {MESES[d.month - 1]} de {d.year}'

    # Jogos favoritos
    favs = []
    fav_ids = (user and user.get('favorite_games')) or []
    if fav_ids:
        conn = get_connection()
        cur = conn.cursor()
        for appid in fav_ids:
            cur.execute(
                "SELECT name FROM user_games WHERE user_id=%s AND appid=%s",
                (user_id, str(appid))
            )
            row = cur.fetchone()
            favs.append({
                'appid': appid,
                'name': row['name'] if row else 'Jogo',
                'cover': COVER_URL.format(appid=appid)
            })
        cur.close()
        conn.close()

    # Follows
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM follows WHERE follower_id=%s", (user_id,))
    following = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM follows WHERE following_id=%s", (user_id,))
    followers = cur.fetchone()['c']
    cur.close()
    conn.close()

    return jsonify({
        'status': 'success',
        'profile': {
            'nickname': nickname,
            'avatar': avatar,
            'cover': cover,
            'bio': bio,
            'joined': joined,
            'favorites': favs,
            'following': following,
            'followers': followers
        }
    })


@social_bp.route('/api/profile', methods=['PUT'])
@login_required
def update_profile():
    user_id = uid()
    d = request.get_json() or {}

    # Apenas nickname e bio são editáveis por JSON.
    # Avatar/capa só mudam via upload validado (/api/profile/upload).
    fields = {}
    if 'nickname' in d:   fields['display_name'] = clamp_text(d.get('nickname'), 40) or None
    if 'bio' in d:        fields['bio'] = clamp_text(d.get('bio'), 200)

    conn = get_connection()
    cur = conn.cursor()

    if 'favorites' in d:
        favs = d['favorites'] or []
        favs = [str(a) for a in favs][:3]
        cur.execute("UPDATE users SET favorite_games=%s, updated_at=NOW() WHERE id=%s",
                    (Json(favs), user_id))

    if fields:
        set_clause = ', '.join(f"{k}=%s" for k in fields)
        values = list(fields.values()) + [user_id]
        cur.execute(f"UPDATE users SET {set_clause}, updated_at=NOW() WHERE id=%s", values)

    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'message': 'Perfil atualizado!'})


@social_bp.route('/api/profile/upload', methods=['POST'])
@login_required
def upload_image():
    """Recebe um arquivo (avatar ou cover) e salva em static/uploads."""
    user_id = uid()
    tipo = request.args.get('type', 'avatar')
    if tipo not in ('avatar', 'cover'):
        return jsonify({'status': 'error', 'message': 'Tipo inválido'}), 400

    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'Nenhum arquivo enviado'}), 400

    f = request.files['file']
    ext = os.path.splitext(f.filename or '')[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({'status': 'error', 'message': 'Formato não suportado'}), 400

    # Valida o conteúdo real do arquivo (não confia na extensão)
    if not is_valid_image(f.stream):
        return jsonify({'status': 'error', 'message': 'Arquivo não é uma imagem válida'}), 400

    uploads_dir = os.path.join(current_app.static_folder, 'uploads')
    os.makedirs(uploads_dir, exist_ok=True)

    # Nome gerado pelo servidor (sem usar o nome do cliente) => sem path traversal
    fname = f'{tipo}_{user_id}_{uuid.uuid4().hex[:8]}{ext}'
    f.save(os.path.join(uploads_dir, fname))
    url = f'/static/uploads/{fname}'

    col = 'avatar_url' if tipo == 'avatar' else 'cover_url'
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f"UPDATE users SET {col}=%s, updated_at=NOW() WHERE id=%s", (url, user_id))
    conn.commit()
    cur.close()
    conn.close()

    return jsonify({'status': 'success', 'url': url})


# ═══════════════════════════════════════════════════════
#  POSTS
# ═══════════════════════════════════════════════════════
def _humaniza(dt):
    diff = datetime.now() - dt
    s = diff.total_seconds()
    if s < 60:    return 'agora'
    if s < 3600:  return f'{int(s // 60)}min'
    if s < 86400: return f'{int(s // 3600)}h'
    if s < 604800: return f'{int(s // 86400)}d'
    return dt.strftime('%d %b, %Y')


@social_bp.route('/api/posts')
@login_required
def list_posts():
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT p.id, p.content, p.image_url, p.created_at, p.user_id,
               u.display_name, u.name, u.avatar_url,
               (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
               EXISTS(SELECT 1 FROM post_likes pl
                      WHERE pl.post_id = p.id AND pl.user_id = %s) AS liked
        FROM posts p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT 100
        """,
        (user_id,)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    steam = fetch_steam_summary()
    steam_av = steam.get('avatarfull') if steam else None
    steam_name = steam.get('personaname') if steam else None

    posts = []
    for r in rows:
        name = r['display_name'] or steam_name or r['name'] or 'Jogador'
        avatar = r['avatar_url'] or steam_av or '/static/img/Game It Logo.svg'
        posts.append({
            'id': r['id'],
            'name': name,
            'avatar': avatar,
            'content': r['content'],
            'image_url': r['image_url'],
            'time': _humaniza(r['created_at']),
            'likes': r['likes'],
            'liked': r['liked']
        })

    return jsonify({'status': 'success', 'posts': posts})


@social_bp.route('/api/posts', methods=['POST'])
@login_required
def create_post():
    user_id = uid()
    d = request.get_json() or {}
    content = clamp_text(d.get('content'), 1000)
    if not content:
        return jsonify({'status': 'error', 'message': 'Escreva algo para postar.'}), 400

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO posts (user_id, content) VALUES (%s, %s) RETURNING id",
        (user_id, content)
    )
    pid = cur.fetchone()['id']
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'id': pid})


@social_bp.route('/api/posts/<int:post_id>', methods=['DELETE'])
@login_required
def delete_post(post_id):
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM posts WHERE id=%s AND user_id=%s", (post_id, user_id))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


@social_bp.route('/api/posts/<int:post_id>/like', methods=['POST'])
@login_required
def toggle_like(post_id):
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM post_likes WHERE post_id=%s AND user_id=%s", (post_id, user_id))
    exists = cur.fetchone()
    if exists:
        cur.execute("DELETE FROM post_likes WHERE post_id=%s AND user_id=%s", (post_id, user_id))
        liked = False
    else:
        cur.execute("INSERT INTO post_likes (post_id, user_id) VALUES (%s, %s)", (post_id, user_id))
        liked = True
    cur.execute("SELECT COUNT(*) AS c FROM post_likes WHERE post_id=%s", (post_id,))
    likes = cur.fetchone()['c']
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'liked': liked, 'likes': likes})


@social_bp.route('/api/posts/liked')
@login_required
def liked_posts():
    """Posts curtidos pelo usuário (aba Curtidas)."""
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT p.id, p.content, p.image_url, p.created_at,
               u.display_name, u.name, u.avatar_url,
               (SELECT COUNT(*) FROM post_likes pl2 WHERE pl2.post_id = p.id) AS likes
        FROM post_likes pl
        JOIN posts p ON p.id = pl.post_id
        JOIN users u ON u.id = p.user_id
        WHERE pl.user_id = %s
        ORDER BY pl.created_at DESC
        """,
        (user_id,)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    steam = fetch_steam_summary()
    steam_av = steam.get('avatarfull') if steam else None
    steam_name = steam.get('personaname') if steam else None

    posts = [{
        'id': r['id'],
        'name': r['display_name'] or steam_name or r['name'] or 'Jogador',
        'avatar': r['avatar_url'] or steam_av or '/static/img/Game It Logo.svg',
        'content': r['content'],
        'image_url': r['image_url'],
        'time': _humaniza(r['created_at']),
        'likes': r['likes'],
        'liked': True
    } for r in rows]

    return jsonify({'status': 'success', 'posts': posts})


# ═══════════════════════════════════════════════════════
#  REVIEWS / AVALIAÇÕES
# ═══════════════════════════════════════════════════════
@social_bp.route('/api/reviews')
@login_required
def list_reviews():
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT r.id, r.appid, r.game_name, r.rating, r.content, r.created_at, "
        "       r.platform, r.contains_spoilers, r.status, r.started_at, r.replay, r.platinum, "
        "       (SELECT COUNT(*) FROM review_likes l WHERE l.review_id=r.id) AS likes, "
        "       EXISTS(SELECT 1 FROM review_likes l WHERE l.review_id=r.id AND l.user_id=%s) AS liked "
        "FROM reviews r WHERE r.user_id=%s ORDER BY r.created_at DESC",
        (user_id, user_id)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    reviews = [{
        'id': r['id'],
        'appid': r['appid'],
        'game_name': r['game_name'],
        'rating': r['rating'],
        'content': r['content'],
        'platform': r.get('platform') or 'steam',
        'spoilers': bool(r.get('contains_spoilers')),
        'status': r.get('status') or 'Completed',
        'started_at': r['started_at'].isoformat() if r.get('started_at') else None,
        'replay': bool(r.get('replay')),
        'platinum': bool(r.get('platinum')),
        'likes': r.get('likes') or 0,
        'liked': bool(r.get('liked')),
        'time': _humaniza(r['created_at']),
        'cover': HEADER_URL.format(appid=r['appid']) if r['appid'] else None
    } for r in rows]
    return jsonify({'status': 'success', 'reviews': reviews})


@social_bp.route('/api/reviews', methods=['POST'])
@login_required
def create_review():
    user_id = uid()
    d = request.get_json() or {}
    try:
        rating = int(d.get('rating', 0))
    except (TypeError, ValueError):
        rating = 0
    if rating < 1 or rating > 5:
        return jsonify({'status': 'error', 'message': 'Nota deve ser entre 1 e 5'}), 400

    appid = clamp_text(d.get('appid'), 20)
    game_name = clamp_text(d.get('game_name'), 255)
    content = clamp_text(d.get('content'), 1000)
    platform = clamp_text(d.get('platform'), 30) or 'steam'
    spoilers = bool(d.get('spoilers'))
    status = clamp_text(d.get('status'), 30) or 'Completed'
    replay = bool(d.get('replay'))
    started_at = _parse_date(d.get('started_at'))

    conn = get_connection()
    cur = conn.cursor()

    # Platinado automático se a biblioteca já marca 100% de conquistas
    platinum = _is_platinum(cur, user_id, appid)

    cur.execute(
        "INSERT INTO reviews "
        "(user_id, appid, game_name, rating, content, platform, contains_spoilers, "
        " status, started_at, replay, platinum) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (user_id, appid, game_name, rating, content, platform, spoilers,
         status, started_at, replay, platinum)
    )
    rid = cur.fetchone()['id']

    # Atualiza o status pessoal do jogo (quadro lateral)
    if appid:
        gstatus = 'platinado' if platinum else REVIEW_TO_STATUS.get(status, 'jogado')
        cur.execute(
            "INSERT INTO game_status "
            "(user_id, appid, game_name, platform, status, started_at, replay_count, platinum, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW()) "
            "ON CONFLICT (user_id, appid) DO UPDATE SET "
            "  status=EXCLUDED.status, game_name=EXCLUDED.game_name, "
            "  platform=EXCLUDED.platform, started_at=COALESCE(EXCLUDED.started_at, game_status.started_at), "
            "  replay_count=GREATEST(game_status.replay_count, EXCLUDED.replay_count), "
            "  platinum=EXCLUDED.platinum, updated_at=NOW()",
            (user_id, appid, game_name, platform, gstatus, started_at,
             1 if replay else 0, platinum)
        )

    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'id': rid})


@social_bp.route('/api/reviews/<int:review_id>', methods=['DELETE'])
@login_required
def delete_review(review_id):
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM reviews WHERE id=%s AND user_id=%s", (review_id, user_id))
    deleted = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    if not deleted:
        return jsonify({'status': 'error', 'message': 'Review não encontrada'}), 404
    return jsonify({'status': 'success'})


@social_bp.route('/api/reviews/<int:review_id>/like', methods=['POST'])
@login_required
def like_review(review_id):
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM reviews WHERE id=%s", (review_id,))
    if not cur.fetchone():
        cur.close()
        conn.close()
        return jsonify({'status': 'error', 'message': 'Review não encontrada'}), 404

    cur.execute("SELECT 1 FROM review_likes WHERE review_id=%s AND user_id=%s",
                (review_id, user_id))
    if cur.fetchone():
        cur.execute("DELETE FROM review_likes WHERE review_id=%s AND user_id=%s",
                    (review_id, user_id))
        liked = False
    else:
        cur.execute("INSERT INTO review_likes (review_id, user_id) VALUES (%s,%s) "
                    "ON CONFLICT DO NOTHING", (review_id, user_id))
        liked = True

    cur.execute("SELECT COUNT(*) AS c FROM review_likes WHERE review_id=%s", (review_id,))
    count = cur.fetchone()['c']
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'liked': liked, 'likes': count})


@social_bp.route('/api/reviews/ratings')
@login_required
def review_ratings():
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT rating, COUNT(*) AS c FROM reviews WHERE user_id=%s GROUP BY rating",
        (user_id,)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    dist = {5: 0, 4: 0, 3: 0, 2: 0, 1: 0}
    for r in rows:
        dist[r['rating']] = r['c']
    total = sum(dist.values())

    return jsonify({'status': 'success', 'distribution': dist, 'total': total})


# ═══════════════════════════════════════════════════════
#  TRENDING TOPICS (a partir dos posts)
# ═══════════════════════════════════════════════════════
@social_bp.route('/api/trending')
@login_required
def trending():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT content FROM posts ORDER BY created_at DESC LIMIT 500")
    rows = cur.fetchall()
    cur.close()
    conn.close()

    hashtags = Counter()
    words = Counter()
    for r in rows:
        text = r['content'] or ''
        for tag in re.findall(r'#(\w+)', text):
            hashtags['#' + tag] += 1
        for w in re.findall(r'\b[a-zA-ZÀ-ÿ]{4,}\b', text.lower()):
            if w not in STOPWORDS:
                words[w] += 1

    topics = []
    for tag, count in hashtags.most_common(5):
        topics.append({'tag': tag, 'count': count})
    if len(topics) < 5:
        for w, count in words.most_common(10):
            if count < 2:
                continue
            topics.append({'tag': w.capitalize(), 'count': count})
            if len(topics) >= 5:
                break

    return jsonify({'status': 'success', 'topics': topics})


# ═══════════════════════════════════════════════════════
#  PLATAFORMAS CONECTADAS
# ═══════════════════════════════════════════════════════
@social_bp.route('/api/platforms')
@login_required
def platforms():
    user_id = uid()
    _, sid = get_steam_creds()

    result = []
    if sid:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(SUM(playtime_forever),0) AS total, COUNT(*) AS jogos "
            "FROM user_games WHERE user_id=%s", (user_id,)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        result.append({
            'name': 'Steam',
            'icon': 'steam',
            'games': row['jogos'],
            'minutes': int(row['total']),
            'pct': 100
        })

    return jsonify({'status': 'success', 'platforms': result})


# ═══════════════════════════════════════════════════════
#  LISTAS DE JOGOS
# ═══════════════════════════════════════════════════════
LIST_KINDS = {'custom', 'backlog', 'all', 'platform'}


def _list_owned(cur, list_id, user_id):
    """Confere se a lista pertence ao usuário. Retorna a row ou None."""
    cur.execute("SELECT * FROM game_lists WHERE id=%s AND user_id=%s", (list_id, user_id))
    return cur.fetchone()


@social_bp.route('/api/lists')
@login_required
def list_lists():
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, title, kind, platform, created_at "
        "FROM game_lists WHERE user_id=%s ORDER BY created_at DESC",
        (user_id,)
    )
    lists = cur.fetchall()

    result = []
    for lst in lists:
        cur.execute("SELECT COUNT(*) AS c FROM list_games WHERE list_id=%s", (lst['id'],))
        count = cur.fetchone()['c']
        cur.execute(
            "SELECT appid FROM list_games WHERE list_id=%s ORDER BY added_at ASC LIMIT 4",
            (lst['id'],)
        )
        preview = [COVER_URL.format(appid=r['appid']) for r in cur.fetchall()]
        result.append({
            'id': lst['id'],
            'title': lst['title'],
            'kind': lst['kind'],
            'platform': lst['platform'],
            'count': count,
            'preview': preview
        })

    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'lists': result})


@social_bp.route('/api/lists', methods=['POST'])
@login_required
def create_list():
    user_id = uid()
    d = request.get_json() or {}
    title = clamp_text(d.get('title'), 120)
    kind = clamp_text(d.get('kind'), 30) or 'custom'
    platform = clamp_text(d.get('platform'), 30) or None
    if kind not in LIST_KINDS:
        kind = 'custom'
    if not title:
        return jsonify({'status': 'error', 'message': 'Dê um título à lista.'}), 400

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO game_lists (user_id, title, kind, platform) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, title, kind, platform)
    )
    list_id = cur.fetchone()['id']

    # Auto-popula listas dinâmicas a partir da biblioteca
    if kind in ('all', 'platform'):
        cur.execute(
            "SELECT appid, name FROM user_games WHERE user_id=%s ORDER BY name ASC",
            (user_id,)
        )
        for g in cur.fetchall():
            cur.execute(
                "INSERT INTO list_games (list_id, appid, name, platform) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (list_id, g['appid'], g['name'], 'steam')
            )

    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'id': list_id})


@social_bp.route('/api/lists/<int:list_id>')
@login_required
def get_list(list_id):
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    lst = _list_owned(cur, list_id, user_id)
    if not lst:
        cur.close()
        conn.close()
        return jsonify({'status': 'error', 'message': 'Lista não encontrada'}), 404

    cur.execute(
        "SELECT appid, name, platform FROM list_games WHERE list_id=%s ORDER BY added_at ASC",
        (list_id,)
    )
    games = [{
        'appid': r['appid'],
        'name': r['name'],
        'platform': r['platform'] or 'steam',
        'cover': COVER_URL.format(appid=r['appid']),
        'header': HEADER_URL.format(appid=r['appid'])
    } for r in cur.fetchall()]
    cur.close()
    conn.close()

    return jsonify({
        'status': 'success',
        'list': {
            'id': lst['id'],
            'title': lst['title'],
            'kind': lst['kind'],
            'platform': lst['platform'],
            'count': len(games),
            'games': games
        }
    })


@social_bp.route('/api/lists/<int:list_id>', methods=['DELETE'])
@login_required
def delete_list(list_id):
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM game_lists WHERE id=%s AND user_id=%s", (list_id, user_id))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


@social_bp.route('/api/lists/<int:list_id>/games', methods=['POST'])
@login_required
def add_list_games(list_id):
    user_id = uid()
    d = request.get_json() or {}
    games = d.get('games') or []
    if not isinstance(games, list):
        return jsonify({'status': 'error', 'message': 'Formato inválido'}), 400

    conn = get_connection()
    cur = conn.cursor()
    if not _list_owned(cur, list_id, user_id):
        cur.close()
        conn.close()
        return jsonify({'status': 'error', 'message': 'Lista não encontrada'}), 404

    added = 0
    for g in games[:200]:
        appid = clamp_text(g.get('appid') if isinstance(g, dict) else g, 20)
        name = clamp_text(g.get('name') if isinstance(g, dict) else '', 255)
        if not appid:
            continue
        cur.execute(
            "INSERT INTO list_games (list_id, appid, name, platform) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (list_id, appid, name, 'steam')
        )
        added += cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'added': added})


@social_bp.route('/api/lists/<int:list_id>/games/<appid>', methods=['DELETE'])
@login_required
def remove_list_game(list_id, appid):
    user_id = uid()
    appid = clamp_text(appid, 20)
    conn = get_connection()
    cur = conn.cursor()
    if not _list_owned(cur, list_id, user_id):
        cur.close()
        conn.close()
        return jsonify({'status': 'error', 'message': 'Lista não encontrada'}), 404
    cur.execute("DELETE FROM list_games WHERE list_id=%s AND appid=%s", (list_id, appid))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


# ═══════════════════════════════════════════════════════
#  PÁGINA DE PERFIL DO JOGO
# ═══════════════════════════════════════════════════════
GAME_CACHE_TTL = timedelta(days=7)


def fetch_game_details(appid):
    """Resumo do jogo via Steam Store (com cache de 7 dias no banco)."""
    if not appid:
        return {}
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT data, updated_at FROM game_cache WHERE appid=%s", (appid,))
    row = cur.fetchone()
    if row and row['updated_at'] and (datetime.now() - row['updated_at'] < GAME_CACHE_TTL):
        cur.close()
        conn.close()
        return row['data'] or {}

    data = {}
    # Resumo / metadados
    try:
        url = ('https://store.steampowered.com/api/appdetails'
               f'?appids={appid}&l=portuguese')
        j = requests.get(url, timeout=10).json()
        entry = j.get(str(appid), {})
        if entry.get('success'):
            d = entry['data']
            data.update({
                'name': d.get('name'),
                'description': d.get('short_description'),
                'header': d.get('header_image'),
                'genres': [g.get('description') for g in d.get('genres', []) if g.get('description')],
                'release': (d.get('release_date') or {}).get('date'),
                'developers': d.get('developers', []),
            })
    except Exception:
        pass

    # Score global da Steam
    try:
        url2 = (f'https://store.steampowered.com/appreviews/{appid}'
                '?json=1&language=all&purchase_type=all&num_per_page=0')
        qs = requests.get(url2, timeout=10).json().get('query_summary', {})
        total = qs.get('total_reviews', 0) or 0
        pos = qs.get('total_positive', 0) or 0
        data['steam_score_desc'] = qs.get('review_score_desc')
        data['steam_positive_pct'] = round(pos / total * 100) if total else None
        data['steam_total_reviews'] = total
    except Exception:
        pass

    cur.execute(
        "INSERT INTO game_cache (appid, data, updated_at) VALUES (%s,%s,NOW()) "
        "ON CONFLICT (appid) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()",
        (appid, Json(data))
    )
    conn.commit()
    cur.close()
    conn.close()
    return data


def _review_to_dict(r, with_author=False):
    item = {
        'id': r['id'],
        'rating': r['rating'],
        'content': r['content'],
        'platform': r.get('platform') or 'steam',
        'spoilers': bool(r.get('contains_spoilers')),
        'status': r.get('status') or 'Completed',
        'started_at': r['started_at'].isoformat() if r.get('started_at') else None,
        'replay': bool(r.get('replay')),
        'platinum': bool(r.get('platinum')),
        'likes': r.get('likes') or 0,
        'liked': bool(r.get('liked')),
        'time': _humaniza(r['created_at']),
    }
    if with_author:
        item['author'] = r.get('display_name') or r.get('name') or 'Jogador'
        item['avatar'] = r.get('avatar_url')
        item['is_mine'] = r.get('is_mine', False)
    return item


@social_bp.route('/api/game/<appid>')
@login_required
def game_profile(appid):
    user_id = uid()
    appid = clamp_text(appid, 20)
    if not appid:
        return jsonify({'status': 'error', 'message': 'Jogo inválido'}), 400

    details = fetch_game_details(appid)

    conn = get_connection()
    cur = conn.cursor()

    # Média da comunidade (reviews do Game It)
    cur.execute("SELECT AVG(rating)::numeric(3,2) AS avg, COUNT(*) AS c "
                "FROM reviews WHERE appid=%s", (appid,))
    row = cur.fetchone()
    community_avg = float(row['avg']) if row['avg'] is not None else None
    community_count = row['c']

    # Status pessoal do usuário neste jogo
    cur.execute("SELECT status, started_at, replay_count, platinum "
                "FROM game_status WHERE user_id=%s AND appid=%s", (user_id, appid))
    gs = cur.fetchone()
    played_min = _played_minutes(cur, user_id, appid)
    auto_plat = _is_platinum(cur, user_id, appid)
    user_status = {
        'status': (gs['status'] if gs else ('jogado' if played_min > 0 else None)),
        'started_at': gs['started_at'].isoformat() if gs and gs['started_at'] else None,
        'replay_count': gs['replay_count'] if gs else 0,
        'platinum': bool(gs['platinum']) if gs else auto_plat,
        'played': played_min > 0,
        'played_minutes': played_min,
    }

    # Quadro de contagem por status (biblioteca do usuário)
    cur.execute("SELECT status, COUNT(*) AS c FROM game_status WHERE user_id=%s GROUP BY status",
                (user_id,))
    counts = {s: 0 for s in GAME_STATUSES}
    for r in cur.fetchall():
        if r['status'] in counts:
            counts[r['status']] = r['c']

    # Reviews da comunidade para este jogo (= comentários)
    cur.execute(
        "SELECT r.id, r.user_id, r.rating, r.content, r.created_at, r.platform, "
        "       r.contains_spoilers, r.status, r.started_at, r.replay, r.platinum, "
        "       u.display_name, u.name, u.avatar_url, "
        "       (SELECT COUNT(*) FROM review_likes l WHERE l.review_id=r.id) AS likes, "
        "       EXISTS(SELECT 1 FROM review_likes l WHERE l.review_id=r.id AND l.user_id=%s) AS liked "
        "FROM reviews r JOIN users u ON u.id=r.user_id "
        "WHERE r.appid=%s ORDER BY r.created_at DESC LIMIT 100",
        (user_id, appid)
    )
    reviews = []
    for r in cur.fetchall():
        r['is_mine'] = (r['user_id'] == user_id)
        reviews.append(_review_to_dict(r, with_author=True))

    # Nome salvo localmente (fallback caso o Steam não retorne dados)
    cur.execute(
        "SELECT name FROM user_games WHERE user_id=%s AND appid=%s "
        "UNION ALL SELECT game_name FROM game_status WHERE user_id=%s AND appid=%s "
        "LIMIT 1",
        (user_id, appid, user_id, appid)
    )
    nm = cur.fetchone()
    db_name = nm['name'] if nm and nm.get('name') else None

    cur.close()
    conn.close()

    game_name = details.get('name') or db_name
    return jsonify({
        'status': 'success',
        'game': {
            'appid': appid,
            'name': game_name,
            'description': details.get('description'),
            'header': details.get('header') or HEADER_URL.format(appid=appid),
            'cover': COVER_URL.format(appid=appid),
            'genres': details.get('genres', []),
            'release': details.get('release'),
            'developers': details.get('developers', []),
            'steam_score_desc': details.get('steam_score_desc'),
            'steam_positive_pct': details.get('steam_positive_pct'),
            'steam_total_reviews': details.get('steam_total_reviews'),
        },
        'community_avg': community_avg,
        'community_count': community_count,
        'user_status': user_status,
        'status_counts': counts,
        'reviews': reviews,
    })


@social_bp.route('/api/game/<appid>/status', methods=['POST'])
@login_required
def set_game_status(appid):
    user_id = uid()
    appid = clamp_text(appid, 20)
    if not appid:
        return jsonify({'status': 'error', 'message': 'Jogo inválido'}), 400

    d = request.get_json() or {}
    status = clamp_text(d.get('status'), 30)
    if status not in GAME_STATUSES:
        return jsonify({'status': 'error', 'message': 'Status inválido'}), 400

    game_name = clamp_text(d.get('game_name'), 255)
    platform = clamp_text(d.get('platform'), 30) or 'steam'
    started_at = _parse_date(d.get('started_at'))
    try:
        replay_count = max(0, min(int(d.get('replay_count', 0) or 0), 99))
    except (TypeError, ValueError):
        replay_count = 0

    conn = get_connection()
    cur = conn.cursor()
    platinum = (status == 'platinado') or _is_platinum(cur, user_id, appid)
    cur.execute(
        "INSERT INTO game_status "
        "(user_id, appid, game_name, platform, status, started_at, replay_count, platinum, updated_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW()) "
        "ON CONFLICT (user_id, appid) DO UPDATE SET "
        "  status=EXCLUDED.status, game_name=COALESCE(EXCLUDED.game_name, game_status.game_name), "
        "  platform=EXCLUDED.platform, "
        "  started_at=COALESCE(EXCLUDED.started_at, game_status.started_at), "
        "  replay_count=EXCLUDED.replay_count, platinum=EXCLUDED.platinum, updated_at=NOW()",
        (user_id, appid, game_name, platform, status, started_at, replay_count, platinum)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'platinum': platinum})
