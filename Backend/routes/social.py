import os
import re
import uuid
import requests
from collections import Counter
from datetime import datetime
from flask import Blueprint, request, jsonify, session, current_app
from psycopg.types.json import Json
from database import get_connection

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


# ── Helpers ─────────────────────────────────────────────
def uid():
    return session.get('user_id', 1)


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
def update_profile():
    user_id = uid()
    d = request.get_json() or {}

    fields = {}
    if 'nickname' in d:   fields['display_name'] = (d['nickname'] or '').strip()[:255] or None
    if 'bio' in d:        fields['bio'] = (d['bio'] or '').strip()[:500]
    if 'avatar' in d:     fields['avatar_url'] = d['avatar'] or None
    if 'cover' in d:      fields['cover_url'] = d['cover'] or None

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
def upload_image():
    """Recebe um arquivo (avatar ou cover) e salva em static/uploads."""
    user_id = uid()
    tipo = request.args.get('type', 'avatar')
    if tipo not in ('avatar', 'cover'):
        return jsonify({'status': 'error', 'message': 'Tipo inválido'}), 400

    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'Nenhum arquivo enviado'}), 400

    f = request.files['file']
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
        return jsonify({'status': 'error', 'message': 'Formato não suportado'}), 400

    uploads_dir = os.path.join(current_app.static_folder, 'uploads')
    os.makedirs(uploads_dir, exist_ok=True)

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
def create_post():
    user_id = uid()
    d = request.get_json() or {}
    content = (d.get('content') or '').strip()
    if not content:
        return jsonify({'status': 'error', 'message': 'Escreva algo para postar.'}), 400

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO posts (user_id, content) VALUES (%s, %s) RETURNING id",
        (user_id, content[:1000])
    )
    pid = cur.fetchone()['id']
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'id': pid})


@social_bp.route('/api/posts/<int:post_id>', methods=['DELETE'])
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
def list_reviews():
    user_id = uid()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, appid, game_name, rating, content, created_at "
        "FROM reviews WHERE user_id=%s ORDER BY created_at DESC",
        (user_id,)
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
        'time': _humaniza(r['created_at']),
        'cover': HEADER_URL.format(appid=r['appid']) if r['appid'] else None
    } for r in rows]
    return jsonify({'status': 'success', 'reviews': reviews})


@social_bp.route('/api/reviews', methods=['POST'])
def create_review():
    user_id = uid()
    d = request.get_json() or {}
    rating = int(d.get('rating', 0))
    if rating < 1 or rating > 5:
        return jsonify({'status': 'error', 'message': 'Nota deve ser entre 1 e 5'}), 400

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO reviews (user_id, appid, game_name, rating, content) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (user_id, str(d.get('appid') or ''), d.get('game_name', ''),
         rating, (d.get('content') or '')[:1000])
    )
    rid = cur.fetchone()['id']
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'id': rid})


@social_bp.route('/api/reviews/ratings')
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

