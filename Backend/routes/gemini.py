import os
import time
from google import genai
from flask import Blueprint, request, jsonify, session
from security import login_required

gemini_bp  = Blueprint('gemini', __name__)
MODELO     = 'gemini-2.5-flash'
MODELO_BCK = 'gemini-2.5-flash-lite'   # ← Backup estratégico contra congestionamento
MAX_TENT   = 2
ESPERA     = 20                        # ← Tempo estendido para reset de cota por minuto


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
            
            if row:
                # Resolve compatibilidade caso o cursor retorne uma tupla ou dicionário
                api_key = row.get('gemini_api_key') if isinstance(row, dict) else row[0]
                if api_key:
                    return api_key
        except Exception as e:
            print(f"[Gemini] Falha ao ler chave da tabela de usuários: {e}")
            pass
    return os.getenv('GEMINI_API_KEY')


def chamar_gemini(prompt, modelo=None, tentativa_backup=False):
    modelo  = modelo or MODELO
    api_key = get_api_key()

    if not api_key:
        return None, 'API Key não configurada. Acesse ⚙️ Configurações e adicione sua Gemini API Key.'

    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        return None, f"Erro ao instanciar o cliente do Gemini: {str(e)}"

    for tent in range(1, MAX_TENT + 1):
        try:
            print(f"[Gemini] Tentativa {tent}/{MAX_TENT} — modelo: {modelo}")
            resp = client.models.generate_content(model=modelo, contents=prompt)
            return resp.text, None

        except Exception as e:
            err = str(e)
            print(f"[Gemini] Erro (tentativa {tent}): {err[:120]}")

            # 🛠️ Interceptor para Erro 503 (Servidores Sobregregados / High Demand)
            if '503' in err:
                if modelo == MODELO and not tentativa_backup:
                    print(f"[Gemini] Servidor principal congestionado (503). Chaveando para backup: {MODELO_BCK}")
                    return chamar_gemini(prompt, MODELO_BCK, tentativa_backup=True)
                else:
                    if tent < MAX_TENT:
                        print(f"[Gemini] Instabilidade temporária — aguardando {ESPERA}s...")
                        time.sleep(ESPERA)
                    else:
                        return None, 'Os servidores da IA estão instáveis no momento. Tente novamente em instantes.'

            # 🛠️ Interceptor para Erro 429 (Cota estourada)
            elif '429' in err:
                if tent < MAX_TENT:
                    print(f"[Gemini] Rate limit — aguardando {ESPERA}s...")
                    time.sleep(ESPERA)
                elif modelo == MODELO and not tentativa_backup:
                    print(f"[Gemini] Cota máxima atingida no principal. Tentando modelo backup: {MODELO_BCK}")
                    return chamar_gemini(prompt, MODELO_BCK, tentativa_backup=True)
                else:
                    return None, (
                        'Cota da API esgotada. '
                        'Adicione sua própria Gemini API Key em ⚙️ Configurações.'
                    )
            elif '404' in err:
                return None, f'Modelo {modelo} não disponível. Verifique o identificador do modelo.'
            else:
                return None, err

    return None, 'Falha após todas as tentativas.'


# ═══════════════════════════════════════════════════════
#  CACHE DE GUIAS — evita chamar o Gemini repetidamente
# ═══════════════════════════════════════════════════════
def buscar_guia_cache(appid):
    """Retorna o HTML do guia salvo no banco (ou None se não existir)."""
    try:
        from database import get_connection
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("SELECT html_content FROM guide_cache WHERE appid = %s", (appid,))
        row  = cur.fetchone()
        cur.close(); conn.close()
        if row:
            html_content = row.get('html_content') if isinstance(row, dict) else row[0]
            if html_content:
                print(f"[Guia] Cache HIT para appid {appid}")
                return html_content
        print(f"[Guia] Cache MISS para appid {appid}")
    except Exception as e:
        print(f"[Guia] Falha ao LER cache (appid {appid}): {e}")
    return None


