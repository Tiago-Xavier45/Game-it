import os
import requests
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, session, request
from psycopg.types.json import Json
from database import get_connection
from security import login_required, current_user_id

steam_bp = Blueprint('steam', __name__)

STEAM_API = 'https://api.steampowered.com'

# Sincroniza automaticamente se o cache for mais antigo que isto
SYNC_TTL = timedelta(hours=2)


def get_key():
    return os.getenv('STEAM_API_KEY')


def get_steamid():
    return os.getenv('STEAM_ID')


def get_user_id():
    """ID do usuário autenticado (as rotas usam @login_required)."""
    return current_user_id()


# ── Busca a biblioteca completa direto na Steam ─────────
def fetch_games_from_steam():
    """Retorna (games, erro). games = lista de dicts; erro = str ou None."""
    key     = get_key()
    steamid = get_steamid()

    if not key or not steamid:
        return [], 'STEAM_API_KEY ou STEAM_ID não configurado no .env'

    url_games = (
        f'{STEAM_API}/IPlayerService/GetOwnedGames/v1/'
        f'?key={key}&steamid={steamid}'
        f'&include_appinfo=true&include_played_free_games=true'
    )
    try:
        r     = requests.get(url_games, timeout=10)
        games = r.json().get('response', {}).get('games', [])
    except Exception as e:
        return [], str(e)

    resultado = []
    for g in games:
        appid = g.get('appid')
        name  = g.get('name', 'Jogo Desconhecido')

        if not g.get('has_community_visible_stats'):
            resultado.append({
                'appid': appid, 'name': name, 'status': 'Sem Conquistas',
                'pct': 0.0, 'achievements': [],
                'playtime_forever': g.get('playtime_forever', 0)
            })
            continue

        url_ach = (
            f'{STEAM_API}/ISteamUserStats/GetPlayerAchievements/v1/'
            f'?key={key}&steamid={steamid}&appid={appid}&l=portuguese'
        )
        try:
            ra    = requests.get(url_ach, timeout=8)
            stats = ra.json().get('playerstats', {})
            achs  = stats.get('achievements', [])

            if not achs:
                status, pct = 'Sem Conquistas', 0.0
            else:
                total   = len(achs)
                desbloq = sum(1 for a in achs if a.get('achieved') == 1)
                pct     = (desbloq / total * 100) if total > 0 else 0.0
                if pct >= 100:
                    status = '100%'
                elif pct > 0:
                    status = 'Em Progresso'
                else:
                    status = 'Sem Conquistas'
        except Exception:
            achs, status, pct = [], 'Sem Conquistas', 0.0

        resultado.append({
            'appid': appid, 'name': name, 'status': status,
            'pct': round(pct, 2), 'achievements': achs,
            'playtime_forever': g.get('playtime_forever', 0)
        })

    resultado.sort(key=lambda x: x['pct'], reverse=True)
    return resultado, None


# ── Persistência no banco ───────────────────────────────
def save_games_to_db(user_id, games):
    conn = get_connection()
    cur  = conn.cursor()
    for g in games:
        cur.execute(
            """
            INSERT INTO user_games
                (user_id, appid, name, playtime_forever, status, pct, achievements, last_synced)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (user_id, appid) DO UPDATE SET
                name             = EXCLUDED.name,
                playtime_forever = EXCLUDED.playtime_forever,
                status           = EXCLUDED.status,
                pct              = EXCLUDED.pct,
                achievements     = EXCLUDED.achievements,
                last_synced      = NOW()
            """,
            (user_id, str(g['appid']), g['name'], g.get('playtime_forever', 0),
             g['status'], g['pct'], Json(g['achievements']))
        )
    cur.execute(
        """
        INSERT INTO sync_status (user_id, last_synced)
        VALUES (%s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET last_synced = NOW()
        """,
        (user_id,)
    )
    conn.commit()
    cur.close()
    conn.close()


def load_games_from_db(user_id):
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        """
        SELECT appid, name, status, pct, achievements
        FROM user_games WHERE user_id = %s
        ORDER BY pct DESC
        """,
        (user_id,)
    )
    rows = cur.fetchall()
    cur.execute("SELECT last_synced FROM sync_status WHERE user_id = %s", (user_id,))
    sync_row = cur.fetchone()
    cur.close()
    conn.close()

    games = []
    for r in rows:
        try:
            appid = int(r['appid'])
        except (TypeError, ValueError):
            appid = r['appid']
        games.append({
            'appid':        appid,
            'name':         r['name'],
            'status':       r['status'],
            'pct':          float(r['pct'] or 0),
            'achievements': r['achievements'] or []
        })

    last_synced = sync_row['last_synced'] if sync_row else None
    return games, last_synced


def cache_is_stale(last_synced):
    if last_synced is None:
        return True
    return datetime.now() - last_synced > SYNC_TTL


# ── Rota principal: lê do cache (DB) ────────────────────
@steam_bp.route('/api/steam-data')
@login_required
def steam_data():
    user_id = get_user_id()
    games, last_synced = load_games_from_db(user_id)

    # Sincroniza automaticamente se vazio ou desatualizado (>2h)
    if not games or cache_is_stale(last_synced):
        fresh, erro = fetch_games_from_steam()
        if erro and not games:
            return jsonify({'status': 'error', 'message': erro})
        if fresh:
            save_games_to_db(user_id, fresh)
            games, last_synced = load_games_from_db(user_id)

    return jsonify({
        'status':      'success',
        'games':       games,
        'last_synced': last_synced.isoformat() if last_synced else None,
        'cached':      True
    })


