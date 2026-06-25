/* ═══════════════════════════════════════════════════════
   GAME IT — profile.js  (rede social funcional)
═══════════════════════════════════════════════════════ */

const htmlRoot = document.getElementById('html-root');
const DEFAULT_AVATAR = '/static/img/Game It Logo.svg';

// estado em memória
let LIBRARY = [];          // biblioteca da Steam (cache)
let FAV_SELECTION = [];    // appids selecionados no modal de favoritos
let REVIEW_RATING = 0;     // estrelas escolhidas no modal de review
let MY_AVATAR = DEFAULT_AVATAR;
const tabsLoaded = { reviews: false, listas: false, jogos: false, curtidas: false };

// ── THEME ────────────────────────────────────────────
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
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const light = htmlRoot.classList.contains('light');
    btn.innerHTML = light ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
    btn.title = light ? 'Mudar para Dark Mode' : 'Mudar para Light Mode';
}

// ── TOAST ────────────────────────────────────────────
let toastTimer;
function mostrarToast(msg, isError) {
    const el = document.getElementById('toast');
    if (!el) return;
    document.getElementById('toast-msg').textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
const showToast = mostrarToast;

// ── UTIL ─────────────────────────────────────────────
function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}

const spinner = '<div class="recent-loading"><div class="spinner-sm"></div></div>';

function emptyMsg(text, icon) {
    return `<div class="empty-panel"><i class="fa-solid ${icon || 'fa-inbox'}"></i><p>${text}</p></div>`;
}

// ── TABS ─────────────────────────────────────────────
function switchProfileTab(tab) {
    document.querySelectorAll('.ptab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
    ['posts', 'reviews', 'listas', 'jogos', 'curtidas'].forEach(t => {
        const p = document.getElementById('ppanel-' + t);
        if (p) p.style.display = (t === tab) ? 'flex' : 'none';
    });
    if (tab === 'reviews' && !tabsLoaded.reviews) { carregarReviews(); tabsLoaded.reviews = true; }
    if (tab === 'jogos' && !tabsLoaded.jogos) { carregarJogosTab(); tabsLoaded.jogos = true; }
    if (tab === 'curtidas' && !tabsLoaded.curtidas) { carregarCurtidas(); tabsLoaded.curtidas = true; }
}

// ── LOGOUT ───────────────────────────────────────────
async function fazerLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
}

// ═══════════════════════════════════════════════════
//  PERFIL
// ═══════════════════════════════════════════════════
async function carregarPerfil() {
    try {
        const res = await fetch('/api/profile');
        const data = await res.json();
        if (data.status !== 'success') return;
        const p = data.profile;

        document.getElementById('profile-nickname').textContent =
            (p.nickname && p.nickname[0] === '@') ? p.nickname : '@' + p.nickname;
        document.getElementById('profile-bio').textContent = p.bio || 'Sem bio ainda.';
        document.getElementById('profile-joined').textContent = p.joined || 'Recentemente';
        document.getElementById('follow-following').textContent = p.following ?? 0;
        document.getElementById('follow-followers').textContent = p.followers ?? 0;

        MY_AVATAR = p.avatar || DEFAULT_AVATAR;
        document.getElementById('profile-avatar-img').src = MY_AVATAR;
        document.getElementById('composer-avatar').src = MY_AVATAR;

        if (p.cover) {
            document.getElementById('profile-banner').style.backgroundImage =
                `url('${p.cover}')`;
        }
        renderFavoritos(p.favorites || []);
    } catch (e) { /* mantém placeholders */ }
}

function renderFavoritos(favs) {
    const box = document.getElementById('fav-covers');
    let html = '';
    for (let i = 0; i < 3; i++) {
        const f = favs[i];
        if (f) {
            html += `<div class="fav-cover" title="${escapeHtml(f.name)}">
                        <img src="${f.cover}" alt="" onerror="this.parentNode.classList.add('empty');this.remove();">
                     </div>`;
        } else {
            html += `<div class="fav-cover empty" onclick="abrirSeletorFavoritos()">
                        <i class="fa-solid fa-plus"></i></div>`;
        }
    }
    box.innerHTML = html;
}

// ── Editar perfil (modal) ────────────────────────────
function abrirEditarPerfil() {
    const nick = document.getElementById('profile-nickname').textContent.replace(/^@/, '');
    const bio = document.getElementById('profile-bio').textContent;
    document.getElementById('edit-nickname').value = nick === 'Jogador' ? '' : nick;
    document.getElementById('edit-bio').value = (bio === 'Sem bio ainda.') ? '' : bio;
    abrirModal('modal-edit');
}

