/* ═══════════════════════════════════════════════════════
   GAME IT — app.js
═══════════════════════════════════════════════════════ */

// ── STATE ────────────────────────────────────────────
let todosJogos                = [];
let jogosFiltrados            = [];
let filtroAtual               = 'todos';
let jogoSelecionadoAtualmente = null;
let recentes                  = [];
let tabAtual                  = 'analysis';

// ═══════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════
const htmlRoot = document.getElementById('html-root');

(function initTheme() {
    const saved = localStorage.getItem('gameit-theme') || 'dark';
    if (saved === 'light') htmlRoot.classList.add('light');
    syncThemeIcon();
})();

function toggleTheme() {
    const nowLight = htmlRoot.classList.toggle('light');
    localStorage.setItem('gameit-theme', nowLight ? 'light' : 'dark');
    syncThemeIcon();
}

function syncThemeIcon() {
    const btn   = document.getElementById('theme-toggle');
    if (!btn) return;
    const light = htmlRoot.classList.contains('light');
    btn.innerHTML = light
        ? '<i class="fa-solid fa-moon"></i>'
        : '<i class="fa-solid fa-sun"></i>';
    btn.title = light ? 'Mudar para Dark Mode' : 'Mudar para Light Mode';
}

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
let toastTimer = null;

function showToast(msg, isError) {
    isError = isError || false;
    var el  = document.getElementById('toast');
    var txt = document.getElementById('toast-msg');
    txt.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.classList.remove('show'); }, 3000);
}

// ═══════════════════════════════════════════════════════
//  LOAD STEAM DATA
// ═══════════════════════════════════════════════════════
async function carregarDados() {
    try {
        var res  = await fetch('/api/steam-data');
        var data = await res.json();

        if (data.status === 'success') {
            todosJogos     = data.games;
            jogosFiltrados = todosJogos.slice();

            document.getElementById('game-count').innerText       = todosJogos.length;
            document.getElementById('loading-state').style.display = 'none';
            document.getElementById('games-grid').style.display    = 'grid';

            atualizarLabelSync(data.last_synced);
            atualizarStats();
            renderizarGrid();
        } else {
            alert('Erro Steam: ' + data.message);
        }
    } catch (e) {
        console.error(e);
        alert('Erro de conexão com o servidor.');
    }
}

// Mostra "Sincronizado há X" no subheader da Biblioteca
function atualizarLabelSync(iso) {
    var el = document.getElementById('last-sync-label');
    if (!el) return;
    if (!iso) { el.innerText = ''; return; }

    var quando = new Date(iso);
    var diffMin = Math.floor((Date.now() - quando.getTime()) / 60000);

    var texto;
    if (diffMin < 1)        texto = 'Sincronizado agora';
    else if (diffMin < 60)  texto = 'Sincronizado há ' + diffMin + ' min';
    else {
        var h = Math.floor(diffMin / 60);
        texto = 'Sincronizado há ' + h + (h === 1 ? ' hora' : ' horas');
    }
    el.innerText = texto;
}

// ═══════════════════════════════════════════════════════
//  STATS + TRENDING
// ═══════════════════════════════════════════════════════
function atualizarStats() {
    var total = todosJogos.length;
    var plat  = todosJogos.filter(function(j) { return j.status === '100%'; }).length;
    var prog  = todosJogos.filter(function(j) { return j.status === 'Em Progresso'; }).length;
    var none  = todosJogos.filter(function(j) { return j.status === 'Sem Conquistas'; }).length;
    var pct   = total > 0 ? ((plat / total) * 100).toFixed(1) : 0;

    document.getElementById('stat-total').innerText    = total;
    document.getElementById('stat-plat').innerText     = plat;
    document.getElementById('stat-prog').innerText     = prog;
    document.getElementById('stat-none').innerText     = none;
    document.getElementById('plat-bar').style.width    = pct + '%';
    document.getElementById('plat-pct-text').innerText = pct + '%';

    // Card de perfil (estilo LinkedIn) na coluna esquerda
    var pgTotal = document.getElementById('pg-stat-total');
    var pgPlat  = document.getElementById('pg-stat-plat');
    if (pgTotal) pgTotal.innerText = total;
    if (pgPlat)  pgPlat.innerText  = plat;
}

