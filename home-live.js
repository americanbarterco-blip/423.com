/* 423.news — homepage live block: news video + live traffic across the 423 area.
   Loaded by index.html after app.js. Injects itself at the top of #app on the home route. */
(function () {
  'use strict';

  /* ---------------- settings you edit ---------------- */
  var DEFAULTS = {
    /* Live news video. Use ONE of:
         - a YouTube live embed URL:  https://www.youtube.com/embed/live_stream?channel=CHANNEL_ID
         - an HLS stream (.m3u8) you have the right to carry
       Leave '' and the panel says plainly that no stream is connected. */
    videoUrl: '',
    videoTitle: '423 live news',

    /* TomTom Traffic key (restrict it to your domain in the TomTom dashboard).
       Empty = the panel links to TDOT SmartWay instead of inventing incidents. */
    trafficKey: 'cMbIUJuSZbzdjBSuZRxNdf2VgGH17QSz',
    radiusKm: 12,
    maxPerHub: 4,
    refreshSeconds: 120,
    sportsRefreshSeconds: 30,   /* how often the Live sports spaces check for new videos */

    /* Hubs that together cover the 423 area */
    hubs: [
      { name: 'Chattanooga', lat: 35.0456, lon: -85.3097 },
      { name: 'Cleveland', lat: 35.1595, lon: -84.8766 },
      { name: 'Athens', lat: 35.4429, lon: -84.5927 },
      { name: 'Knoxville', lat: 35.9606, lon: -83.9207 },
      { name: 'Morristown', lat: 36.2140, lon: -83.2949 },
      { name: 'Johnson City', lat: 36.3134, lon: -82.3535 },
      { name: 'Kingsport', lat: 36.5484, lon: -82.5618 },
      { name: 'Bristol', lat: 36.5951, lon: -82.1887 }
    ],

    /* Commercials on the news feed: ad plays for adMinutes after every liveMinutes of live video.
       Clock-aligned (10-minute cycle), so every visitor sees the break at the same time.
       adUrls = https .mp4 or .m3u8 files you own the rights to. */
    liveMinutes: 9,
    adMinutes: 1,
    adUrls: [],

    /* Small Claudia Green feed on the home page (same-site page shown in a frame) */
    claudiaUrl: 'claudia-scanner.html',
    feedUrl: 'feed.json',   /* the same file the scanner page reads */
    claudiaCount: 4,

    /* Sports block: one big stream, three smaller ones in a row under it.
       For YouTube embeds add ?autoplay=1&mute=1 to the URL. */
    sports: {
      main: { title: '423 live sports', url: '' },
      others: [
        { label: 'Basketball', url: '' },
        { label: 'Baseball', url: '' },
        { label: 'Soccer', url: '' }
      ]
    }
  };
  var CFG = Object.assign({}, DEFAULTS, window.HOME_LIVE || {});

  /* Public (anon) key: safe in the browser. Row Level Security decides what visitors can read. */
  var SB_URL = 'https://kdiwehqtezlhecxsoysj.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkaXdlaHF0ZXpsaGVjeHNveXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NDQzOTEsImV4cCI6MjEwNjIyMDM5MX0.upw9MEq05Gs3czsmnknR1d37I2n3a681XzTJU-MGWwE';

  var TYPES = { 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Jam',
    7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Wind', 11: 'Flooding', 14: 'Broken down vehicle' };
  var SEVERE = { 1: 1, 5: 1, 6: 1, 7: 1, 8: 1, 11: 1 };
  var hubFilter = 'All';
  var results = [];
  var timer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isHome() { return /^#?\/?(home)?$/.test(location.hash.replace(/^#\/?/, '#/').replace('#/', '#')) || location.hash === '' || location.hash === '#/home'; }

  /* ---------------- css ---------------- */
  var css = document.createElement('style');
  css.textContent =
    '#homeLive{display:grid;gap:16px;grid-template-columns:1.4fr 1fr;margin-bottom:22px}' +
    '@media(max-width:900px){#homeLive{grid-template-columns:1fr}}' +
    '.hl{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;min-width:0}' +
    '.hl-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line)}' +
    '.hl-h h2{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}' +
    '.hl-dot{width:9px;height:9px;border-radius:50%;background:#9eafc0}' +
    '.hl-dot.on{background:#ef4444;animation:wpulse 2s infinite}' +
    '.hl-video{position:relative;aspect-ratio:16/9;background:#000}' +
    '.hl-video iframe,.hl-video video{position:absolute;inset:0;width:100%;height:100%;border:0}' +
    '.hl-empty{display:grid;place-items:center;text-align:center;height:100%;padding:20px;color:var(--muted);font-size:14px}' +
    '.hl-chips{display:flex;gap:6px;overflow-x:auto;padding:10px 14px 0}' +
    '.hl-chips button{flex:0 0 auto;background:var(--s2);border:1px solid var(--line);color:var(--muted);border-radius:99px;padding:5px 11px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}' +
    '.hl-chips button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}' +
    '.hl-list{max-height:330px;overflow:auto;padding:6px 14px 12px}' +
    '.hl-row{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}' +
    '.hl-row:last-child{border-bottom:0}' +
    '.hl-t{flex:0 0 auto;align-self:flex-start;font-size:10px;font-weight:800;text-transform:uppercase;border-radius:4px;padding:2px 7px;background:#1d4ed8;color:#fff;margin-top:2px}' +
    '.hl-t.sev{background:#b91c1c}' +
    '.hl-row small{display:block;color:var(--muted)}' +
    '.hl-note{padding:12px 14px;font-size:13px;color:var(--muted)}' +
    '.hl-side{display:grid;gap:16px;min-width:0;align-content:start}' +
    '.hl-claudia{max-height:260px;overflow:auto;padding:4px 14px 10px}.hl-claudia a{color:inherit;text-decoration:none}' +
    '#homeSports{display:grid;gap:16px;margin-bottom:22px}' +
    '.hl-sports-row{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr))}' +
    '.hl-sports-row .hl-h{padding:8px 10px}.hl-sports-row .hl-h h2{font-size:13px}';
  document.head.appendChild(css);

  /* ---------------- video ---------------- */
  var hlsInst = null;
  function loadHls(cb) {
    if (window.Hls) return cb();
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1';
    s.onload = cb;
    s.onerror = function () { cb(new Error('hls')); };
    document.head.appendChild(s);
  }
  function mountStream(box, u, title, empty) {
    u = (u || '').trim();
    if (!/^https:\/\//i.test(u)) { box.innerHTML = '<div class="hl-empty">' + empty + '</div>'; return false; }
    if (/\.m3u8(\?|$)/i.test(u)) {
      box.innerHTML = '<video controls autoplay muted playsinline></video>';
      var v = box.firstChild;
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = u; return true; }
      loadHls(function (err) {
        if (err || !window.Hls || !window.Hls.isSupported()) {
          box.innerHTML = '<div class="hl-empty">This browser cannot play the live stream.</div>'; return;
        }
        var h = new window.Hls(); h.loadSource(u); h.attachMedia(v);
        if (box.id === 'hlVideo') hlsInst = h;
        h.on(window.Hls.Events.ERROR, function (e, d) {
          if (d.fatal) box.innerHTML = '<div class="hl-empty">The live stream is offline right now.</div>';
        });
      });
      return true;
    }
    if (/\.mp4(\?|$)/i.test(u)) { box.innerHTML = '<video controls autoplay muted playsinline src="' + esc(u) + '"></video>'; return true; }
    box.innerHTML = '<iframe src="' + esc(u) + '" title="' + esc(title) +
      '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>';
    return true;
  }

  /* news feed: live for liveMinutes, then adMinutes of commercials, repeating on the clock */
  var newsPhase = null, newsTimer = null;
  function inAd() {
    var cyc = CFG.liveMinutes + CFG.adMinutes;
    return Math.floor(Date.now() / 60000) % cyc >= CFG.liveMinutes;
  }
  function secsToNextPhase() {
    var cycMs = (CFG.liveMinutes + CFG.adMinutes) * 60000, pos = Date.now() % cycMs, edge = inAd() ? cycMs : CFG.liveMinutes * 60000;
    return Math.max(0, Math.ceil((edge - pos) / 1000));
  }
  function mountAds(box) {
    var list = (CFG.adUrls || []).filter(function (u) { return /^https:\/\//i.test(u); });
    if (!list.length) {
      box.innerHTML = '<div class="hl-empty">Commercial break<br>Live news returns shortly.</div>';
      return;
    }
    var i = 0, fails = 0;
    box.innerHTML = '<video autoplay muted playsinline controls></video>';
    var v = box.firstChild;
    function next() { v.src = list[i++ % list.length]; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    v.addEventListener('ended', next);
    v.addEventListener('error', function () { if (++fails < list.length * 2) next(); });
    next();
  }
  function tickNews() {
    var box = document.getElementById('hlVideo'), tag = document.getElementById('hlTag'), dot = document.getElementById('hlDot');
    if (!box) { clearInterval(newsTimer); newsPhase = null; return; }
    var ad = inAd(), s = secsToNextPhase();
    if (ad !== newsPhase) {
      newsPhase = ad;
      if (hlsInst) { try { hlsInst.destroy(); } catch (e) {} hlsInst = null; }
      if (ad) { mountAds(box); dot.classList.remove('on'); }
      else dot.classList.toggle('on', mountStream(box, newsUrl(), newsTitle(),
        'No live news video yet.<br>Add one on the <a href="#/news" style="text-decoration:underline">News</a> page.'));
    }
    tag.textContent = ad ? 'Commercial break · live in ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) : newsTitle();
  }

  /* ---------------- live news: videos come from the News page (news_streams, league news) ---------------- */
  var newsStream = null, newsSig = '';
  function newsUrl() { return CFG.videoUrl || (newsStream ? ytSrc(newsStream) + '&autoplay=1&mute=1' : ''); }
  function newsTitle() { return CFG.videoUrl ? CFG.videoTitle : (newsStream ? newsStream.title : CFG.videoTitle); }
  function paintNewsVideo() {
    if (CFG.videoUrl) return;                   /* a fixed URL typed into home-live.js wins */
    loadStreams(true).then(function (list) {
      var main = list.filter(function (x) { return x.kind === 'live'; })[0] || list[0] || null;
      var sig = main ? main.id + ':' + main.ref : '-';
      if (sig === newsSig) return;
      newsSig = sig; newsStream = main;
      newsPhase = null; tickNews();             /* swap the player now */
    }).catch(function () { /* keep what is showing */ });
  }

  /* ---------------- traffic ---------------- */
  function fetchHub(h) {
    var d = CFG.radiusKm / 111;
    var bbox = [h.lon - d, h.lat - d, h.lon + d, h.lat + d].join(',');
    var url = 'https://api.tomtom.com/traffic/services/4/incidentDetails/s3/' + bbox +
      '/10/-1/json?key=' + encodeURIComponent(CFG.trafficKey) + '&projection=EPSG4326';
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (raw) {
      var list = (((raw.tm || {}).poi) || []).map(function (p) {
        var desc = (p.d && p.d.description && p.d.description.value) || (typeof p.d === 'string' ? p.d : '');
        return { hub: h.name, type: TYPES[p.ic] || TYPES[p.ty] || 'Incident', text: desc,
          severe: !!SEVERE[p.ty] || p.c === 1, from: p.f || '', to: p.t || '' };
      });
      list.sort(function (a, b) { return (b.severe ? 1 : 0) - (a.severe ? 1 : 0); });
      return { hub: h.name, ok: true, list: list.slice(0, CFG.maxPerHub) };
    }).catch(function (e) { return { hub: h.name, ok: false, error: e.message, list: [] }; });
  }

  function paintTraffic(root) {
    var chips = root.querySelector('.hl-chips'), list = root.querySelector('.hl-list'), stamp = root.querySelector('.hl-stamp');
    if (!CFG.trafficKey) {
      chips.innerHTML = '';
      list.innerHTML = '<div class="hl-note">Live incident feed is not connected yet (needs a TomTom Traffic key in home-live.js). ' +
        'Until then, official road conditions for the whole state: ' +
        '<a href="https://smartway.tn.gov" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">TDOT SmartWay</a>.</div>';
      return;
    }
    var names = ['All'].concat(CFG.hubs.map(function (h) { return h.name; }));
    chips.innerHTML = names.map(function (n) {
      return '<button type="button" data-hub="' + esc(n) + '" aria-pressed="' + (n === hubFilter) + '">' + esc(n) + '</button>';
    }).join('');
    var rows = [], failed = 0;
    results.forEach(function (r) {
      if (!r.ok) failed++;
      if (hubFilter === 'All' || hubFilter === r.hub) rows = rows.concat(r.list);
    });
    rows.sort(function (a, b) { return (b.severe ? 1 : 0) - (a.severe ? 1 : 0); });
    list.innerHTML = rows.length ? rows.map(function (t) {
      return '<div class="hl-row"><span class="hl-t' + (t.severe ? ' sev' : '') + '">' + esc(t.type) + '</span><div>' +
        esc(t.text || t.type) + '<small>' + esc(t.hub) + (t.from ? ' · ' + esc(t.from) : '') + (t.to ? ' → ' + esc(t.to) : '') + '</small></div></div>';
    }).join('') : '<div class="hl-note">No incidents reported' + (hubFilter === 'All' ? ' in the 423 area' : ' near ' + esc(hubFilter)) + ' right now.</div>';
    if (failed) list.innerHTML += '<div class="hl-note">' + failed + ' area' + (failed > 1 ? 's' : '') + ' could not be reached.</div>';
    stamp.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function refreshTraffic(root) {
    if (!CFG.trafficKey) { paintTraffic(root); return; }
    Promise.all(CFG.hubs.map(fetchHub)).then(function (r) { results = r; paintTraffic(root); });
  }

  /* ---------------- Claudia Green small feed ---------------- */
  function paintClaudia(root) {
    var el = root.querySelector('.hl-claudia'); if (!el) return;
    fetch(CFG.feedUrl + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }).then(function (d) {
      var list = (d.reports || []).slice().sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); }).slice(0, CFG.claudiaCount);
      var line = d.claudia && d.claudia.line ? '<div class="hl-note" style="padding:8px 0">' + esc(d.claudia.line) + '</div>' : '';
      el.innerHTML = line + (list.map(function (r) {
        var t = new Date(r.ts), when = isNaN(t) ? '' : t.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return '<a class="hl-row" href="report.html?id=' + encodeURIComponent(r.id) + '"><span class="hl-t' + (/^(BREAKING|ALERT)/i.test(r.kind || '') ? ' sev' : '') + '">' +
          esc(r.kind || 'Report') + '</span><div>' + esc(r.headline) + '<small>' + esc(r.dateline || '') + (when ? ' · ' + when : '') + '</small></div></a>';
      }).join('') || '<div class="hl-note">No reports filed yet.</div>');
    }).catch(function () { el.innerHTML = '<div class="hl-note">Claudia Green’s feed is not available right now. <a href="' + esc(CFG.claudiaUrl) + '" style="text-decoration:underline">Open her page</a>.</div>'; });
  }

  /* ---------------- live sports: videos come from Scores & Live (news_streams) ---------------- */
  var sportsSig = '', sportsTimer = null;
  function ytSrc(st) {
    var b = 'https://www.youtube-nocookie.com/embed/';
    return st.kind === 'playlist' ? b + 'videoseries?list=' + encodeURIComponent(st.ref) : b + encodeURIComponent(st.ref) + '?rel=0';
  }
  /* newsOnly = true: videos posted on the News page (league news). false: everything else (sports). */
  function loadStreams(newsOnly) {
    return fetch(SB_URL + '/rest/v1/news_streams?select=id,title,league,kind,ref&active=eq.true&league=' + (newsOnly ? 'eq.news' : 'neq.news') + '&order=sort.asc,created_at.desc&limit=12',
      { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } })
      .then(function (r) { if (!r.ok) throw new Error('streams ' + r.status); return r.json(); });
  }
  function paintSports(box) {
    var sp = CFG.sports;
    /* If you type a stream URL into CFG.sports above, that fixed setup wins over the Scores & Live videos. */
    var manual = !!((sp.main && sp.main.url) || (sp.others || []).some(function (o) { return o.url; }));
    if (manual) {
      if (sportsSig === 'manual') return;
      sportsSig = 'manual';
      var onM = false;
      box.querySelectorAll('[data-sp]').forEach(function (el) {
        var i = +el.getAttribute('data-sp'), c = i === 0 ? sp.main : sp.others[i - 1];
        var ok = mountStream(el, c.url, c.label || c.title || 'Live sports', 'No stream connected yet.');
        if (i === 0) onM = ok;
      });
      var dm = document.getElementById('spDot'); if (dm) dm.classList.toggle('on', onM);
      return;
    }
    loadStreams(false).then(function (list) {
      if (!box.isConnected) return;
      var main = list.filter(function (x) { return x.kind === 'live'; })[0] || list[0] || null;
      var rest = list.filter(function (x) { return x !== main; }).slice(0, 3);
      var slots = [main, rest[0] || null, rest[1] || null, rest[2] || null];
      var sig = slots.map(function (x) { return x ? x.id + ':' + x.ref : '-'; }).join('|');
      if (sig === sportsSig) return;            /* nothing new: leave the playing videos alone */
      sportsSig = sig;
      var empty = 'No video yet. Add one in <a href="#/scores" style="text-decoration:underline">Scores &amp; Live</a>.';
      box.querySelectorAll('[data-sp]').forEach(function (el) {
        var i = +el.getAttribute('data-sp'), st = slots[i];
        var h = el.parentNode.querySelector('h2');
        if (i > 0 && h) h.textContent = st ? st.title : 'More video';
        if (st) mountStream(el, ytSrc(st), st.title, empty); else el.innerHTML = '<div class="hl-empty">' + empty + '</div>';
      });
      var t = document.getElementById('spTitle'); if (t) t.textContent = main ? main.title : sp.main.title;
      var d = document.getElementById('spDot'); if (d) d.classList.toggle('on', !!(main && main.kind === 'live'));
    }).catch(function () {
      if (sportsSig) return;                    /* keep whatever is already showing */
      box.querySelectorAll('[data-sp]').forEach(function (el) { el.innerHTML = '<div class="hl-empty">Videos could not be loaded right now.</div>'; });
    });
  }

  /* ---------------- mount ---------------- */
  function sportsHtml() {
    var sp = CFG.sports, small = (sp.others || []).slice(0, 3).map(function (o, i) {
      return '<div class="hl"><div class="hl-h"><h2>' + esc(o.label) + '</h2></div><div class="hl-video" data-sp="' + (i + 1) + '"></div></div>';
    }).join('');
    return '<div class="hl"><div class="hl-h"><h2><span class="hl-dot" id="spDot"></span>Live sports</h2><span><span class="muted" id="spTitle">' +
      esc(sp.main.title) + '</span> · <a href="#/scores" style="font-size:12px;text-decoration:underline">All video →</a></span></div><div class="hl-video" data-sp="0"></div></div><div class="hl-sports-row">' + small + '</div>';
  }
  function mount() {
    var app = document.getElementById('app');
    if (!app || !isHome() || document.getElementById('homeLive')) return;
    var root = document.createElement('section');
    root.id = 'homeLive';
    root.innerHTML =
      '<div class="hl"><div class="hl-h"><h2><span class="hl-dot" id="hlDot"></span>Live news</h2><span class="muted" id="hlTag"></span></div>' +
      '<div class="hl-video" id="hlVideo"></div></div>' +
      '<div class="hl-side">' +
      '<div class="hl"><div class="hl-h"><h2>Claudia Green</h2><a href="' + esc(CFG.claudiaUrl) + '" style="font-size:12px;text-decoration:underline">Open full</a></div>' +
      '<div class="hl-claudia"><div class="hl-note">Loading…</div></div></div>' +
      '<div class="hl"><div class="hl-h"><h2>Traffic · 423 area</h2><span class="muted hl-stamp"></span></div>' +
      '<div class="hl-chips"></div><div class="hl-list"></div></div></div>';
    app.insertBefore(root, app.firstChild);
    var sports = document.createElement('section');
    sports.id = 'homeSports';
    sports.innerHTML = sportsHtml();
    app.insertBefore(sports, root.nextSibling);
    sportsSig = ''; newsSig = '';
    paintSports(sports);
    paintNewsVideo();
    clearInterval(sportsTimer);
    sportsTimer = setInterval(function () {
      var sx = document.getElementById('homeSports');
      if (sx && !document.hidden) { paintSports(sx); paintNewsVideo(); }
    }, CFG.sportsRefreshSeconds * 1000);
    newsPhase = null; tickNews();
    clearInterval(newsTimer); newsTimer = setInterval(tickNews, 1000);
    root.querySelector('.hl-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-hub]'); if (!b) return;
      hubFilter = b.getAttribute('data-hub'); paintTraffic(root);
    });
    refreshTraffic(root);
    paintClaudia(root);
    clearInterval(timer);
    timer = setInterval(function () {
      var r = document.getElementById('homeLive');
      if (r && !document.hidden) { refreshTraffic(r); paintClaudia(r); }
    }, CFG.refreshSeconds * 1000);
  }

  function start() {
    var app = document.getElementById('app');
    if (!app) return;
    new MutationObserver(mount).observe(app, { childList: true });
    window.addEventListener('hashchange', function () { setTimeout(mount, 50); });
    mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
