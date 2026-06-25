import os
import requests
from flask import Blueprint, jsonify, session
from database import get_connection

game_bp = Blueprint('game', __name__)

STEAM_API  = 'https://api.steampowered.com'
STEAM_STORE = 'https://store.steampowered.com/api'


def get_steam_creds():
    user_id = session.get('user_id')
    if user_id:
        try:
            conn = get_connection()
            cur  = conn.cursor()
            cur.execute("SELECT steam_id, steam_api_key FROM users WHERE id = %s", (user_id,))
            row  = cur.fetchone()
            cur.close(); conn.close()
            if row and row.get('steam_id') and row.get('steam_api_key'):
                return row['steam_id'], row['steam_api_key']
        except Exception:
            pass
    return os.getenv('STEAM_ID'), os.getenv('STEAM_API_KEY')


@game_bp.route('/api/game/<appid>')
def get_game(appid):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'status': 'error', 'message': 'Não autenticado.'}), 401

    steam_id, api_key = get_steam_creds()

    try:
        # ── Detalhes do jogo (Steam Store API) ──
        store_res = requests.get(
            f'{STEAM_STORE}/appdetails',
            params={'appids': appid, 'l': 'portuguese'},
            timeout=10
        )
        store_data = store_res.json().get(str(appid), {}).get('data', {})

        # ── Conquistas do jogador ──
        achievements = []
        platinum     = False
        played_minutes = 0

        if steam_id and api_key:
            try:
                ach_res  = requests.get(
                    f'{STEAM_API}/ISteamUserStats/GetPlayerAchievements/v1/',
                    params={'key': api_key, 'steamid': steam_id,
                            'appid': appid, 'l': 'portuguese'},
                    timeout=10
                )
                ach_data     = ach_res.json().get('playerstats', {})
                achievements = ach_data.get('achievements', [])

                if achievements:
                    total     = len(achievements)
                    desbloq   = sum(1 for a in achievements if a.get('achieved'))
                    platinum  = (total > 0 and desbloq == total)
            except Exception:
                pass

            # Tempo de jogo
            try:
                owned_res = requests.get(
                    f'{STEAM_API}/IPlayerService/GetOwnedGames/v1/',
                    params={'key': api_key, 'steamid': steam_id,
                            'include_appinfo': False},
                    timeout=10
                )
                owned = owned_res.json().get('response', {}).get('games', [])
                jogo  = next((g for g in owned if str(g.get('appid')) == str(appid)), None)
                if jogo:
                    played_minutes = jogo.get('playtime_forever', 0)
            except Exception:
                pass

        # ── Status do usuário no banco ──
        user_status = {
            'status': None, 'started_at': None,
            'replay_count': 0, 'platinum': platinum,
            'played': played_minutes > 0,
            'played_minutes': played_minutes
        }
        status_counts = {}
        reviews       = []
        community_avg = None
        community_count = 0

        try:
            conn = get_connection()
            cur  = conn.cursor()

            # Status deste usuário
            cur.execute("""
                SELECT status, started_at, replay_count, platinum
                FROM user_game_status
                WHERE user_id = %s AND appid = %s
            """, (user_id, str(appid)))
            row = cur.fetchone()
            if row:
                user_status.update({
                    'status':       row['status'],
                    'started_at':   str(row['started_at']) if row['started_at'] else None,
                    'replay_count': row['replay_count'] or 0,
                    'platinum':     row['platinum'] or platinum
                })

            # Contagem de status de todos os usuários
            cur.execute("""
                SELECT status, COUNT(*) as total
                FROM user_game_status WHERE appid = %s
                GROUP BY status
            """, (str(appid),))
            for r in cur.fetchall():
                status_counts[r['status']] = r['total']

            # Reviews
            cur.execute("""
                SELECT r.id, r.rating, r.content, r.status, r.platform,
                       r.started_at, r.spoilers, r.replay, r.platinum,
                       r.created_at,
                       u.name as author, u.avatar_url as avatar,
                       (SELECT COUNT(*) FROM review_likes WHERE review_id = r.id) as likes,
                       EXISTS(
                           SELECT 1 FROM review_likes
                           WHERE review_id = r.id AND user_id = %s
                       ) as liked,
                       r.user_id = %s as is_mine
                FROM reviews r
                JOIN users u ON u.id = r.user_id
                WHERE r.appid = %s
                ORDER BY r.created_at DESC
                LIMIT 20
            """, (user_id, user_id, str(appid)))

            for r in cur.fetchall():
                reviews.append({
                    'id':         r['id'],
                    'rating':     r['rating'],
                    'content':    r['content'],
                    'status':     r['status'],
                    'platform':   r['platform'],
                    'started_at': str(r['started_at']) if r['started_at'] else None,
                    'spoilers':   r['spoilers'],
                    'replay':     r['replay'],
                    'platinum':   r['platinum'],
                    'author':     r['author'],
                    'avatar':     r['avatar'],
                    'likes':      r['likes'],
                    'liked':      r['liked'],
                    'is_mine':    r['is_mine'],
                    'time':       r['created_at'].strftime('%d/%m/%Y') if r['created_at'] else ''
                })

            # Média da comunidade
            cur.execute("""
                SELECT AVG(rating) as avg, COUNT(*) as total
                FROM reviews WHERE appid = %s AND rating IS NOT NULL
            """, (str(appid),))
            avg_row = cur.fetchone()
            if avg_row and avg_row['total'] > 0:
                community_avg   = float(avg_row['avg'])
                community_count = avg_row['total']

            cur.close(); conn.close()
        except Exception as e:
            print(f'[Game API] Erro banco: {e}')

        # ── Monta objeto do jogo ──
        patch = '14.10.1'
        game  = {
            'appid':       appid,
            'name':        store_data.get('name', 'Jogo ' + str(appid)),
            'description': store_data.get('short_description', ''),
            'genres':      [g['description'] for g in store_data.get('genres', [])],
            'developers':  store_data.get('developers', []),
            'release':     store_data.get('release_date', {}).get('date', ''),
            'cover':       f'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg',
            'header':      f'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg',
            'steam_positive_pct':  None,
            'steam_score_desc':    None,
        }

        # Score Steam
        if 'metacritic' in store_data:
            pass  # poderia usar metacritic
        rdata = store_data.get('recommendations', {})
        total_reviews = rdata.get('total', 0)

        return jsonify({
            'status':          'success',
            'game':            game,
            'user_status':     user_status,
            'status_counts':   status_counts,
            'reviews':         reviews,
            'achievements':    achievements,
            'community_avg':   community_avg,
            'community_count': community_count
        })

    except Exception as e:
        print(f'[Game API] Erro: {e}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@game_bp.route('/api/game/<appid>/status', methods=['POST'])
def set_status(appid):
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'status': 'error', 'message': 'Não autenticado.'}), 401

    data    = request.json or {}
    status  = data.get('status')
    started = data.get('started_at')
    replay  = data.get('replay_count', 0)

    try:
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("""
            INSERT INTO user_game_status
                (user_id, appid, game_name, status, started_at, replay_count, platinum)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, appid) DO UPDATE
            SET status       = EXCLUDED.status,
                started_at   = EXCLUDED.started_at,
                replay_count = EXCLUDED.replay_count,
                updated_at   = NOW()
        """, (
            user_id, str(appid),
            data.get('game_name', ''),
            status, started or None, replay, False
        ))
        conn.commit()
        cur.close(); conn.close()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