def salvar_guia_cache(appid, nome, texto):
    """Persiste o guia gerado no banco para reaproveitamento futuro."""
    try:
        from database import get_connection
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("""
            INSERT INTO guide_cache (appid, game_name, html_content)
            VALUES (%s, %s, %s)
            ON CONFLICT (appid) DO UPDATE
            SET html_content = EXCLUDED.html_content,
                game_name    = EXCLUDED.game_name,
                updated_at   = NOW()
        """, (appid, nome, texto))
        conn.commit()
        cur.close(); conn.close()
        print(f"[Guia] Guia salvo no cache (appid {appid})")
        return True
    except Exception as e:
        print(f"[Guia] Falha ao SALVAR cache (appid {appid}): {e}")
        return False


def _barra_progresso_html(pct, n_unlocked, total, n_locked):
    """Cabeçalho visual com o progresso real de conquistas do jogador."""
    return (
        '<div class="guia-progress">'
        '<div class="guia-progress-top">'
        '<span class="guia-progress-label"><i class="fa-solid fa-trophy"></i> Progresso de Conquistas</span>'
        f'<span class="guia-progress-pct">{pct:.0f}%</span>'
        '</div>'
        '<div class="guia-progress-track">'
        f'<div class="guia-progress-fill" style="width:{min(pct, 100):.0f}%;"></div>'
        '</div>'
        '<div class="guia-stats">'
        f'<div class="guia-stat"><span class="guia-stat-num">{n_unlocked}/{total}</span>'
        '<span class="guia-stat-lbl">Desbloqueadas</span></div>'
        f'<div class="guia-stat"><span class="guia-stat-num">{n_locked}</span>'
        '<span class="guia-stat-lbl">Faltam</span></div>'
        f'<div class="guia-stat"><span class="guia-stat-num">{pct:.0f}%</span>'
        '<span class="guia-stat-lbl">Completo</span></div>'
        '</div>'
        '</div>'
    )


