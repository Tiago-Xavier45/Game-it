/* ═══════════════════════════════════════════════════════
   GAME IT — profile.js  (rede social funcional)
═══════════════════════════════════════════════════════ */

const htmlRoot = document.getElementById('html-root');
const DEFAULT_AVATAR = '/static/img/Game It Logo.svg';

// estado em memória
let LIBRARY = [];          // biblioteca da Steam (cache)
let FAV_SELECTION = [];    // appids selecionados no modal de favoritos
let REVIEW_RATING = 0;     // estrelas escolhidas no modal de review
let REVIEW_GAME = null;    // jogo selecionado para a review
let REVIEW_STATUS = 'Completed';
let MY_AVATAR = DEFAULT_AVATAR;
let CURRENT_LIST_ID = null;     // lista aberta no detalhe
let ADDJOGOS_SELECTION = [];    // appids para adicionar à lista
let JOGOS_VIEW = 'grid';        // grade ou lista na aba Jogos
let JOGOS_SELECT_MODE = false;  // modo de seleção p/ criar lista
let JOGOS_SELECTION = [];        // appids selecionados na aba Jogos
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

// URL segura para uso em src="" (previne XSS por javascript:/aspas)
function safeUrl(url) {
    if (!url) return DEFAULT_AVATAR;
    const s = String(url);
    if (s.startsWith('/static/') || s.startsWith('https://') || s.startsWith('http://')) {
        return s.replace(/"/g, '%22');
    }
    return DEFAULT_AVATAR;
}

// Ícone Font Awesome por plataforma
const PLATFORM_FA = {
    steam: 'fa-brands fa-steam',
    epic: 'fa-solid fa-e',
    xbox: 'fa-brands fa-xbox',
    playstation: 'fa-brands fa-playstation',
    nintendo: 'fa-solid fa-gamepad',
    other: 'fa-solid fa-gamepad'
};
function platformIcon(p) {
    return PLATFORM_FA[p] || 'fa-solid fa-gamepad';
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
    if (tab === 'listas' && !tabsLoaded.listas) { carregarListas(); tabsLoaded.listas = true; }
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
            html += `<a href="/jogo/${encodeURIComponent(f.appid)}" class="fav-cover" title="${escapeHtml(f.name)}">
                        <img src="${safeUrl(f.cover)}" alt="${escapeHtml(f.name)}" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
                     </a>`;
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
            <div class="recent-game" onclick="abrirJogo('${g.appid}')" style="cursor:pointer;">
                <img class="recent-cover" src="${safeUrl(g.img)}" alt="" onerror="this.style.visibility='hidden'">
                <div class="recent-meta">
                    <p class="recent-name">${escapeHtml(g.name)} <span class="plat-inline" title="${escapeHtml(g.platform || 'steam')}"><i class="${platformIcon(g.platform || 'steam')}"></i></span></p>
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
        <img class="post-avatar" src="${safeUrl(p.avatar)}" alt="" onerror="this.src='${DEFAULT_AVATAR}'">
        <div class="post-body">
            <div class="post-head">
                <span class="post-name">${escapeHtml(p.name)}</span>
                <span class="post-time">· ${escapeHtml(p.time)}</span>
            </div>
            <p class="post-text">${escapeHtml(p.content)}</p>
            ${p.image_url ? `<img class="post-img" src="${safeUrl(p.image_url)}" alt="">` : ''}
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
                ${r.cover ? `<img class="review-cover" src="${safeUrl(r.cover)}" alt="" onclick="abrirJogo('${r.appid}')" style="cursor:pointer;" onerror="this.style.display='none'">` : ''}
                <div class="review-body">
                    <div class="review-head">
                        <span class="review-game" onclick="abrirJogo('${r.appid}')" style="cursor:pointer;">${escapeHtml(r.game_name || 'Jogo')}
                            <span class="plat-inline" title="${escapeHtml(r.platform || 'steam')}"><i class="${platformIcon(r.platform || 'steam')}"></i></span>
                            ${r.platinum ? '<span class="plat-badge-gold" title="Platinado"><i class="fa-solid fa-gamepad"></i></span>' : ''}
                            ${r.replay ? '<span class="replay-badge" title="Rejogada"><i class="fa-solid fa-rotate-right"></i></span>' : ''}
                        </span>
                        <span class="review-stars">${starsHtml(r.rating)}</span>
                    </div>
                    <div class="review-sub">
                        <span class="review-status">${REVIEW_STATUS_LABEL[r.status] || r.status}</span>
                        ${r.started_at ? `<span class="review-date"><i class="fa-regular fa-calendar"></i> ${formatarDataReview(r.started_at)}</span>` : ''}
                    </div>
                    ${r.spoilers ? '<span class="spoiler-tag"><i class="fa-solid fa-triangle-exclamation"></i> Contém spoilers</span>' : ''}
                    ${r.content ? `<p class="review-text">${escapeHtml(r.content)}</p>` : ''}
                    <div class="review-foot">
                        <button class="gr-like ${r.liked ? 'liked' : ''}" onclick="curtirReview(${r.id}, this)">
                            <i class="fa-${r.liked ? 'solid' : 'regular'} fa-heart"></i>
                            <span class="gr-like-count">${r.likes}</span>
                        </button>
                        <span class="review-time">${escapeHtml(r.time)}</span>
                        <button class="gr-del" onclick="excluirReview(${r.id})" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </article>`).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Não há avaliações', 'fa-star');
    }
}

const REVIEW_STATUS_LABEL = {
    Completed: 'Jogado', Playing: 'Jogando', Backlog: 'Backlog', Wishlist: 'Wishlist'
};

function formatarDataReview(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function curtirReview(reviewId, btn) {
    try {
        const res = await fetch('/api/reviews/' + reviewId + '/like', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            btn.classList.toggle('liked', data.liked);
            btn.querySelector('i').className = 'fa-' + (data.liked ? 'solid' : 'regular') + ' fa-heart';
            btn.querySelector('.gr-like-count').textContent = data.likes;
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

async function excluirReview(reviewId) {
    if (!confirm('Excluir esta avaliação?')) return;
    try {
        const res = await fetch('/api/reviews/' + reviewId, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast('Avaliação excluída.');
            tabsLoaded.reviews = false;
            carregarReviews(); tabsLoaded.reviews = true;
            carregarRatings();
        } else {
            mostrarToast(data.message || 'Erro ao excluir.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

// ── Review: passo 1 (escolher jogo) ──────────────────
async function abrirNovaReview() {
    REVIEW_GAME = null;
    REVIEW_STATUS = 'Completed';
    voltarSelecaoReview();
    abrirModal('modal-review');
    const grid = document.getElementById('review-grid');
    grid.innerHTML = spinner;
    await garantirBiblioteca();
    if (!LIBRARY.length) {
        grid.innerHTML = emptyMsg('Sincronize sua biblioteca primeiro (aba Biblioteca).', 'fa-gamepad');
        return;
    }
    renderReviewPicker(LIBRARY);
}

function renderReviewPicker(list) {
    const grid = document.getElementById('review-grid');
    grid.innerHTML = list.map(g => `
        <div class="fav-pick" data-appid="${g.appid}" onclick="selecionarJogoReview('${g.appid}')">
            <span class="plat-badge"><i class="${platformIcon(g.platform || 'steam')}"></i></span>
            <img src="${safeUrl(g.cover)}" alt="" onerror="this.onerror=null;this.src='${safeUrl(g.header) || DEFAULT_AVATAR}'">
            <span class="fav-pick-name">${escapeHtml(g.name)}</span>
        </div>`).join('');
}

function filtrarBibliotecaReview(termo) {
    termo = (termo || '').toLowerCase().trim();
    const filtered = termo ? LIBRARY.filter(g => g.name.toLowerCase().includes(termo)) : LIBRARY;
    renderReviewPicker(filtered);
}

function selecionarJogoReview(appid) {
    REVIEW_GAME = LIBRARY.find(g => String(g.appid) === String(appid));
    if (!REVIEW_GAME) return;
    REVIEW_RATING = 0;
    pintarEstrelas(0);
    document.getElementById('review-text').value = '';
    document.getElementById('review-spoilers').checked = false;
    document.getElementById('review-replay').checked = false;
    document.getElementById('review-date').value = hojeISO();
    document.getElementById('review-platform').value = REVIEW_GAME.platform || 'steam';
    document.getElementById('review-cover-img').src = safeUrl(REVIEW_GAME.cover);
    document.getElementById('review-modal-title').textContent = REVIEW_GAME.name;
    // dica de platinado automático
    const note = document.getElementById('review-platinum-note');
    if (note) note.style.display = (REVIEW_GAME.status === '100%') ? 'block' : 'none';
    // status default
    REVIEW_STATUS = 'Completed';
    document.querySelectorAll('#review-step-form .rstatus').forEach(b =>
        b.classList.toggle('active', b.dataset.st === 'Completed'));
    // troca de passo
    document.getElementById('review-step-pick').style.display = 'none';
    document.getElementById('review-step-form').style.display = 'flex';
}

function hojeISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function voltarSelecaoReview() {
    document.getElementById('review-modal-title').textContent = 'Escolha um jogo para avaliar';
    document.getElementById('review-step-form').style.display = 'none';
    document.getElementById('review-step-pick').style.display = 'flex';
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

// listener dos botões de status (Completo/Jogando/...)
document.querySelectorAll('#review-step-form .rstatus').forEach(btn => {
    btn.addEventListener('click', () => {
        REVIEW_STATUS = btn.dataset.st;
        document.querySelectorAll('#review-step-form .rstatus').forEach(b =>
            b.classList.toggle('active', b === btn));
    });
});

async function salvarReview() {
    if (!REVIEW_GAME) { mostrarToast('Selecione um jogo.', true); return; }
    if (!REVIEW_RATING) { mostrarToast('Escolha uma nota.', true); return; }
    const body = {
        appid: REVIEW_GAME.appid,
        game_name: REVIEW_GAME.name,
        rating: REVIEW_RATING,
        platform: document.getElementById('review-platform').value,
        spoilers: document.getElementById('review-spoilers').checked,
        replay: document.getElementById('review-replay').checked,
        started_at: document.getElementById('review-date').value || null,
        status: REVIEW_STATUS,
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
        document.getElementById('jogos-contador').textContent = '';
        return;
    }
    await montarFiltroJogos();
    filtrarJogos();
}

// Monta o dropdown: plataformas extras + listas personalizadas do usuário
async function montarFiltroJogos() {
    const sel = document.getElementById('jogos-filtro');
    if (!sel) return;
    const atual = sel.value;

    // Remove opções/grupos adicionados dinamicamente
    sel.querySelectorAll('[data-dyn="1"]').forEach(el => el.remove());

    // Plataformas além de steam (steam já é fixo no HTML)
    const plats = [...new Set(LIBRARY.map(g => (g.platform || 'steam')))]
        .filter(p => p !== 'steam').sort();
    plats.forEach(p => {
        const opt = document.createElement('option');
        opt.value = 'plat:' + p;
        opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
        opt.dataset.dyn = '1';
        sel.appendChild(opt);
    });

    // Listas personalizadas do usuário
    try {
        const res = await fetch('/api/lists');
        const data = await res.json();
        const custom = (data.lists || []).filter(l => l.kind === 'custom');
        if (custom.length) {
            const grp = document.createElement('optgroup');
            grp.label = 'Minhas listas';
            grp.dataset.dyn = '1';
            custom.forEach(l => {
                const opt = document.createElement('option');
                opt.value = 'list:' + l.id;
                opt.textContent = l.title + ' (' + l.count + ')';
                grp.appendChild(opt);
            });
            sel.appendChild(grp);
        }
    } catch (e) { /* silencioso */ }

    // Mantém a seleção anterior se ainda existir
    if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
}

async function getListGames(listId) {
    try {
        const res = await fetch('/api/lists/' + listId);
        const data = await res.json();
        if (data.status === 'success') return data.list.games || [];
    } catch (e) { /* silencioso */ }
    return [];
}

async function filtrarJogos() {
    const filtro = document.getElementById('jogos-filtro').value;
    let lista = LIBRARY;
    if (filtro === 'backlog') {
        lista = LIBRARY.filter(g => !(g.playtime_forever > 0));
    } else if (filtro === 'az') {
        lista = [...LIBRARY].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (filtro.startsWith('plat:')) {
        const p = filtro.slice(5);
        lista = LIBRARY.filter(g => (g.platform || 'steam') === p);
    } else if (filtro.startsWith('list:')) {
        lista = await getListGames(filtro.slice(5));
    }
    renderJogos(lista);
}

function renderJogos(lista) {
    const box = document.getElementById('jogos-grid');
    document.getElementById('jogos-contador').textContent =
        lista.length + (lista.length === 1 ? ' jogo' : ' jogos');
    if (!lista.length) {
        box.innerHTML = emptyMsg('Nenhum jogo nesse filtro.', 'fa-filter');
        return;
    }
    const sel = JOGOS_SELECT_MODE;
    if (JOGOS_VIEW === 'list' && !sel) {
        box.className = 'jogos-list';
        box.innerHTML = lista.map(g => `
            <div class="jogo-row" onclick="abrirJogo('${g.appid}')" title="${escapeHtml(g.name)}">
                <img src="${safeUrl(g.header)}" alt="" onerror="this.style.visibility='hidden'">
                <span class="jogo-row-name">${escapeHtml(g.name)}</span>
                <span class="plat-inline" title="${escapeHtml(g.platform || 'steam')}"><i class="${platformIcon(g.platform || 'steam')}"></i></span>
                <i class="fa-solid fa-chevron-right jogo-row-arrow"></i>
            </div>`).join('');
    } else {
        box.className = 'jogos-mini-grid';
        box.innerHTML = lista.map(g => {
            const isSel = JOGOS_SELECTION.includes(String(g.appid));
            const click = sel ? `toggleSelecionarJogo('${g.appid}', this)` : `abrirJogo('${g.appid}')`;
            return `
            <div class="jogo-mini ${sel ? 'selectable' : ''} ${isSel ? 'selected' : ''}"
                 onclick="${click}" title="${escapeHtml(g.name)}">
                <span class="plat-badge" title="${escapeHtml(g.platform || 'steam')}"><i class="${platformIcon(g.platform || 'steam')}"></i></span>
                ${sel ? '<span class="jogo-check"><i class="fa-solid fa-check"></i></span>' : ''}
                <img src="${safeUrl(g.cover)}" alt="" onerror="this.onerror=null;this.src='${safeUrl(g.header) || DEFAULT_AVATAR}'">
                <span class="jogo-mini-name">${escapeHtml(g.name)}</span>
            </div>`;
        }).join('');
    }
}

function setJogosView(view) {
    JOGOS_VIEW = view;
    document.getElementById('view-grid').classList.toggle('active', view === 'grid');
    document.getElementById('view-list').classList.toggle('active', view === 'list');
    filtrarJogos();
}

function abrirJogo(appid) {
    window.location.href = '/jogo/' + encodeURIComponent(appid);
}

// ── Modo de seleção para criar lista personalizada ───
function toggleSelecaoJogos() {
    JOGOS_SELECT_MODE ? cancelarSelecaoJogos() : iniciarSelecaoJogos();
}

function iniciarSelecaoJogos() {
    JOGOS_SELECT_MODE = true;
    JOGOS_SELECTION = [];
    document.getElementById('jogos-selecao-bar').style.display = 'flex';
    document.getElementById('btn-criar-lista').classList.add('active');
    document.getElementById('jogos-lista-titulo').value = '';
    atualizarContadorSelecao();
    filtrarJogos();
}

function cancelarSelecaoJogos() {
    JOGOS_SELECT_MODE = false;
    JOGOS_SELECTION = [];
    document.getElementById('jogos-selecao-bar').style.display = 'none';
    document.getElementById('btn-criar-lista').classList.remove('active');
    filtrarJogos();
}

function toggleSelecionarJogo(appid, el) {
    appid = String(appid);
    const i = JOGOS_SELECTION.indexOf(appid);
    if (i >= 0) { JOGOS_SELECTION.splice(i, 1); el.classList.remove('selected'); }
    else { JOGOS_SELECTION.push(appid); el.classList.add('selected'); }
    atualizarContadorSelecao();
}

function atualizarContadorSelecao() {
    const n = JOGOS_SELECTION.length;
    document.getElementById('jogos-sel-count').textContent =
        n + (n === 1 ? ' selecionado' : ' selecionados');
}

async function salvarListaSelecao() {
    const title = document.getElementById('jogos-lista-titulo').value.trim();
    if (!title) { mostrarToast('Dê um nome à lista.', true); return; }
    if (!JOGOS_SELECTION.length) { mostrarToast('Selecione pelo menos 1 jogo.', true); return; }
    try {
        const res = await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, kind: 'custom', platform: null })
        });
        const data = await res.json();
        if (data.status !== 'success') {
            mostrarToast(data.message || 'Erro ao criar lista.', true);
            return;
        }
        const games = JOGOS_SELECTION.map(appid => {
            const g = LIBRARY.find(x => String(x.appid) === String(appid));
            return { appid, name: g ? g.name : '' };
        });
        await fetch('/api/lists/' + data.id + '/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ games })
        });
        mostrarToast('Lista criada com ' + games.length + ' jogos!');
        cancelarSelecaoJogos();
        await montarFiltroJogos();
        tabsLoaded.listas = false;
    } catch (e) { mostrarToast('Erro de conexão.', true); }
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
            <img src="${g.cover}" alt="" onerror="this.onerror=null;this.src='${g.header || DEFAULT_AVATAR}'">
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
                    <img src="${safeUrl(f.avatar)}" alt="" onerror="this.src='${DEFAULT_AVATAR}'">
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
//  LISTAS
// ═══════════════════════════════════════════════════
async function carregarListas() {
    const box = document.getElementById('listas-grid');
    box.innerHTML = spinner;
    try {
        const res = await fetch('/api/lists');
        const data = await res.json();
        if (data.status !== 'success' || !data.lists.length) {
            box.innerHTML = emptyMsg('Nenhuma lista ainda. Crie a primeira!', 'fa-list');
            return;
        }
        box.innerHTML = data.lists.map(l => {
            const covers = (l.preview || []).slice(0, 4).map(c =>
                `<img src="${safeUrl(c)}" alt="" onerror="this.style.visibility='hidden'">`).join('');
            return `
            <div class="lista-card" onclick="abrirLista(${l.id})">
                <div class="lista-preview">${covers || '<div class="lista-preview-empty"><i class="fa-solid fa-list"></i></div>'}</div>
                <div class="lista-info">
                    <span class="lista-title">${escapeHtml(l.title)} <span class="lista-count">${l.count} ${l.count === 1 ? 'jogo' : 'jogos'}</span></span>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = emptyMsg('Erro ao carregar listas.', 'fa-triangle-exclamation');
    }
}

