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

    var top = todosJogos
        .filter(function(j) { return j.status === 'Em Progresso'; })
        .sort(function(a, b) { return b.pct - a.pct; })
        .slice(0, 5);

    var trendEl = document.getElementById('trending-list');

    if (top.length === 0) {
        trendEl.innerHTML = '<p class="empty-msg">Sem dados ainda.</p>';
        return;
    }

    var html = '';
    top.forEach(function(j) {
        html += '<div onclick="abrirJogoPorId(' + j.appid + ')" class="hover-row"'
             +  ' style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 4px;">'
             +  '<div style="width:6px;height:6px;border-radius:50%;background:#6366F1;flex-shrink:0;"></div>'
             +  '<span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;'
             +  'white-space:nowrap;color:var(--text-muted);">' + j.name + '</span>'
             +  '<span style="font-size:11px;font-weight:700;color:#6366F1;flex-shrink:0;">'
             +  j.pct.toFixed(0) + '%</span>'
             +  '</div>';
    });
    trendEl.innerHTML = html;
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
    abrirJogo(appid);
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
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 0;'
                       + 'font-size:13px;color:var(--text-muted);">'
                       + 'Nenhum jogo encontrado para este filtro.</div>';
        return;
    }

    jogosFiltrados.forEach(function(jogo) {
        var is100   = jogo.status === '100%';
        var hasProg = jogo.status === 'Em Progresso';

        var badgeBg  = is100 ? 'rgba(251,191,36,0.14)'  : hasProg ? 'rgba(99,102,241,0.16)'  : 'var(--badge-none-bg)';
        var badgeTxt = is100 ? '#fbbf24'                : hasProg ? '#6366F1'                 : 'var(--badge-none-txt)';
        var barColor = is100 ? '#fbbf24'                : '#6366F1';

        var card     = document.createElement('div');
        card.className = 'game-card';
        card.onclick   = (function(j) { return function() { abrirJogo(j.appid); }; })(jogo);

        var placeholder = 'https://via.placeholder.com/460x215/111827/6366F1?text=' + encodeURIComponent(jogo.name);

        card.innerHTML = '<div class="card-img-wrap">'
            + '<img class="card-img"'
            + ' src="https://steamcdn-a.akamaihd.net/steam/apps/' + jogo.appid + '/header.jpg"'
            + ' alt="' + jogo.name + '"'
            + ' onerror="this.src=\'' + placeholder + '\'">'
            + '<span class="card-badge"'
            + ' style="background:' + badgeBg + ';color:' + badgeTxt + ';">' + jogo.status + '</span>'
            + '</div>'
            + '<div class="card-body">'
            + '<h3 class="card-title">' + jogo.name + '</h3>'
            + '<div>'
            + '<div class="card-progress-label">'
            + '<span>Progresso</span>'
            + '<span class="card-pct">' + jogo.pct.toFixed(1) + '%</span>'
            + '</div>'
            + '<div class="progress-track">'
            + '<div class="progress-fill" style="width:' + jogo.pct + '%;background:' + barColor + ';"></div>'
            + '</div>'
            + '</div>'
            + '</div>';

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

function gerarNovamente() {
    if (!jogoSelecionadoAtualmente) return;
    var aiBox = document.getElementById('ai-analysis-box');
    aiBox.innerHTML = spinnerHTML('Gerando nova análise...');
    chamarGemini('/api/analisar-jogo?regen=1', jogoSelecionadoAtualmente, aiBox);
}

function chamarGemini(url, jogo, aiBox) {
    var inicio = Date.now();

    fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            appid:      jogo.appid,
            nome:       jogo.name,
            conquistas: jogo.achievements || []
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var seg = ((Date.now() - inicio) / 1000).toFixed(1);

        if (data.status === 'success') {
            var cacheLabel = data.from_cache ? 'Carregado do cache' : 'Gerado em ' + seg + 's';
            aiBox.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:12px;">'
                            + cacheLabel + '</div>'
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
//  INIT
// ═══════════════════════════════════════════════════════
window.onload = carregarDados;