@gemini_bp.route('/api/analisar-jogo', methods=['POST'])
@login_required
def analisar_jogo():
    data       = request.json or {}
    appid      = str(data.get('appid', ''))
    nome       = data.get('nome', '')
    conquistas = data.get('conquistas', [])
    status     = data.get('status', '')
    pct_in     = data.get('pct')
    regen      = request.args.get('regen') == '1'
    force      = request.args.get('force') == '1'

    if not appid:
        return jsonify({'status': 'error', 'message': 'appid obrigatório'})

    total         = len(conquistas)
    desbloqueadas = [c for c in conquistas if c.get('achieved') == 1]
    bloqueadas    = [c for c in conquistas if c.get('achieved') == 0]
    n_unlocked    = len(desbloqueadas)
    n_locked      = len(bloqueadas)

    if total > 0:
        pct_real = round(n_unlocked / total * 100, 1)
    else:
        try:
            pct_real = round(float(pct_in), 1)
        except (TypeError, ValueError):
            pct_real = 0.0

    completo = (status == '100%') or (total > 0 and n_locked == 0) or pct_real >= 100

    if completo and not force:
        barra = _barra_progresso_html(100, n_unlocked or total, total or n_unlocked, 0) if total else ''
        return jsonify({
            'status':   'success',
            'completo': True,
            'pct':      100,
            'html': (
                barra
                + '<div class="guia-done">'
                  '<div class="guia-done-ico"><i class="fa-solid fa-trophy"></i></div>'
                  f'<h3 class="guia-done-title">"{nome}" já está 100% completo!</h3>'
                  '<p class="guia-done-sub">Você desbloqueou todas as conquistas deste jogo. '
                  'Não há mais nada para platinar aqui — mandou bem! 🎉</p>'
                  '<p class="guia-done-hint">Quer que eu gere um guia bônus mesmo assim, com dicas de '
                  'replay, curiosidades e jogos parecidos para o próximo desafio?</p>'
                  '</div>'
            )
        })

    if not regen and not force:
        cached = buscar_guia_cache(appid)
        if cached:
            return jsonify({'status': 'success', 'html': cached, 'from_cache': True})

    if completo:
        prompt = f"""
O jogador JÁ COMPLETOU 100% de "{nome}" (todas as conquistas desbloqueadas). Parabenize-o.

Gere um conteúdo comemorativo e útil em HTML (apenas conteúdo interno, SEM html/head/body).
Use <h3> com um emoji no início de cada seção, <p>, <ul>, <li> e <strong>. Estrutura:

<h3>🏆 Missão Cumprida</h3>
<p>Parabenize o jogador e comente brevemente o feito de ter 100% em "{nome}".</p>

<h3>🔁 Vale a Pena Rejogar?</h3>
<p>Dicas de replay, New Game+, dificuldades extras ou modos secretos.</p>

<h3>🎮 Próximos Desafios</h3>
<ul><li><strong>Nome do jogo:</strong> por que combina com quem gostou de "{nome}".</li> ... (4 a 6 sugestões)</ul>

<h3>💡 Curiosidades</h3>
<ul><li>curiosidades legais sobre o jogo.</li></ul>

Responda em português brasileiro, com tom empolgado e gamer.
"""
    else:
        bloq_txt = '\n'.join(
            f"- {c.get('name', c.get('apiname','?'))}: {c.get('description') or 'Sem descrição (conquista secreta)'}"
            for c in bloqueadas[:40]
        ) or 'Não há dados das conquistas que faltam.'

        desbloq_txt = ', '.join(
            c.get('name', c.get('apiname', '?')) for c in desbloqueadas[:30]
        ) or 'Nenhuma ainda.'

        if total > 0:
            contexto_progresso = (
                f"O jogador já está em {pct_real}% — desbloqueou {n_unlocked} de {total} "
                f"conquistas e ainda faltam {n_locked}."
            )
            foco = (
                f"FOQUE o guia APENAS nas {n_locked} conquistas que ainda faltam (listadas abaixo). "
                "NÃO explique as que ele já tem."
            )
        else:
            contexto_progresso = "Não há dados detalhados das conquistas deste jogo."
            foco = "Faça um guia geral de platina/100% para o jogo."

        prompt = f"""
Você é um especialista em conquistas/troféus (platina) de videogames.
Analise o jogo "{nome}" com base no PROGRESSO REAL do jogador.

{contexto_progresso}
Conquistas já desbloqueadas (apenas referência do nível dele): {desbloq_txt}

Conquistas que AINDA FALTAM (foco do guia):
{bloq_txt}

{foco}

Gere um guia PERSONALIZADO em HTML (apenas conteúdo interno, SEM html/head/body).
Use <h3> com um emoji no início de cada seção, <p>, <ul>, <li> e <strong>. Estrutura:

<h3>📊 Visão Geral</h3>
<p>Resumo do que falta, dificuldade geral (nota de 1 a 10) e tempo estimado para chegar aos 100%, considerando que ele já está em {pct_real}%. Se o guia contiver SPOILERS da história, comece esta seção com <strong>⚠️ Atenção: este guia contém spoilers.</strong>; caso contrário, escreva <strong>✅ Este guia não contém spoilers da história.</strong></p>

<h3>⏳ Conquistas Perdíveis (Missables)</h3>
<p>Liste TODAS as conquistas que faltam e que são <strong>perdíveis</strong> (que podem ser perdidas permanentemente se você passar de um ponto, fizer uma escolha, ou não fizer algo num momento específico). Para cada uma, deixe MUITO CLARO o que precisa ser feito e em qual momento/capítulo, para o jogador não perder. Se nenhuma das que faltam for perdível, escreva "Nenhuma conquista que falta é perdível — todas podem ser feitas a qualquer momento.".</p>
<ul><li><strong>Nome da conquista (Perdível):</strong> exatamente o que fazer, quando fazer e o ponto de não retorno.</li> ...</ul>

<h3>🎯 Conquistas que Faltam</h3>
<ul><li><strong>Nome da conquista:</strong> dica objetiva e prática, deixando claro o passo a passo do que precisa ser feito para consegui-la.</li> ...</ul>

<h3>🌐 Conquistas Online</h3>
<p>Identifique entre as conquistas que faltam quais são <strong>online/multiplayer</strong> (exigem servidores ativos, outros jogadores, co-op ou modo competitivo). Liste cada uma e avise sobre o risco de servidores desligados. Se nenhuma das que faltam for online, escreva "Nenhuma conquista que falta é online — todas podem ser feitas offline.".</p>
<ul><li><strong>Nome da conquista (Online):</strong> o que precisa para conseguir e dica para facilitar (ex.: boost com amigos).</li> ...</ul>

<h3>🧠 Estratégia Recomendada</h3>
<p>Melhor ordem para pegar o que falta e como lidar com as conquistas mais difíceis. Priorize alertar sobre as perdíveis primeiro e recomende fazer as conquistas online enquanto os servidores ainda estão ativos.</p>

<h3>⚡ Dicas Rápidas</h3>
<ul><li>dicas curtas e diretas.</li></ul>

Responda em português brasileiro, de forma específica e prática. Seja PRECISO: sempre destaque as conquistas perdíveis e deixe claro exatamente o que o jogador precisa fazer.
"""

    texto, erro = chamar_gemini(prompt)
    if erro:
        return jsonify({'status': 'error', 'message': erro})

    if total > 0:
        texto = _barra_progresso_html(pct_real, n_unlocked, total, n_locked) + texto

    if not completo:
        salvar_guia_cache(appid, nome, texto)

    return jsonify({'status': 'success', 'html': texto, 'from_cache': False, 'completo': completo})