// ═══════════════════════════════════════════════════════
//  CARD DE PERFIL (estilo LinkedIn) — coluna esquerda
// ═══════════════════════════════════════════════════════
async function carregarPerfilProgresso() {
    try {
        var res  = await fetch('/api/profile');
        var data = await res.json();
        if (data.status !== 'success') return;
        var p = data.profile || {};

        var nick = p.nickname || 'Jogador';
        if (nick[0] !== '@') nick = '@' + nick;
        var nickEl = document.getElementById('pg-nickname');
        if (nickEl) nickEl.textContent = nick;

        var bioEl = document.getElementById('pg-bio');
        if (bioEl) bioEl.textContent = p.bio || 'Sem bio ainda.';

        var joinedEl = document.getElementById('pg-joined');
        if (joinedEl) joinedEl.textContent = p.joined || 'Recentemente';

        var avatar = p.avatar || '/static/img/Game It Logo.svg';
        var avEl   = document.getElementById('pg-avatar-img');
        if (avEl) avEl.src = avatar;

        var banner = document.getElementById('pg-banner');
        if (banner && p.cover) banner.style.backgroundImage = "url('" + p.cover + "')";

        renderFavoritosProgresso(p.favorites || []);
    } catch (e) { /* mantém placeholders */ }
}

function renderFavoritosProgresso(favs) {
    var box = document.getElementById('pg-fav-covers');
    if (!box) return;
    var html = '';
    for (var i = 0; i < 3; i++) {
        var f = favs[i];
        if (f) {
            html += '<a href="/jogo/' + encodeURIComponent(f.appid) + '" class="pg-fav-cover" title="'
                  + (f.name || '').replace(/"/g, '&quot;') + '">'
                  + '<img src="' + (f.cover || '') + '" alt="" '
                  + "onerror=\"this.onerror=null;this.src='/static/img/Game It Logo.svg'\"></a>";
        } else {
            html += '<div class="pg-fav-cover empty"><i class="fa-solid fa-star"></i></div>';
        }
    }
    box.innerHTML = html;
}

// ═══════════════════════════════════════════════════════
//  TRENDING TOPICS (igual ao Perfil — hashtags dos posts)
// ═══════════════════════════════════════════════════════
async function carregarTrending() {
    var box = document.getElementById('trending-list');
    if (!box) return;
    try {
        var res  = await fetch('/api/trending');
        var data = await res.json();
        if (data.status !== 'success' || !data.topics.length) {
            box.innerHTML = '<div class="empty-panel"><i class="fa-solid fa-hashtag"></i>'
                          + '<p>Nenhum trending ainda.</p></div>';
            return;
        }
        box.innerHTML = data.topics.map(function(t, i) {
            return '<div class="trend">'
                 + '<span class="trend-rank">#' + (i + 1) + '</span>'
                 + '<div class="trend-meta">'
                 + '<span class="trend-tag">' + escHtml(t.tag) + '</span>'
                 + '<span class="trend-count">' + t.count + ' '
                 + (t.count === 1 ? 'menção' : 'menções') + '</span>'
                 + '</div></div>';
        }).join('');
    } catch (e) {
        box.innerHTML = '<div class="empty-panel"><i class="fa-solid fa-hashtag"></i>'
                      + '<p>Nenhum trending ainda.</p></div>';
    }
}

// ═══════════════════════════════════════════════════════
//  RECENTES
// ═══════════════════════════════════════════════════════
function adicionarRecente(jogo) {
    recentes = recentes.filter(function(j) { return j.appid !== jogo.appid; });
    recentes.unshift(jogo);
    recentes = recentes.slice(0, 5);
    renderRecentes();
}

function renderRecentes() {
    var el = document.getElementById('recent-list');

    if (recentes.length === 0) {
        el.innerHTML = '<p class="empty-msg">Nenhum aberto ainda.</p>';
        return;
    }

    var html = '';
    recentes.forEach(function(j) {
        html += '<div onclick="abrirJogoPorId(' + j.appid + ')" class="hover-row"'
             +  ' style="display:flex;align-items:center;gap:10px;padding:7px 6px;cursor:pointer;">'
             +  '<img src="https://steamcdn-a.akamaihd.net/steam/apps/' + j.appid + '/capsule_sm_120.jpg"'
             +  ' style="width:38px;height:26px;object-fit:cover;border-radius:6px;flex-shrink:0;"'
             +  ' onerror="this.style.display=\'none\'">'
             +  '<div style="overflow:hidden;">'
             +  '<p style="font-size:11px;font-weight:600;color:var(--text-heading);'
             +  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + j.name + '</p>'
             +  '<p style="font-size:10px;color:#6366F1;">' + j.pct.toFixed(0) + '%</p>'
             +  '</div></div>';
    });
    el.innerHTML = html;
}

function abrirJogoPorId(appid) {
    var jogo = todosJogos.filter(function(j) { return String(j.appid) === String(appid); })[0];
    if (jogo) abrirGuia(jogo);
}

// Navega para a página de perfil do jogo (game.html)
function abrirJogo(appid) {
    window.location.href = '/jogo/' + appid;
}

// ═══════════════════════════════════════════════════════
//  RENDER GRID
// ═══════════════════════════════════════════════════════
function renderizarGrid() {
    var grid = document.getElementById('games-grid');
    grid.innerHTML = '';

    if (jogosFiltrados.length === 0) {
        grid.innerHTML = '<div class="empty-panel" style="grid-column:1/-1;">'
                       + '<i class="fa-solid fa-filter"></i>'
                       + '<p>Nenhum jogo encontrado para este filtro.</p></div>';
        return;
    }

    jogosFiltrados.forEach(function(jogo) {
        var is100   = jogo.status === '100%';
        var hasProg = jogo.status === 'Em Progresso';

        var badgeBg  = is100 ? 'rgba(251,191,36,0.92)' : hasProg ? 'rgba(99,102,241,0.92)' : 'rgba(15,23,42,0.78)';
        var badgeTxt = is100 ? '#1f2937'               : '#fff';
        var label    = is100 ? '100%' : hasProg ? jogo.pct.toFixed(0) + '%' : 'Sem troféus';

        var card = document.createElement('div');
        card.className = 'jogo-mini';
        card.title     = jogo.name;
        card.onclick   = (function(j) { return function() { abrirGuia(j); }; })(jogo);

        var placeholder = 'https://via.placeholder.com/300x450/111827/6366F1?text='
                        + encodeURIComponent(jogo.name);

        card.innerHTML =
              '<span class="jogo-status-badge" style="background:' + badgeBg + ';color:' + badgeTxt + ';">'
            + label + '</span>'
            + '<img src="https://steamcdn-a.akamaihd.net/steam/apps/' + jogo.appid + '/library_600x900.jpg"'
            + ' alt="' + escHtml(jogo.name) + '"'
            + ' onerror="this.onerror=null;this.src=\'https://steamcdn-a.akamaihd.net/steam/apps/'
            + jogo.appid + '/header.jpg\';this.style.aspectRatio=\'16/9\';">'
            + '<span class="jogo-mini-name">' + escHtml(jogo.name) + '</span>';

        grid.appendChild(card);
    });
}

// ═══════════════════════════════════════════════════════
//  FILTERS & SEARCH
// ═══════════════════════════════════════════════════════
function aoPesquisar() {
    var busca = document.getElementById('search-bar').value.toLowerCase();
    aplicarFiltrosEBusca(busca);
}

function filtrarJogos(tipo) {
    filtroAtual = tipo;
    ['btn-todos', 'btn-platinados', 'btn-progresso'].forEach(function(id) {
        document.getElementById(id).classList.remove('fa', 'fap');
    });
    if (tipo === 'todos')     document.getElementById('btn-todos').classList.add('fa');
    if (tipo === '100')       document.getElementById('btn-platinados').classList.add('fap');
    if (tipo === 'progresso') document.getElementById('btn-progresso').classList.add('fa');
    aoPesquisar();
}

function aplicarFiltrosEBusca(busca) {
    busca = busca || '';
    var base = todosJogos.slice();

    if (filtroAtual === '100') {
        base = base.filter(function(j) { return j.status === '100%'; });
    } else if (filtroAtual === 'progresso') {
        base = base.filter(function(j) { return j.status === 'Em Progresso'; });
    }

    if (busca) {
        base = base.filter(function(j) { return j.name.toLowerCase().indexOf(busca) !== -1; });
    }

    jogosFiltrados = base;
    renderizarGrid();
}

// ═══════════════════════════════════════════════════════
//  MODAL TABS
// ═══════════════════════════════════════════════════════
function switchTab(tab) {
    tabAtual = tab;
    ['analysis', 'achievements', 'notes'].forEach(function(t) {
        document.getElementById('tab-' + t).classList.toggle('active', t === tab);
        document.getElementById('panel-' + t).style.display = t === tab ? 'flex' : 'none';
    });
    if (tab === 'notes' && jogoSelecionadoAtualmente) {
        carregarNotes(jogoSelecionadoAtualmente.appid);
    }
}

// ═══════════════════════════════════════════════════════
//  GEMINI HELPERS
// ═══════════════════════════════════════════════════════
function spinnerHTML(msg) {
    return '<div style="display:flex;align-items:center;gap:12px;">'
         + '<div class="spinner-sm"></div>'
         + '<span style="font-size:13px;color:var(--text-muted);">' + msg + '</span>'
         + '</div>'
         + '<p style="font-size:11px;color:var(--text-muted);margin-top:10px;opacity:0.65;">'
         + 'Plano gratuito Gemini: ~5 req/min. Retry automático ativo.'
         + '</p>';
}

function aiActionButtons() {
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;">'
         + '<button class="btn-regen" onclick="gerarNovamente()">🔄 Gerar Novamente</button>'
         + '<button class="btn-save-ai" onclick="salvarGuiaComoNota()">💾 Salvar como Anotação</button>'
         + '</div>';
}

// Indica se o guia atual é do tipo "bônus" (gerado mesmo com 100%)
var guiaForcado = false;

function gerarNovamente() {
    if (!jogoSelecionadoAtualmente) return;
    var aiBox = document.getElementById('ai-analysis-box');
    aiBox.innerHTML = spinnerHTML('Gerando nova análise...');
    var url = guiaForcado ? '/api/analisar-jogo?regen=1&force=1' : '/api/analisar-jogo?regen=1';
    chamarGemini(url, jogoSelecionadoAtualmente, aiBox);
}

// Botão do estado "100% completo": gera o guia bônus mesmo assim
function gerarMesmoAssim() {
    if (!jogoSelecionadoAtualmente) return;
    guiaForcado = true;
    var aiBox = document.getElementById('ai-analysis-box');
    aiBox.innerHTML = spinnerHTML('Gerando guia bônus...');
    chamarGemini('/api/analisar-jogo?force=1', jogoSelecionadoAtualmente, aiBox);
}

function chamarGemini(url, jogo, aiBox) {
    var inicio = Date.now();

    fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            appid:      jogo.appid,
            nome:       jogo.name,
            conquistas: jogo.achievements || [],
            status:     jogo.status || '',
            pct:        jogo.pct || 0
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var seg = ((Date.now() - inicio) / 1000).toFixed(1);

        if (data.status === 'success') {
            // Estado "100% completo": mostra aviso + botão para gerar mesmo assim
            if (data.completo && url.indexOf('force=1') === -1) {
                guiaForcado = false;
                aiBox.innerHTML = data.html
                    + '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;justify-content:center;">'
                    + '<button class="btn-regen" onclick="gerarMesmoAssim()">'
                    + '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar guia bônus</button>'
                    + '</div>';
                return;
            }

            var cacheLabel = data.from_cache ? '<i class="fa-solid fa-bolt"></i> Carregado do cache'
                                             : '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerado em ' + seg + 's';
            aiBox.innerHTML = '<div class="guia-cache-label">' + cacheLabel + '</div>'
                            + data.html
                            + aiActionButtons();
        } else {
            aiBox.innerHTML = '<div style="padding:16px;border-radius:12px;'
                            + 'background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.18);">'
                            + '<p style="color:#f87171;font-weight:600;margin-bottom:8px;">Erro na API Gemini</p>'
                            + '<p style="font-size:12px;color:var(--text-muted);">' + data.message + '</p>'
                            + '<button class="btn-regen" style="margin-top:12px;" onclick="gerarNovamente()">'
                            + 'Tentar Novamente</button></div>';
        }
    })
    .catch(function() {
        aiBox.innerHTML = '<div style="color:#f87171;">Erro de conexão com o servidor.<br>'
                        + '<button class="btn-regen" style="margin-top:10px;" onclick="gerarNovamente()">'
                        + 'Tentar Novamente</button></div>';
    });
}

