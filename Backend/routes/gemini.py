import os
import time
from google import genai
from flask import Blueprint, request, jsonify, session
from security import login_required

gemini_bp  = Blueprint('gemini', __name__)
MODELO     = 'gemini-2.0-flash'
MODELO_BCK = 'gemini-2.0-flash-lite'   # ← backup atualizado
MAX_TENT   = 2
ESPERA     = 10


def get_api_key():
    user_id = session.get('user_id')
    if user_id:
        try:
            from database import get_connection
            conn = get_connection()
            cur  = conn.cursor()
            cur.execute("SELECT gemini_api_key FROM users WHERE id = %s", (user_id,))
            row  = cur.fetchone()
            cur.close(); conn.close()
            if row and row.get('gemini_api_key'):
                return row['gemini_api_key']
        except Exception:
            pass
    return os.getenv('GEMINI_API_KEY')


def chamar_gemini(prompt, modelo=None):
    modelo  = modelo or MODELO
    api_key = get_api_key()

    if not api_key:
        return None, 'API Key não configurada. Acesse ⚙️ Configurações e adicione sua Gemini API Key.'

    client = genai.Client(api_key=api_key)

    for tent in range(1, MAX_TENT + 1):
        try:
            print(f"[Gemini] Tentativa {tent}/{MAX_TENT} — modelo: {modelo}")
            resp = client.models.generate_content(model=modelo, contents=prompt)
            return resp.text, None

        except Exception as e:
            err = str(e)
            print(f"[Gemini] Erro (tentativa {tent}): {err[:120]}")

            if '429' in err:
                if tent < MAX_TENT:
                    print(f"[Gemini] Rate limit — aguardando {ESPERA}s...")
                    time.sleep(ESPERA)
                elif modelo == MODELO:
                    print(f"[Gemini] Tentando modelo backup: {MODELO_BCK}")
                    return chamar_gemini(prompt, MODELO_BCK)
                else:
                    return None, (
                        'Cota da API esgotada. '
                        'Adicione sua própria Gemini API Key em ⚙️ Configurações.'
                    )
            elif '404' in err:
                return None, f'Modelo {modelo} não disponível. Tente novamente em instantes.'
            else:
                return None, err

    return None, 'Falha após todas as tentativas.'


@gemini_bp.route('/api/analisar-jogo', methods=['POST'])
@login_required
def analisar_jogo():
    data       = request.json or {}
    appid      = str(data.get('appid', ''))
    nome       = data.get('nome', '')
    conquistas = data.get('conquistas', [])
    regen      = request.args.get('regen') == '1'

    if not appid:
        return jsonify({'status': 'error', 'message': 'appid obrigatório'})

    if not regen:
        try:
            from database import get_connection
            conn = get_connection()
            cur  = conn.cursor()
            cur.execute("SELECT html_content FROM guide_cache WHERE appid = %s", (appid,))
            row  = cur.fetchone()
            cur.close(); conn.close()
            if row:
                return jsonify({'status': 'success', 'html': row['html_content'], 'from_cache': True})
        except Exception:
            pass

    bloqueadas = [c for c in conquistas if c.get('achieved') == 0]
    lista_txt  = '\n'.join(
        f"- {c.get('name', c.get('apiname','?'))}: {c.get('description','Sem descrição')}"
        for c in bloqueadas[:30]
    ) or 'Sem conquistas bloqueadas.'

    prompt = f"""
Você é especialista em conquistas/troféus de jogos. Analise "{nome}".
Conquistas não desbloqueadas:
{lista_txt}

Gere um guia de platina em HTML (apenas conteúdo interno, sem html/body/head).
Use h3, p, ul, li, strong. Inclua:
1. Dificuldade (1-10) e tempo estimado
2. Dicas gerais
3. Estratégia para conquistas difíceis
4. Ordem recomendada
Responda em português brasileiro.
"""

    texto, erro = chamar_gemini(prompt)
    if erro:
        return jsonify({'status': 'error', 'message': erro})

    try:
        from database import get_connection
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("""
            INSERT INTO guide_cache (appid, game_name, html_content)
            VALUES (%s, %s, %s)
            ON CONFLICT (appid) DO UPDATE
            SET html_content = EXCLUDED.html_content, updated_at = NOW()
        """, (appid, nome, texto))
        conn.commit()
        cur.close(); conn.close()
    except Exception:
        pass

    return jsonify({'status': 'success', 'html': texto, 'from_cache': False})