# ═══════════════════════════════════════════════════════
#  AGENTE GAMER — Chat com a IA
# ═══════════════════════════════════════════════════════
def _carregar_contexto_usuario():
    """Monta um resumo da biblioteca e avaliações do usuário p/ o chat."""
    user_id = session.get('user_id')
    if not user_id:
        return ''

    partes = []
    try:
        from database import get_connection
        conn = get_connection()
        cur  = conn.cursor()

        cur.execute(
            "SELECT name, status, pct, playtime_forever "
            "FROM user_games WHERE user_id = %s "
            "ORDER BY playtime_forever DESC", (user_id,)
        )
        jogos = cur.fetchall() or []

        if jogos:
            total = len(jogos)
            
            # Adaptação para desempacotar tanto chaves de dicionários quanto índices de tuplas
            if isinstance(jogos[0], dict):
                plat    = sum(1 for j in jogos if j.get('status') == '100%')
                prog    = sum(1 for j in jogos if j.get('status') == 'Em Progresso')
                backlog = sum(1 for j in jogos if (j.get('playtime_forever') or 0) == 0)
                
                mais_jogados = [f"{j['name']} ({round((j.get('playtime_forever') or 0) / 60)}h, {j.get('status', '?')})" for j in jogos[:15] if j.get('name')]
                nao_jogados  = [j['name'] for j in jogos if (j.get('playtime_forever') or 0) == 0 and j.get('name')][:15]
                em_progresso = [f"{j['name']} ({round(j.get('pct') or 0)}%)" for j in jogos if j.get('status') == 'Em Progresso' and j.get('name')][:10]
            else:
                plat    = sum(1 for j in jogos if j[1] == '100%')
                prog    = sum(1 for j in jogos if j[1] == 'Em Progresso')
                backlog = sum(1 for j in jogos if (j[3] or 0) == 0)
                
                mais_jogados = [f"{j[0]} ({round((j[3] or 0) / 60)}h, {j[1]})" for j in jogos[:15] if j[0]]
                nao_jogados  = [j[0] for j in jogos if (j[3] or 0) == 0 and j[0]][:15]
                em_progresso = [f"{j[0]} ({round(j[2] or 0)}%)" for j in jogos if j[1] == 'Em Progresso' and j[0]][:10]

            partes.append(f"Biblioteca: {total} jogos | {plat} platinados | {prog} em progresso | {backlog} nunca jogados (backlog).")
            if mais_jogados: partes.append('Mais jogados: ' + '; '.join(mais_jogados) + '.')
            if nao_jogados:  partes.append('No backlog (ainda não jogou): ' + '; '.join(nao_jogados) + '.')
            if em_progresso: partes.append('Em progresso: ' + '; '.join(em_progresso) + '.')

        # Avaliações
        try:
            cur.execute(
                "SELECT game_name, rating, content FROM reviews "
                "WHERE user_id = %s ORDER BY created_at DESC LIMIT 15", (user_id,)
            )
            reviews = cur.fetchall() or []
            if reviews:
                if isinstance(reviews[0], dict):
                    txt = [f"{r['game_name']}: {r.get('rating', '?')}/5" + (f" — \"{r['content'][:80]}\"" if r.get('content') else '') for r in reviews if r.get('game_name')]
                else:
                    txt = [f"{r[0]}: {r[1]}/5" + (f" — \"{r[2][:80]}\"" if r[2] else '') for r in reviews if r[0]]
                partes.append('Avaliações do usuário: ' + '; '.join(txt) + '.')
        except Exception:
            pass

        cur.close(); conn.close()
    except Exception as e:
        print(f"[Gemini] Erro ao carregar contexto de dados: {e}")
        return ''

    return '\n'.join(partes)