// ═══════════════════════════════════════════════════════
//  NOTES API
// ═══════════════════════════════════════════════════════
async function carregarNotes(appid) {
    document.getElementById('notes-list').innerHTML =
        '<div style="display:flex;justify-content:center;padding:24px;">'
        + '<div class="spinner-sm"></div></div>';

    try {
        var res  = await fetch('/api/notes/' + appid);
        var data = await res.json();
        if (data.status === 'success') {
            renderNotes(data.notes);
            atualizarBadgeNotes(data.notes.length);
        }
    } catch (e) {
        document.getElementById('notes-list').innerHTML =
            '<p class="empty-msg" style="text-align:center;padding:20px;">Erro ao carregar anotações.</p>';
    }
}

function renderNotes(notes) {
    var list = document.getElementById('notes-list');

    if (notes.length === 0) {
        list.innerHTML = '<p class="empty-msg" style="text-align:center;padding:32px 0;">'
                       + 'Nenhuma anotação ainda. Clique em "Nova Anotação" ou salve o guia da IA.</p>';
        return;
    }

    list.innerHTML = '';
    notes.forEach(function(note) {
        list.appendChild(criarNoteCard(note));
    });
}

function criarNoteCard(note) {
    var card = document.createElement('div');
    card.className = 'note-card';
    card.id        = 'note-' + note.id;

    var dateObj = new Date(note.created_at);
    var dateStr = dateObj.toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    card.innerHTML = '<div class="note-header">'
        + '<input type="text" class="note-title-input"'
        + ' id="title-' + note.id + '"'
        + ' value="' + escHtml(note.title) + '"'
        + ' placeholder="Título da anotação...">'
        + '<span class="note-meta">' + dateStr + '</span>'
        + '</div>'
        + '<textarea class="note-content-input"'
        + ' id="content-' + note.id + '"'
        + ' placeholder="Suas anotações aqui...">'
        + escHtml(note.content)
        + '</textarea>'
        + '<div class="note-footer">'
        + '<button class="btn-save-note" onclick="salvarNote(' + note.id + ')">'
        + '<i class="fa-solid fa-floppy-disk"></i> Salvar</button>'
        + '<button class="btn-del-note" onclick="deletarNote(' + note.id + ')">'
        + '<i class="fa-solid fa-trash"></i> Excluir</button>'
        + '</div>';

    return card;
}

