/* ═══════════════════════════════════════════════════════
   GAME IT — game.js  (página de perfil do jogo)
═══════════════════════════════════════════════════════ */

const APPID = window.APPID;
const DEFAULT_COVER = '/static/img/Game It Logo.svg';

let GAME = null;
let USER_STATUS = { status: null, started_at: null, replay_count: 0, platinum: false };

const STATUS_LABELS = {
    jogando: 'Jogando', jogado: 'Jogado', backlog: 'Backlog',
    wishlist: 'Wishlist', platinado: 'Platinado'
};

// ── UTIL ─────────────────────────────────────────────
function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function safeUrl(url) {
    if (!url) return DEFAULT_COVER;
    const s = String(url);
    if (s.startsWith('/static/') || s.startsWith('https://') || s.startsWith('http://')) {
        return s.replace(/"/g, '%22');
    }
    return DEFAULT_COVER;
}
function starsHtml(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<i class="${i <= n ? 'fa-solid' : 'fa-regular'} fa-star"></i>`;
    return s;
}

let toastTimer;
function toast(msg, isError) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── CARREGAR PÁGINA ──────────────────────────────────
async function carregarJogo() {
    if (!APPID) {
        toast('ID do jogo inválido.', true);
        return;
    }
    try {
        const res = await fetch('/api/game/' + encodeURIComponent(APPID));
        if (res.status === 401) { window.location.href = '/login'; return; }
        const data = await res.json();
        if (data.status !== 'success') {
            toast(data.message || 'Erro ao carregar jogo.', true);
            return;
        }
        GAME = data.game;
        USER_STATUS = data.user_status || USER_STATUS;
        renderHero(data);
        renderStatus(data.user_status);
        renderCounts(data.status_counts);
        renderReviews(data.reviews);
    } catch (e) {
        toast('Erro de conexão.', true);
    }
}

function renderHero(data) {
    const g = data.game;
    document.title = 'Game It | ' + (g.name || 'Jogo');

    // Cadeia de fallback da capa: cover → header → logo padrão (sem loop)
    const cover = document.getElementById('game-cover');
    const coverChain = [safeUrl(g.cover), safeUrl(g.header), DEFAULT_COVER]
        .filter((v, i, a) => v && a.indexOf(v) === i);
    let coverIdx = 0;
    cover.onerror = function () {
        coverIdx++;
        if (coverIdx < coverChain.length) {
            this.src = coverChain[coverIdx];
        } else {
            this.onerror = null;
        }
    };
    cover.src = coverChain[0];

    // Fundo desfocado: só aplica se a imagem realmente carregar (evita header.jpg 404)
    const bg = document.getElementById('game-hero-bg');
    const bgCandidates = [safeUrl(g.header), safeUrl(g.cover)].filter(u => u && u !== DEFAULT_COVER);
    (function tryBg(i) {
        if (i >= bgCandidates.length) return;
        const probe = new Image();
        probe.onload = () => { bg.style.backgroundImage = `url("${bgCandidates[i]}")`; };
        probe.onerror = () => tryBg(i + 1);
        probe.src = bgCandidates[i];
    })(0);

    document.getElementById('game-name').textContent = g.name || ('Jogo ' + APPID);

    document.getElementById('game-genres').innerHTML =
        (g.genres || []).map(gen => `<span class="genre-chip">${escapeHtml(gen)}</span>`).join('');

    const metaParts = [];
    if (g.release) metaParts.push(g.release);
    if (g.developers && g.developers.length) metaParts.push(g.developers.join(', '));
    document.getElementById('game-meta').textContent = metaParts.join(' · ');
    document.getElementById('game-desc').textContent = g.description || '';

    // Média Game It
    const sc = document.getElementById('score-community');
    if (data.community_avg != null) {
        sc.innerHTML = data.community_avg.toFixed(1) + ' <i class="fa-solid fa-star" style="font-size:.7em;color:#fbbf24;"></i>';
        document.getElementById('score-community-sub').textContent =
            `${data.community_count} ${data.community_count === 1 ? 'avaliação' : 'avaliações'}`;
    } else {
        sc.textContent = '—';
        document.getElementById('score-community-sub').textContent = 'Sem avaliações';
    }

    // Steam
    const ss = document.getElementById('score-steam');
    if (g.steam_positive_pct != null) {
        ss.textContent = g.steam_positive_pct + '%';
        document.getElementById('score-steam-sub').textContent = g.steam_score_desc || '';
    } else {
        ss.textContent = '—';
        document.getElementById('score-steam-sub').textContent = g.steam_score_desc || 'Indisponível';
    }
}

function renderStatus(us) {
    USER_STATUS = us || USER_STATUS;
    document.querySelectorAll('.status-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.st === USER_STATUS.status));
    document.getElementById('status-date').value = USER_STATUS.started_at || '';
    document.getElementById('replay-count').textContent = USER_STATUS.replay_count || 0;

    const info = document.getElementById('played-info');
    const parts = [];
    if (USER_STATUS.played) {
        const h = Math.round((USER_STATUS.played_minutes || 0) / 60);
        parts.push(`<i class="fa-solid fa-clock"></i> ${h}h jogadas na Steam`);
    }
    if (USER_STATUS.platinum) {
        parts.push('<i class="fa-solid fa-gamepad" style="color:#fbbf24;"></i> Platinado (100% das conquistas)');
    }
    info.innerHTML = parts.join(' &nbsp;·&nbsp; ');
}

function renderCounts(c) {
    c = c || {};
    ['jogando', 'jogado', 'backlog', 'wishlist', 'platinado'].forEach(s => {
        const el = document.getElementById('cnt-' + s);
        if (el) el.textContent = c[s] || 0;
    });
}

function renderReviews(reviews) {
    const box = document.getElementById('game-reviews');
    if (!reviews || !reviews.length) {
        box.innerHTML = '<div class="empty-panel"><i class="fa-solid fa-comments"></i><p>Nenhuma avaliação ainda. Seja o primeiro!</p></div>';
        return;
    }
    box.innerHTML = reviews.map(r => `
        <article class="gr-card">
            <img class="gr-avatar" src="${safeUrl(r.avatar)}" alt="" onerror="this.src='${DEFAULT_COVER}'">
            <div class="gr-body">
                <div class="gr-head">
                    <span class="gr-author">${escapeHtml(r.author)}</span>
                    <span class="gr-stars">${starsHtml(r.rating)}</span>
                    ${r.platinum ? '<span class="plat-badge-gold" title="Platinado"><i class="fa-solid fa-gamepad"></i></span>' : ''}
                    ${r.replay ? '<span class="replay-badge" title="Rejogada"><i class="fa-solid fa-rotate-right"></i></span>' : ''}
                </div>
                <div class="gr-sub">
                    <span class="gr-status">${STATUS_LABELS[mapStatus(r.status)] || r.status}</span>
                    ${r.started_at ? `<span class="gr-date"><i class="fa-regular fa-calendar"></i> ${formatarData(r.started_at)}</span>` : ''}
                    <span class="gr-time">${escapeHtml(r.time)}</span>
                </div>
                ${r.spoilers ? '<span class="spoiler-tag"><i class="fa-solid fa-triangle-exclamation"></i> Contém spoilers</span>' : ''}
                ${r.content ? `<p class="gr-text">${escapeHtml(r.content)}</p>` : ''}
                <div class="gr-actions">
                    <button class="gr-like ${r.liked ? 'liked' : ''}" onclick="curtirReview(${r.id}, this)">
                        <i class="fa-${r.liked ? 'solid' : 'regular'} fa-heart"></i>
                        <span class="gr-like-count">${r.likes}</span>
                    </button>
                    ${r.is_mine ? `<button class="gr-del" onclick="excluirReview(${r.id})"><i class="fa-solid fa-trash"></i> Excluir</button>` : ''}
                </div>
            </div>
        </article>`).join('');
}

function mapStatus(s) {
    const m = { Completed: 'jogado', Playing: 'jogando', Backlog: 'backlog', Wishlist: 'wishlist' };
    return m[s] || s;
}

// ── AÇÕES DE STATUS ──────────────────────────────────
async function definirStatus(status) {
    await enviarStatus({ status });
    USER_STATUS.status = status;
    document.querySelectorAll('.status-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.st === status));
    toast('Status atualizado!');
    // recarrega contagem
    atualizarContagem();
}

async function salvarExtra() {
    if (!USER_STATUS.status) {
        toast('Escolha um status primeiro.', true);
        return;
    }
    const date = document.getElementById('status-date').value;
    await enviarStatus({ status: USER_STATUS.status, started_at: date || null,
                         replay_count: USER_STATUS.replay_count });
    USER_STATUS.started_at = date || null;
    toast('Salvo!');
}

function ajustarReplay(delta) {
    let n = (USER_STATUS.replay_count || 0) + delta;
    if (n < 0) n = 0;
    if (n > 99) n = 99;
    USER_STATUS.replay_count = n;
    document.getElementById('replay-count').textContent = n;
    if (USER_STATUS.status) {
        enviarStatus({ status: USER_STATUS.status,
                       started_at: document.getElementById('status-date').value || null,
                       replay_count: n });
    }
}

async function enviarStatus(extra) {
    const body = Object.assign({
        game_name: GAME ? GAME.name : null,
        platform: 'steam'
    }, extra);
    try {
        const res = await fetch('/api/game/' + encodeURIComponent(APPID) + '/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.status === 'success' && data.platinum) {
            USER_STATUS.platinum = true;
            renderStatus(USER_STATUS);
        }
        return data;
    } catch (e) {
        toast('Erro de conexão.', true);
        return { status: 'error' };
    }
}

async function atualizarContagem() {
    try {
        const res = await fetch('/api/game/' + encodeURIComponent(APPID));
        const data = await res.json();
        if (data.status === 'success') renderCounts(data.status_counts);
    } catch (e) { /* silencioso */ }
}

// ── LIKE / EXCLUIR REVIEW ────────────────────────────
async function curtirReview(reviewId, btn) {
    try {
        const res = await fetch('/api/reviews/' + reviewId + '/like', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            btn.classList.toggle('liked', data.liked);
            btn.querySelector('i').className = 'fa-' + (data.liked ? 'solid' : 'regular') + ' fa-heart';
            btn.querySelector('.gr-like-count').textContent = data.likes;
        }
    } catch (e) { toast('Erro de conexão.', true); }
}

async function excluirReview(reviewId) {
    if (!confirm('Excluir esta avaliação?')) return;
    try {
        const res = await fetch('/api/reviews/' + reviewId, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            toast('Avaliação excluída.');
            carregarJogo();
        } else {
            toast(data.message || 'Erro ao excluir.', true);
        }
    } catch (e) { toast('Erro de conexão.', true); }
}

document.addEventListener('DOMContentLoaded', carregarJogo);