function abrirNovaLista() {
    document.getElementById('lista-title').value = '';
    abrirModal('modal-lista');
}

async function salvarLista() {
    const title = document.getElementById('lista-title').value.trim();
    if (!title) { mostrarToast('Dê um título à lista.', true); return; }
    try {
        const res = await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, kind: 'custom', platform: null })
        });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast('Lista criada!');
            fecharModal('modal-lista');
            carregarListas();
            // abre direto para o usuário adicionar jogos
            abrirLista(data.id);
        } else {
            mostrarToast(data.message || 'Erro ao criar lista.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
}

async function abrirLista(listId) {
    CURRENT_LIST_ID = listId;
    abrirModal('modal-lista-detalhe');
    const grid = document.getElementById('ld-grid');
    grid.innerHTML = spinner;
    document.getElementById('ld-title').textContent = 'Carregando...';
    document.getElementById('ld-count').textContent = '';
    try {
        const res = await fetch('/api/lists/' + listId);
        const data = await res.json();
        if (data.status !== 'success') {
            grid.innerHTML = emptyMsg('Lista não encontrada.', 'fa-triangle-exclamation');
            return;
        }
        const l = data.list;
        document.getElementById('ld-title').textContent = l.title;
        document.getElementById('ld-count').textContent = `${l.count} ${l.count === 1 ? 'jogo' : 'jogos'}`;
        if (!l.games.length) {
            grid.innerHTML = emptyMsg('Lista vazia. Adicione jogos!', 'fa-gamepad');
            return;
        }
        grid.innerHTML = l.games.map(g => `
            <div class="jogo-mini" title="${escapeHtml(g.name)}" onclick="abrirJogo('${g.appid}')">
                <span class="plat-badge"><i class="${platformIcon(g.platform || 'steam')}"></i></span>
                <button class="jogo-remove" title="Remover" onclick="removerJogoLista('${g.appid}', event)"><i class="fa-solid fa-xmark"></i></button>
                <img src="${safeUrl(g.cover)}" alt="" onerror="this.onerror=null;this.src='${safeUrl(g.header) || DEFAULT_AVATAR}'">
                <span class="jogo-mini-name">${escapeHtml(g.name)}</span>
            </div>`).join('');
    } catch (e) {
        grid.innerHTML = emptyMsg('Erro ao carregar.', 'fa-triangle-exclamation');
    }
}

async function removerJogoLista(appid, ev) {
    if (ev) ev.stopPropagation();
    if (!CURRENT_LIST_ID) return;
    try {
        const res = await fetch(`/api/lists/${CURRENT_LIST_ID}/games/${encodeURIComponent(appid)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            abrirLista(CURRENT_LIST_ID);
            carregarListas();
        }
    } catch (e) { mostrarToast('Erro ao remover.', true); }
}

async function excluirListaAtual() {
    if (!CURRENT_LIST_ID) return;
    if (!confirm('Excluir esta lista? Esta ação não pode ser desfeita.')) return;
    try {
        const res = await fetch('/api/lists/' + CURRENT_LIST_ID, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast('Lista excluída.');
            fecharModal('modal-lista-detalhe');
            carregarListas();
        }
    } catch (e) { mostrarToast('Erro ao excluir.', true); }
}

// ── Adicionar jogos à lista ──────────────────────────
async function abrirAddJogosLista() {
    ADDJOGOS_SELECTION = [];
    atualizarContadorAddJogos();
    abrirModal('modal-add-jogos');
    const grid = document.getElementById('addjogos-grid');
    grid.innerHTML = spinner;
    await garantirBiblioteca();
    if (!LIBRARY.length) {
        grid.innerHTML = emptyMsg('Sincronize sua biblioteca primeiro.', 'fa-gamepad');
        return;
    }
    renderAddJogos(LIBRARY);
}

function renderAddJogos(list) {
    const grid = document.getElementById('addjogos-grid');
    grid.innerHTML = list.map(g => `
        <div class="fav-pick ${ADDJOGOS_SELECTION.includes(String(g.appid)) ? 'selected' : ''}"
             data-appid="${g.appid}" onclick="toggleAddJogo('${g.appid}', this)">
            <span class="plat-badge"><i class="${platformIcon(g.platform || 'steam')}"></i></span>
            <img src="${safeUrl(g.cover)}" alt="" onerror="this.src='${safeUrl(g.header)}'">
            <span class="fav-pick-check"><i class="fa-solid fa-check"></i></span>
            <span class="fav-pick-name">${escapeHtml(g.name)}</span>
        </div>`).join('');
}

function toggleAddJogo(appid, el) {
    appid = String(appid);
    const idx = ADDJOGOS_SELECTION.indexOf(appid);
    if (idx >= 0) { ADDJOGOS_SELECTION.splice(idx, 1); el.classList.remove('selected'); }
    else { ADDJOGOS_SELECTION.push(appid); el.classList.add('selected'); }
    atualizarContadorAddJogos();
}

function atualizarContadorAddJogos() {
    document.getElementById('addjogos-counter').textContent =
        ADDJOGOS_SELECTION.length + ' selecionados';
}

function filtrarAddJogos(termo) {
    termo = (termo || '').toLowerCase().trim();
    const filtered = termo ? LIBRARY.filter(g => g.name.toLowerCase().includes(termo)) : LIBRARY;
    renderAddJogos(filtered);
}

async function salvarAddJogos() {
    if (!CURRENT_LIST_ID) return;
    if (!ADDJOGOS_SELECTION.length) { mostrarToast('Selecione pelo menos 1 jogo.', true); return; }
    const games = ADDJOGOS_SELECTION.map(appid => {
        const g = LIBRARY.find(x => String(x.appid) === String(appid));
        return { appid: appid, name: g ? g.name : '' };
    });
    try {
        const res = await fetch(`/api/lists/${CURRENT_LIST_ID}/games`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ games })
        });
        const data = await res.json();
        if (data.status === 'success') {
            mostrarToast(`${data.added} jogo(s) adicionado(s)!`);
            fecharModal('modal-add-jogos');
            abrirLista(CURRENT_LIST_ID);
            carregarListas();
        } else {
            mostrarToast(data.message || 'Erro ao adicionar.', true);
        }
    } catch (e) { mostrarToast('Erro de conexão.', true); }
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