async function criarNotaManual() {
    if (!jogoSelecionadoAtualmente) return;
    await criarNota('Nova Anotação', '');
}

async function salvarGuiaComoNota() {
    if (!jogoSelecionadoAtualmente) return;

    var aiBox  = document.getElementById('ai-analysis-box');
    var texto  = aiBox.innerText.trim();

    if (!texto || texto.indexOf('Gerando') !== -1) {
        showToast('Aguarde a análise terminar.', true);
        return;
    }

    var titulo = 'Guia IA — ' + jogoSelecionadoAtualmente.name;
    await criarNota(titulo, texto);
    switchTab('notes');
}

async function criarNota(title, content) {
    var jogo = jogoSelecionadoAtualmente;
    try {
        var res  = await fetch('/api/notes', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                appid:     jogo.appid,
                game_name: jogo.name,
                title:     title,
                content:   content
            })
        });
        var data = await res.json();
        if (data.status === 'success') {
            await carregarNotes(jogo.appid);
            showToast('Anotação salva!');
        }
    } catch (e) {
        showToast('Erro ao salvar anotação.', true);
    }
}

async function salvarNote(noteId) {
    var title   = document.getElementById('title-'   + noteId).value;
    var content = document.getElementById('content-' + noteId).value;

    try {
        var res  = await fetch('/api/notes/' + noteId, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title: title, content: content })
        });
        var data = await res.json();
        if (data.status === 'success') {
            showToast('Anotação atualizada!');
        }
    } catch (e) {
        showToast('Erro ao salvar.', true);
    }
}