# ── Sincronização manual (força busca na Steam) ─────────
@steam_bp.route('/api/steam-sync', methods=['POST'])
@login_required
def steam_sync():
    user_id = get_user_id()
    games, erro = fetch_games_from_steam()
    if erro:
        return jsonify({'status': 'error', 'message': erro})

    save_games_to_db(user_id, games)
    return jsonify({
        'status':  'success',
        'message': f'{len(games)} jogos sincronizados com a Steam.',
        'count':   len(games)
    })


# ── Info de sincronização ───────────────────────────────
@steam_bp.route('/api/steam/sync-info')
@login_required
def sync_info():
    _, last_synced = load_games_from_db(get_user_id())
    return jsonify({
        'status':      'success',
        'last_synced': last_synced.isoformat() if last_synced else None,
        'stale':       cache_is_stale(last_synced)
    })



# ── Rotas auxiliares ────────────────────────────────────
@steam_bp.route('/api/steam/user')
@login_required
def get_user():
    key     = get_key()
    steamid = get_steamid()
    url     = f'{STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key={key}&steamids={steamid}'
    r       = requests.get(url, timeout=10)
    players = r.json().get('response', {}).get('players', [])
    if not players:
        return jsonify({'status': 'error', 'message': 'Usuário não encontrado'})
    return jsonify({'status': 'success', 'player': players[0]})


# ── Jogados recentemente (últimas sessões) ──────────────
@steam_bp.route('/api/steam/recent')
@login_required
def recent_games():
    key     = get_key()
    steamid = get_steamid()

    try:
        count = int(request.args.get('count', 3))
    except (TypeError, ValueError):
        count = 3
    count = max(1, min(count, 12))

    if not key or not steamid:
        return jsonify({'status': 'error', 'message': 'STEAM_API_KEY ou STEAM_ID não configurado no .env'})

    url = (
        f'{STEAM_API}/IPlayerService/GetRecentlyPlayedGames/v1/'
        f'?key={key}&steamid={steamid}&count={count}'
    )
    try:
        r     = requests.get(url, timeout=10)
        games = r.json().get('response', {}).get('games', [])
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})

    resultado = []
    for g in games:
        appid = g.get('appid')
        achs_done  = 0
        achs_total = 0
        try:
            url_ach = (
                f'{STEAM_API}/ISteamUserStats/GetPlayerAchievements/v1/'
                f'?key={key}&steamid={steamid}&appid={appid}&l=portuguese'
            )
            stats = requests.get(url_ach, timeout=8).json().get('playerstats', {})
            achs  = stats.get('achievements', [])
            achs_total = len(achs)
            achs_done  = sum(1 for a in achs if a.get('achieved') == 1)
        except Exception:
            pass

        resultado.append({
            'appid':        appid,
            'name':         g.get('name', 'Jogo Desconhecido'),
            'platform':     'steam',
            'img':          (
                f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"
            ),
            'playtime_forever': g.get('playtime_forever', 0),
            'playtime_2weeks':  g.get('playtime_2weeks', 0),
            'ach_done':         achs_done,
            'ach_total':        achs_total,
        })

    return jsonify({'status': 'success', 'games': resultado})


# ── Amigos da Steam ─────────────────────────────────────
@steam_bp.route('/api/steam/friends')
@login_required
def steam_friends():
    key     = get_key()
    steamid = get_steamid()
    if not key or not steamid:
        return jsonify({'status': 'error', 'message': 'Steam não configurado', 'friends': []})

    try:
        url = (f'{STEAM_API}/ISteamUser/GetFriendList/v1/'
               f'?key={key}&steamid={steamid}&relationship=friend')
        flist = requests.get(url, timeout=8).json().get('friendslist', {}).get('friends', [])
    except Exception:
        # Lista de amigos privada ou erro
        return jsonify({'status': 'success', 'friends': []})

    ids = [f.get('steamid') for f in flist[:12] if f.get('steamid')]
    if not ids:
        return jsonify({'status': 'success', 'friends': []})

    try:
        url_sum = (f'{STEAM_API}/ISteamUser/GetPlayerSummaries/v2/'
                   f'?key={key}&steamids={",".join(ids)}')
        players = requests.get(url_sum, timeout=8).json().get('response', {}).get('players', [])
    except Exception:
        return jsonify({'status': 'success', 'friends': []})

    friends = []
    for p in players:
        online = p.get('personastate', 0) != 0
        friends.append({
            'name':    p.get('personaname', 'Amigo'),
            'avatar':  p.get('avatarfull') or p.get('avatar'),
            'online':  online,
            'playing': p.get('gameextrainfo')  # nome do jogo se estiver jogando
        })
    # Online primeiro
    friends.sort(key=lambda f: (not f['online'], not f['playing']))
    return jsonify({'status': 'success', 'friends': friends})


# ── Biblioteca resumida (p/ seletor de favoritos) ───────
@steam_bp.route('/api/steam/library')
@login_required
def steam_library():
    user_id = get_user_id()
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "SELECT appid, name, playtime_forever, status, pct FROM user_games WHERE user_id=%s ORDER BY name ASC",
        (user_id,)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    jogos = [{
        'appid': r['appid'],
        'name':  r['name'],
        'platform': 'steam',
        'playtime_forever': r.get('playtime_forever', 0) or 0,
        'status': r.get('status') or 'Sem Conquistas',
        'pct': float(r.get('pct') or 0),
        'cover': f"https://cdn.cloudflare.steamstatic.com/steam/apps/{r['appid']}/library_600x900.jpg",
        'header': f"https://cdn.cloudflare.steamstatic.com/steam/apps/{r['appid']}/header.jpg"
    } for r in rows]
    return jsonify({'status': 'success', 'games': jogos})