SYSTEM_GAMER = (
    "Você é o 'Agente Gamer' do Game It: um assistente especialista em jogos, "
    "amigável, direto e cheio de personalidade gamer. Você ajuda o usuário com base "
    "na biblioteca de jogos dele (Steam), avaliações e progresso de conquistas.\n"
    "Suas especialidades:\n"
    "- Montar listas de jogos para zerar/platinar com base no que ele já jogou e curtiu.\n"
    "- Sugerir jogos para comprar com base nos gostos e nas avaliações dele.\n"
    "- Dar dicas de conquistas, builds, estratégias, ordem de jogar e tudo do mundo gamer.\n"
    "- Recomendar o que jogar no backlog dele.\n"
    "Regras de resposta:\n"
    "- Responda SEMPRE em português brasileiro, com tom descontraído e gamer.\n"
    "- Seja conciso e use Markdown (títulos com ##, listas com -, **negrito**).\n"
    "- Quando sugerir listas, use bullet points organizados.\n"
    "- Use os dados da biblioteca do usuário quando forem relevantes; se não houver "
    "dados, dê recomendações gerais e incentive sincronizar a Steam."
)


@gemini_bp.route('/api/gemini-chat', methods=['POST'])
@login_required
def gemini_chat():
    data    = request.json or {}
    mensagem = (data.get('message') or '').strip()
    historico = data.get('history') or []

    if not mensagem:
        return jsonify({'status': 'error', 'message': 'Mensagem vazia.'})

    contexto = _carregar_contexto_usuario()

    linhas = [SYSTEM_GAMER, '']
    if contexto:
        linhas.append('=== DADOS DO USUÁRIO ===')
        linhas.append(contexto)
        linhas.append('')

    if historico:
        linhas.append('=== CONVERSA ANTERIOR ===')
        for h in historico[-8:]:
            papel = 'Usuário' if h.get('role') == 'user' else 'Agente Gamer'
            conteudo = (h.get('content') or '')[:600]
            linhas.append(f"{papel}: {conteudo}")
        linhas.append('')

    linhas.append(f"Usuário: {mensagem}")
    linhas.append('Agente Gamer:')

    prompt = '\n'.join(linhas)

    texto, erro = chamar_gemini(prompt)
    if erro:
        return jsonify({'status': 'error', 'message': erro})

    return jsonify({'status': 'success', 'reply': texto})