async function deletarNote(noteId) {
    if (!confirm('Excluir esta anotação?')) return;

    try {
        await fetch('/api/notes/' + noteId, { method: 'DELETE' });

        var card = document.getElementById('note-' + noteId);
        if (card) card.remove();

        var list  = document.getElementById('notes-list');
        var count = list.querySelectorAll('.note-card').length;
        atualizarBadgeNotes(count);

        if (count === 0) {
            list.innerHTML = '<p class="empty-msg" style="text-align:center;padding:32px 0;">'
                           + 'Nenhuma anotação. Clique em "Nova Anotação" para começar.</p>';
        }

        showToast('Anotação excluída.');
    } catch (e) {
        showToast('Erro ao excluir.', true);
    }
}

function atualizarBadgeNotes(count) {
    var badge = document.getElementById('notes-badge');
    if (count > 0) {
        badge.innerText     = count;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

// ═══════════════════════════════════════════════════════
//  OPEN MODAL
// ═══════════════════════════════════════════════════════
function abrirGuia(jogo) {
    jogoSelecionadoAtualmente = jogo;
    guiaForcado = false;
    adicionarRecente(jogo);

    document.getElementById('modal-game-title').innerText  = jogo.name;
    document.getElementById('modal-game-status').innerText =
        jogo.pct.toFixed(1) + '% Concluido  •  AppID: ' + jogo.appid;

    document.getElementById('modal-guia').classList.add('open');
    document.getElementById('modal-content').classList.add('open');

    switchTab('analysis');

    var aiBox = document.getElementById('ai-analysis-box');
    aiBox.innerHTML = spinnerHTML('Gerando análise com IA...');
    chamarGemini('/api/analisar-jogo', jogo, aiBox);

    renderAchievements(jogo);
    atualizarBadgeNotes(0);
}

function renderAchievements(jogo) {
    var achList = document.getElementById('achievements-list');
    achList.innerHTML = '';

    if (jogo.status !== '100%' && jogo.achievements && jogo.achievements.length > 0) {
        var bloqueadas = jogo.achievements.filter(function(a) { return a.achieved === 0; });

        if (bloqueadas.length === 0) {
            achList.innerHTML = '<div style="text-align:center;padding:20px;font-size:13px;'
                              + 'color:var(--text-muted);">Todas as conquistas desbloqueadas!</div>';
            return;
        }

        bloqueadas.forEach(function(ach) {
            var nome = ach.name || ach.apiname;
            var desc = ach.description || 'Conquista secreta ou sem descrição.';
            var qYT  = encodeURIComponent(jogo.name + ' ' + nome + ' conquista');
            var qPST = encodeURIComponent(jogo.name + ' ' + nome);

            var item = document.createElement('div');
            item.className = 'ach-item';
            item.innerHTML = '<div style="flex:1;overflow:hidden;">'
                + '<p class="ach-name">🛡 ' + nome + '</p>'
                + '<p class="ach-desc">' + desc + '</p>'
                + '</div>'
                + '<div class="ach-links">'
                + '<a href="https://forum.mypst.com.br/index.php?/search/&q=' + qPST
                + '&type=forums_topic&nodes=19" target="_blank" class="btn-mypst">'
                + '<i class="fa-solid fa-magnifying-glass" style="font-size:10px;"></i> MyPST</a>'
                + '<a href="https://www.youtube.com/results?search_query=' + qYT
                + '" target="_blank" class="btn-yt">'
                + '<i class="fa-brands fa-youtube" style="font-size:10px;"></i> YouTube</a>'
                + '</div>';

            achList.appendChild(item);
        });

    } else if (jogo.status === '100%') {
        achList.innerHTML = '<div style="text-align:center;padding:24px;font-size:13px;'
                          + 'color:var(--text-muted);">🏆 Todas as conquistas desbloqueadas!</div>';
    } else {
        achList.innerHTML = '<div style="text-align:center;padding:24px;font-size:13px;'
                          + 'color:var(--text-muted);">Sem conquistas disponíveis.</div>';
    }
}

// ═══════════════════════════════════════════════════════
//  CLOSE MODAL
// ═══════════════════════════════════════════════════════
function fecharModal() {
    document.getElementById('modal-guia').classList.remove('open');
    document.getElementById('modal-content').classList.remove('open');
}

document.getElementById('modal-guia').addEventListener('click', function(e) {
    if (e.target === this) fecharModal();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') fecharModal();
});

// ── Logout ────────────────────────────────────────────
async function fazerLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
}

// ── Sync manual ───────────────────────────────────────
async function syncJogos() {
    var icon = document.getElementById('sync-dash-icon');
    var btn  = document.getElementById('btn-sync-dash');
    if (btn) btn.disabled = true;
    if (icon) icon.style.cssText = 'animation: spin 1s linear infinite;';

    try {
        var res  = await fetch('/api/steam-sync', { method: 'POST' });
        var data = await res.json();
        if (data.status === 'success') {
            showToast('✅ ' + data.message);
            await carregarDados(); // recarrega a grid a partir do cache atualizado
        } else {
            showToast('❌ ' + data.message, true);
        }
    } catch(e) {
        showToast('❌ Erro ao sincronizar.', true);
    }

    if (btn)  btn.disabled = false;
    if (icon) icon.style.cssText = '';
}

// ── Auto-sync a cada 2h (enquanto a página estiver aberta) ──
setInterval(syncJogos, 2 * 60 * 60 * 1000);


// ═══════════════════════════════════════════════════════
//  DOWNLOAD
// ═══════════════════════════════════════════════════════
function baixarGuiaDocumento() {
    if (!jogoSelecionadoAtualmente) return;

    var j      = jogoSelecionadoAtualmente;
    var aiBox  = document.getElementById('ai-analysis-box');
    var texto  = aiBox.innerText.trim();

    var conteudo = (texto && texto.indexOf('Gerando') === -1)
        ? texto
        : 'GUIA DE PLATINA - ' + j.name.toUpperCase()
          + '\nProgresso: ' + j.pct.toFixed(1) + '%'
          + '\n\nAcesse o dashboard Game It para o guia completo.';

    var nomeArquivo = 'Guia_' + j.name.replace(/[^a-zA-Z0-9]/g, '_') + '.txt';

    var blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    link.click();
    URL.revokeObjectURL(link.href);
}

// ═══════════════════════════════════════════════════════
//  TÓPICOS DA PÁGINA (tabs)
// ═══════════════════════════════════════════════════════
function switchPageTab(tab) {
    document.querySelectorAll('.ptab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    ['chat', 'biblioteca', 'estatisticas'].forEach(function(t) {
        var p = document.getElementById('ppanel-' + t);
        if (p) p.style.display = (t === tab) ? 'flex' : 'none';
    });
    // A lateral (filtros + recentemente) só aparece na aba Biblioteca
    var libSide = document.getElementById('lib-side');
    if (libSide) libSide.style.display = (tab === 'biblioteca') ? 'flex' : 'none';

    if (tab === 'chat') {
        var inp = document.getElementById('chat-input');
        if (inp) setTimeout(function() { inp.focus(); }, 50);
    }
}

