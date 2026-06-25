/* ═══════════════════════════════════════════════════════
   GAME IT — profile.js
═══════════════════════════════════════════════════════ */

// ── THEME ────────────────────────────────────────────
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

// ── TABS ─────────────────────────────────────────────
function switchProfileTab(tab) {
    document.querySelectorAll('.ptab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
    ['posts', 'reviews', 'listas', 'jogos', 'curtidas'].forEach(t => {
        const p = document.getElementById('ppanel-' + t);
        if (p) p.style.display = (t === tab) ? 'flex' : 'none';
    });
}

// ── LOGOUT ───────────────────────────────────────────
async function fazerLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
}

// ── PLAYER SUMMARY ───────────────────────────────────
async function carregarPerfil() {
    try {
        const res = await fetch('/api/steam/user');
        const data = await res.json();
        if (data.status === 'success' && data.player) {
            const p = data.player;
            const nick = document.getElementById('profile-nickname');
            if (nick && p.personaname) nick.textContent = '@' + p.personaname;
            const av = document.getElementById('profile-avatar-img');
            if (av && p.avatarfull) av.src = p.avatarfull;
        }
    } catch (e) { /* mantém placeholder */ }
}

// ── JOGADO RECENTEMENTE ──────────────────────────────
function formatHours(minutes) {
    const h = Math.round((minutes || 0) / 60);
    return h + (h === 1 ? ' hora' : ' horas');
}

async function carregarRecentes() {
    const box = document.getElementById('recent-played');
    try {
        const res = await fetch('/api/steam/recent');
        const data = await res.json();
        if (data.status !== 'success' || !data.games || !data.games.length) {
            box.innerHTML = '<p class="empty-msg" style="text-align:center;padding:16px 0;">Nenhuma sessão recente.</p>';
            return;
        }
        box.innerHTML = data.games.map(g => {
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
                    <p class="recent-name">${g.name}</p>
                    ${progress}
                    <p class="recent-hours"><i class="fa-brands fa-steam"></i> ${formatHours(g.playtime_forever)}</p>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = '<p class="empty-msg" style="text-align:center;padding:16px 0;">Erro ao carregar sessões.</p>';
    }
}

// ── INIT ─────────────────────────────────────────────
carregarPerfil();
carregarRecentes();