async function salvarPerfil() {
    const body = {
        nickname: document.getElementById('edit-nickname').value.trim(),
        bio: document.getElementById('edit-bio').value.trim()
    };
    try {
        const res = await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast('Perfil atualizado!');
            fecharModal('modal-edit');
            carregarPerfil();
        } else {
            mostrarToast(data.message || 'Erro ao salvar.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

// ── Upload de imagem (avatar / capa) ─────────────────
async function enviarImagem(tipo, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    mostrarToast('Enviando imagem...');
    try {
        const res = await fetch('/api/profile/upload?type=' + tipo, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') {
            if (tipo === 'avatar') {
                MY_AVATAR = data.url;
                document.getElementById('profile-avatar-img').src = data.url;
                document.getElementById('composer-avatar').src = data.url;
            } else {
                document.getElementById('profile-banner').style.backgroundImage = `url('${data.url}')`;
            }
            mostrarToast(tipo === 'avatar' ? 'Foto atualizada!' : 'Capa atualizada!');
        } else {
            mostrarToast(data.message || 'Falha no upload.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
    input.value = '';
}

// ═══════════════════════════════════════════════════
//  JOGADO RECENTEMENTE
// ═══════════════════════════════════════════════════
function formatHours(minutes) {
    const h = Math.round((minutes || 0) / 60);
    return h + (h === 1 ? ' hora' : ' horas');
}

async function carregarRecentes() {
    const box = document.getElementById('recent-played');
    try {
        const res = await fetch('/api/steam/recent?count=3');
        const data = await res.json();
        if (data.status !== 'success' || !data.games || !data.games.length) {
            box.innerHTML = emptyMsg('Nenhuma sessão recente.', 'fa-gamepad');
            return;
        }
        box.innerHTML = data.games.slice(0, 3).map(g => {
            const pct = g.ach_total ? Math.round((g.ach_done / g.ach_total) * 100) : 0;
            const progress = g.ach_total
                ? `<div class="recent-progress">
                       <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
                       <span class="progress-num">${g.ach_done}/${g.ach_total}</span>
                   </div>`
                : '';
            return `
            <div class="recent-game">
                <img class="recent-cover" src="${g.img}" alt="" onerror="this.style.visibility='hidden'">
                <div class="recent-meta">
                    <p class="recent-name">${escapeHtml(g.name)}</p>
                    ${progress}
                    <p class="recent-hours"><i class="fa-brands fa-steam"></i> ${formatHours(g.playtime_forever)}</p>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Erro ao carregar sessões.', 'fa-triangle-exclamation');
    }
}

// ═══════════════════════════════════════════════════
//  AVALIAÇÕES (distribuição de notas)
// ═══════════════════════════════════════════════════
async function carregarRatings() {
    const box = document.getElementById('ratings-box');
    try {
        const res = await fetch('/api/reviews/ratings');
        const data = await res.json();
        if (data.status !== 'success' || !data.total) {
            box.innerHTML = emptyMsg('Não há avaliações', 'fa-star');
            return;
        }
        const dist = data.distribution;
        const total = data.total;
        let html = '';
        for (let star = 5; star >= 1; star--) {
            const c = dist[star] || 0;
            const pct = total ? Math.round((c / total) * 100) : 0;
            html += `
            <div class="rating-row">
                <span class="rating-star">${star} <i class="fa-solid fa-star"></i></span>
                <div class="rating-track"><div class="rating-fill" style="width:${pct}%"></div></div>
                <span class="rating-count">${c}</span>
            </div>`;
        }
        html += `<p class="rating-total">${total} ${total === 1 ? 'avaliação' : 'avaliações'}</p>`;
        box.innerHTML = html;
    } catch (e) {
        box.innerHTML = emptyMsg('Não há avaliações', 'fa-star');
    }
}

// ═══════════════════════════════════════════════════
//  PLATAFORMAS
// ═══════════════════════════════════════════════════
const PLATFORM_ICON = { steam: 'fa-brands fa-steam' };

async function carregarPlataformas() {
    const box = document.getElementById('platforms-box');
    try {
        const res = await fetch('/api/platforms');
        const data = await res.json();
        if (data.status !== 'success' || !data.platforms.length) {
            box.innerHTML = emptyMsg('Nenhuma plataforma conectada', 'fa-plug');
            return;
        }
        box.innerHTML = data.platforms.map(p => {
            const horas = Math.round((p.minutes || 0) / 60);
            const icon = PLATFORM_ICON[p.icon] || 'fa-solid fa-gamepad';
            return `
            <div class="platform-row">
                <span class="platform-name"><i class="${icon}"></i> ${escapeHtml(p.name)}</span>
                <div class="platform-track"><div class="platform-fill" style="width:${p.pct}%"></div></div>
                <span class="platform-meta">${p.games} jogos · ${horas}h</span>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Nenhuma plataforma conectada', 'fa-plug');
    }
}

// ═══════════════════════════════════════════════════
//  POSTS
// ═══════════════════════════════════════════════════
function renderPost(p) {
    return `
    <article class="post" data-id="${p.id}">
        <img class="post-avatar" src="${p.avatar}" alt="" onerror="this.src='${DEFAULT_AVATAR}'">
        <div class="post-body">
            <div class="post-head">
                <span class="post-name">${escapeHtml(p.name)}</span>
                <span class="post-time">· ${p.time}</span>
            </div>
            <p class="post-text">${escapeHtml(p.content)}</p>
            ${p.image_url ? `<img class="post-img" src="${p.image_url}" alt="">` : ''}
            <div class="post-actions">
                <button class="pact like-btn ${p.liked ? 'liked' : ''}" onclick="toggleLike(${p.id}, this)">
                    <i class="${p.liked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                    <span class="like-count">${p.likes}</span>
                </button>
            </div>
        </div>
    </article>`;
}

async function carregarPosts() {
    const box = document.getElementById('posts-list');
    try {
        const res = await fetch('/api/posts');
        const data = await res.json();
        if (data.status !== 'success' || !data.posts.length) {
            box.innerHTML = emptyMsg('Nenhum post ainda. Seja o primeiro!', 'fa-comment-dots');
            return;
        }
        box.innerHTML = data.posts.map(renderPost).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Erro ao carregar posts.', 'fa-triangle-exclamation');
    }
}

async function publicarPost() {
    const ta = document.getElementById('composer-text');
    const content = ta.value.trim();
    if (!content) { mostrarToast('Escreva algo para postar.', true); return; }
    try {
        const res = await fetch('/api/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.status === 'success') {
            ta.value = '';
            autoGrow(ta);
            mostrarToast('Post publicado!');
            carregarPosts();
            carregarTrending();      // hashtags podem mudar o trending
        } else {
            mostrarToast(data.message || 'Erro ao postar.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

async function toggleLike(postId, btn) {
    try {
        const res = await fetch('/api/posts/' + postId + '/like', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            btn.classList.toggle('liked', data.liked);
            btn.querySelector('i').className = (data.liked ? 'fa-solid' : 'fa-regular') + ' fa-heart';
            btn.querySelector('.like-count').textContent = data.likes;
        }
    } catch (e) { /* silencioso */ }
}

// ── Curtidas (aba) ───────────────────────────────────
async function carregarCurtidas() {
    const box = document.getElementById('curtidas-list');
    box.innerHTML = spinner;
    try {
        const res = await fetch('/api/posts/liked');
        const data = await res.json();
        if (data.status !== 'success' || !data.posts.length) {
            box.innerHTML = emptyMsg('Você ainda não curtiu nenhum post.', 'fa-heart');
            return;
        }
        box.innerHTML = data.posts.map(renderPost).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Erro ao carregar.', 'fa-triangle-exclamation');
    }
}

// ═══════════════════════════════════════════════════
//  REVIEWS
// ═══════════════════════════════════════════════════
function starsHtml(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<i class="${i <= n ? 'fa-solid' : 'fa-regular'} fa-star"></i>`;
    return s;
}

async function carregarReviews() {
    const box = document.getElementById('reviews-list');
    box.innerHTML = spinner;
    try {
        const res = await fetch('/api/reviews');
        const data = await res.json();
        if (data.status !== 'success' || !data.reviews.length) {
            box.innerHTML = emptyMsg('Não há avaliações', 'fa-star');
            return;
        }
        box.innerHTML = data.reviews.map(r => `
            <article class="review-card">
                ${r.cover ? `<img class="review-cover" src="${r.cover}" alt="" onerror="this.style.display='none'">` : ''}
                <div class="review-body">
                    <div class="review-head">
                        <span class="review-game">${escapeHtml(r.game_name || 'Jogo')}</span>
                        <span class="review-stars">${starsHtml(r.rating)}</span>
                    </div>
                    ${r.content ? `<p class="review-text">${escapeHtml(r.content)}</p>` : ''}
                    <span class="review-time">${r.time}</span>
                </div>
            </article>`).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Não há avaliações', 'fa-star');
    }
}

async function abrirNovaReview() {
    REVIEW_RATING = 0;
    pintarEstrelas(0);
    document.getElementById('review-text').value = '';
    const sel = document.getElementById('review-game');
    sel.innerHTML = '<option>Carregando...</option>';
    await garantirBiblioteca();
    if (!LIBRARY.length) {
        sel.innerHTML = '<option value="">Sincronize sua biblioteca primeiro</option>';
    } else {
        sel.innerHTML = LIBRARY.map(g =>
            `<option value="${g.appid}">${escapeHtml(g.name)}</option>`).join('');
    }
    abrirModal('modal-review');
}

function pintarEstrelas(n) {
    document.querySelectorAll('#review-stars i').forEach(st => {
        const v = parseInt(st.dataset.v, 10);
        st.className = (v <= n ? 'fa-solid' : 'fa-regular') + ' fa-star';
    });
}

// listener das estrelas (delegação)
const reviewStarsEl = document.getElementById('review-stars');
if (reviewStarsEl) {
    reviewStarsEl.addEventListener('click', e => {
        const st = e.target.closest('i');
        if (!st) return;
        REVIEW_RATING = parseInt(st.dataset.v, 10);
        pintarEstrelas(REVIEW_RATING);
    });
}

async function salvarReview() {
    if (!REVIEW_RATING) { mostrarToast('Escolha uma nota.', true); return; }
    const sel = document.getElementById('review-game');
    const appid = sel.value;
    if (!appid) { mostrarToast('Selecione um jogo.', true); return; }
    const game = LIBRARY.find(g => String(g.appid) === String(appid));
    const body = {
        appid: appid,
        game_name: game ? game.name : '',
        rating: REVIEW_RATING,
        content: document.getElementById('review-text').value.trim()
    };
    try {
        const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast('Avaliação publicada!');
            fecharModal('modal-review');
            tabsLoaded.reviews = false;
            carregarReviews(); tabsLoaded.reviews = true;
            carregarRatings();
        } else {
            mostrarToast(data.message || 'Erro ao avaliar.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

// ═══════════════════════════════════════════════════
//  JOGOS (aba) + BIBLIOTECA cache
// ═══════════════════════════════════════════════════
async function garantirBiblioteca() {
    if (LIBRARY.length) return LIBRARY;
    try {
        const res = await fetch('/api/steam/library');
        const data = await res.json();
        if (data.status === 'success') LIBRARY = data.games || [];
    } catch (e) { LIBRARY = []; }
    return LIBRARY;
}

async function carregarJogosTab() {
    const box = document.getElementById('jogos-grid');
    box.innerHTML = spinner;
    await garantirBiblioteca();
    if (!LIBRARY.length) {
        box.innerHTML = emptyMsg('Nenhum jogo na biblioteca. Sincronize na aba Biblioteca.', 'fa-gamepad');
        return;
    }
    box.innerHTML = LIBRARY.map(g => `
        <div class="jogo-mini" title="${escapeHtml(g.name)}">
            <img src="${g.cover}" alt="" onerror="this.src='${g.header}'">
            <span class="jogo-mini-name">${escapeHtml(g.name)}</span>
        </div>`).join('');
}

// ═══════════════════════════════════════════════════
//  JOGOS FAVORITOS (seletor)
// ═══════════════════════════════════════════════════
async function abrirSeletorFavoritos() {
    abrirModal('modal-fav');
    const grid = document.getElementById('fav-grid');
    grid.innerHTML = spinner;
    FAV_SELECTION = [];
    await garantirBiblioteca();
    if (!LIBRARY.length) {
        grid.innerHTML = emptyMsg('Sincronize sua biblioteca primeiro (aba Biblioteca).', 'fa-gamepad');
        atualizarContadorFav();
        return;
    }
    renderFavPicker(LIBRARY);
    atualizarContadorFav();
}

function renderFavPicker(list) {
    const grid = document.getElementById('fav-grid');
    grid.innerHTML = list.map(g => `
        <div class="fav-pick ${FAV_SELECTION.includes(String(g.appid)) ? 'selected' : ''}"
             data-appid="${g.appid}" onclick="toggleFav('${g.appid}', this)">
            <img src="${g.cover}" alt="" onerror="this.src='${g.header}'">
            <span class="fav-pick-check"><i class="fa-solid fa-check"></i></span>
            <span class="fav-pick-name">${escapeHtml(g.name)}</span>
        </div>`).join('');
}

function toggleFav(appid, el) {
    appid = String(appid);
    const idx = FAV_SELECTION.indexOf(appid);
    if (idx >= 0) {
        FAV_SELECTION.splice(idx, 1);
        el.classList.remove('selected');
    } else {
        if (FAV_SELECTION.length >= 3) {
            mostrarToast('Você só pode escolher 3 jogos.', true);
            return;
        }
        FAV_SELECTION.push(appid);
        el.classList.add('selected');
    }
    atualizarContadorFav();
}

function atualizarContadorFav() {
    document.getElementById('fav-counter').textContent =
        FAV_SELECTION.length + '/3 selecionados';
}

function filtrarBibliotecaFav(termo) {
    termo = (termo || '').toLowerCase().trim();
    const filtered = termo
        ? LIBRARY.filter(g => g.name.toLowerCase().includes(termo))
        : LIBRARY;
    renderFavPicker(filtered);
}

async function salvarFavoritos() {
    if (!FAV_SELECTION.length) { mostrarToast('Escolha pelo menos 1 jogo.', true); return; }
    try {
        const res = await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorites: FAV_SELECTION })
        });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast('Favoritos atualizados!');
            fecharModal('modal-fav');
            carregarPerfil();
        } else {
            mostrarToast(data.message || 'Erro ao salvar.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

// ═══════════════════════════════════════════════════
//  AMIGOS
// ═══════════════════════════════════════════════════
async function carregarAmigos() {
    const box = document.getElementById('friends-list');
    try {
        const res = await fetch('/api/steam/friends');
        const data = await res.json();
        if (data.status !== 'success' || !data.friends.length) {
            box.innerHTML = emptyMsg('Nenhum amigo encontrado.', 'fa-user-group');
            return;
        }
        box.innerHTML = data.friends.slice(0, 8).map(f => `
            <div class="friend">
                <div class="friend-av">
                    <img src="${f.avatar || DEFAULT_AVATAR}" alt="" onerror="this.src='${DEFAULT_AVATAR}'">
                    <span class="friend-dot ${f.online ? 'on' : 'off'}"></span>
                </div>
                <div class="friend-meta">
                    <span class="friend-name">${escapeHtml(f.name)}</span>
                    <span class="friend-status">${f.playing ? '<i class="fa-solid fa-gamepad"></i> ' + escapeHtml(f.playing) : (f.online ? 'Online' : 'Offline')}</span>
                </div>
            </div>`).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Não foi possível carregar amigos.', 'fa-user-group');
    }
}

// ═══════════════════════════════════════════════════
//  TRENDING
// ═══════════════════════════════════════════════════
async function carregarTrending() {
    const box = document.getElementById('trending-list');
    try {
        const res = await fetch('/api/trending');
        const data = await res.json();
        if (data.status !== 'success' || !data.topics.length) {
            box.innerHTML = emptyMsg('Nenhum trending ainda.', 'fa-hashtag');
            return;
        }
        box.innerHTML = data.topics.map((t, i) => `
            <div class="trend">
                <span class="trend-rank">#${i + 1}</span>
                <div class="trend-meta">
                    <span class="trend-tag">${escapeHtml(t.tag)}</span>
                    <span class="trend-count">${t.count} ${t.count === 1 ? 'menção' : 'menções'}</span>
                </div>
            </div>`).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Nenhum trending ainda.', 'fa-hashtag');
    }
}

// ═══════════════════════════════════════════════════
//  MODAIS
// ═══════════════════════════════════════════════════
function abrirModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('open');
}
function fecharModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
}
// fecha ao clicar fora
document.querySelectorAll('.pmodal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
});

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
carregarPerfil();
carregarRecentes();
carregarRatings();
carregarPlataformas();
carregarPosts();
carregarAmigos();
carregarTrending();