// ═══════════════════════════════════════════════════════
//  AGENTE GAMER — CHAT
// ═══════════════════════════════════════════════════════
var CHAT_HISTORY = [];
var CHAT_LOADING = false;

function autoGrowChat(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function chatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviarMensagemChat();
    }
}

// Markdown simples → HTML (seguro: escapa antes)
function renderMarkdown(text) {
    var html = escHtml(text);

    // títulos
    html = html.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^##\s+(.+)$/gm,  '<h3>$1</h3>');
    html = html.replace(/^#\s+(.+)$/gm,   '<h3>$1</h3>');

    // negrito e itálico
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // listas (marca itens e agrupa em <ul>)
    html = html.replace(/^(?:\s*[-*])\s+(.+)$/gm, '\u0001LI\u0001$1');
    html = html.replace(/^(?:\s*\d+\.)\s+(.+)$/gm, '\u0001LI\u0001$1');
    html = html.replace(/(?:\u0001LI\u0001.*(?:\n|$))+/g, function(block) {
        var items = block.trim().split('\n').map(function(l) {
            return '<li>' + l.replace(/^\u0001LI\u0001/, '') + '</li>';
        }).join('');
        return '<ul>' + items + '</ul>';
    });

    // parágrafos / quebras
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';

    // limpa <p>/<br> em volta de blocos
    html = html.replace(/<p>\s*(<(?:ul|h3|h4)>)/g, '$1');
    html = html.replace(/(<\/(?:ul|h3|h4)>)\s*<\/p>/g, '$1');
    html = html.replace(/<br>\s*(<(?:ul|h3|h4)>)/g, '$1');
    html = html.replace(/(<\/(?:ul|h3|h4)>)\s*<br>/g, '$1');
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
}

function scrollChatToBottom() {
    var box = document.getElementById('chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
}

function appendChatMessage(role, contentHtml, id) {
    var box = document.getElementById('chat-messages');
    if (!box) return null;
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg ' + (role === 'user' ? 'user' : 'bot');
    if (id) wrap.id = id;

    var av = role === 'user'
        ? '<div class="chat-msg-av user-av"><i class="fa-solid fa-user"></i></div>'
        : '<div class="chat-msg-av bot-av"><i class="fa-solid fa-robot"></i></div>';

    wrap.innerHTML = av + '<div class="chat-bubble">' + contentHtml + '</div>';
    box.appendChild(wrap);
    scrollChatToBottom();
    return wrap;
}

function chatWelcome() {
    var box = document.getElementById('chat-messages');
    if (!box || box.children.length > 0) return;
    appendChatMessage('bot', renderMarkdown(
        'E aí, gamer! 🎮 Eu sou o seu **Agente Gamer**. Posso montar listas de jogos '
        + 'para zerar, sugerir o que comprar, dar dicas de platina e te ajudar a escolher '
        + 'o próximo jogo do seu backlog. Manda ver — pergunte qualquer coisa ou use as '
        + 'sugestões abaixo!'
    ));
}

function enviarSugestao(texto) {
    var inp = document.getElementById('chat-input');
    if (inp) inp.value = texto;
    enviarMensagemChat();
}

async function enviarMensagemChat() {
    if (CHAT_LOADING) return;
    var inp = document.getElementById('chat-input');
    if (!inp) return;
    var msg = inp.value.trim();
    if (!msg) return;

    inp.value = '';
    autoGrowChat(inp);

    appendChatMessage('user', escHtml(msg).replace(/\n/g, '<br>'));
    CHAT_HISTORY.push({ role: 'user', content: msg });

    CHAT_LOADING = true;
    var sendBtn = document.getElementById('chat-send');
    if (sendBtn) sendBtn.disabled = true;

    var typingId = 'chat-typing';
    appendChatMessage('bot',
        '<div class="chat-typing"><span></span><span></span><span></span></div>', typingId);

    try {
        var res = await fetch('/api/gemini-chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ message: msg, history: CHAT_HISTORY.slice(0, -1) })
        });
        var data = await res.json();

        var typing = document.getElementById(typingId);
        if (typing) typing.remove();

        if (data.status === 'success') {
            appendChatMessage('bot', renderMarkdown(data.reply));
            CHAT_HISTORY.push({ role: 'assistant', content: data.reply });
        } else {
            appendChatMessage('bot',
                '<div class="chat-error"><i class="fa-solid fa-triangle-exclamation"></i> '
                + escHtml(data.message || 'Erro ao falar com a IA.') + '</div>');
        }
    } catch (e) {
        var t = document.getElementById(typingId);
        if (t) t.remove();
        appendChatMessage('bot',
            '<div class="chat-error"><i class="fa-solid fa-triangle-exclamation"></i> '
            + 'Erro de conexão com o servidor.</div>');
    }

    CHAT_LOADING = false;
    if (sendBtn) sendBtn.disabled = false;
    scrollChatToBottom();
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
window.onload = function() {
    carregarDados();
    carregarTrending();
    carregarPerfilProgresso();
    chatWelcome();
};