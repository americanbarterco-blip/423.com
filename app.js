/* 423.news — live app. Hash-routed single page on Supabase (auth, posts, comments, photos, realtime). */
(function () {
  'use strict';

  var SB_URL = 'https://kdiwehqtezlhecxsoysj.supabase.co';
  /* Public anon key — safe in the browser. Row Level Security protects the data. */
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkaXdlaHF0ZXpsaGVjeHNveXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NDQzOTEsImV4cCI6MjEwNjIyMDM5MX0.upw9MEq05Gs3czsmnknR1d37I2n3a681XzTJU-MGWwE';
  var MEDIA_BASE = SB_URL + '/storage/v1/object/public/news-media/';

  var SECTIONS = {
    news:        { label: 'News',        emoji: '📰', blurb: 'Local reporting from across the region.' },
    sports:      { label: 'Sports',      emoji: '🏈', blurb: 'High school, college and local sports.' },
    schools:     { label: 'Schools',     emoji: '🏫', blurb: 'Districts, campuses, students and teachers.' },
    outdoors:    { label: 'Outdoors',    emoji: '🏞️', blurb: 'Trails, lakes, hunting, fishing and getting outside.' },
    classifieds: { label: 'Classifieds', emoji: '🏷️', blurb: 'Buy, sell and trade with your neighbors.' },
    community:   { label: 'citizen423report',   emoji: '👥', blurb: 'Real people. Local stories.' },
    government:  { label: 'Government',  emoji: '🏛️', blurb: 'Councils, commissions, courts and public meetings.' }
  };
  var COMMUNITY_TOPICS = [
    ['all', 'All Posts'], ['photos', 'Photos'], ['events', 'Events'],
    ['discussions', 'Discussions'], ['lost', 'Lost & Found'], ['announcements', 'Announcements']
  ];
  var CLASSIFIED_TOPICS = [['all', 'All'], ['sell', 'For Sale'], ['buy', 'Wanted'], ['trade', 'Trade']];
  var TOPIC_LABEL = { events: 'Events', discussions: 'Discussions', lost: 'Lost & Found', announcements: 'Announcements', general: 'General', sell: 'For Sale', buy: 'Wanted', trade: 'Trade', photos: 'Photos' };
  var POST_COLS = 'id,slug,section,topic,title,body,image_url,price,author_id,author_name,status,created_at';

  if (!window.supabase || !window.supabase.createClient) {
    document.getElementById('app').innerHTML = '<div class="err">Could not load the data library. Check your connection and refresh.</div>';
    return;
  }
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  var state = { user: null, profile: null, route: null, token: 0 };

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isStaff() { return !!(state.profile && (state.profile.role === 'editor' || state.profile.role === 'admin')); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, 3600);
  }
  function ago(ts) {
    var s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' days ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function safeImg(u) { return (u && String(u).indexOf(MEDIA_BASE) === 0) ? u : ''; }
  function money(n) { return n == null ? '' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function excerpt(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function secEmoji(s) { return (SECTIONS[s] || SECTIONS.news).emoji; }
  function media(p, cls) {
    var u = safeImg(p.image_url);
    return u ? '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'src="' + esc(u) + '" alt="" loading="lazy">'
             : '<div class="ph ' + (cls || '') + '" aria-hidden="true">' + secEmoji(p.section) + '</div>';
  }
  function href(p) { return '#/story/' + encodeURIComponent(p.slug); }
  function label(p) { return (p.topic && TOPIC_LABEL[p.topic]) || (SECTIONS[p.section] || {}).label || 'News'; }

  /* ---------- cards ---------- */
  function card(p) {
    return '<a class="panel card" href="' + href(p) + '">' + media(p) +
      '<div class="pad"><span class="badge">' + esc(label(p)) + '</span>' +
      '<h3>' + esc(p.title) + '</h3>' +
      (p.price != null ? '<div class="price">' + esc(money(p.price)) + '</div>' : '') +
      '<p class="muted">' + esc(excerpt(p.body, 110)) + '</p>' +
      '<p class="muted">' + esc(p.author_name) + ' · ' + esc(ago(p.created_at)) + '</p></div></a>';
  }
  function tile(p) {
    return '<a class="tile" href="' + href(p) + '">' + media(p) +
      '<span class="badge">' + esc(label(p)) + '</span><h3>' + esc(p.title) + '</h3>' +
      '<p class="muted">' + esc(ago(p.created_at)) + '</p></a>';
  }
  function mini(p) {
    return '<a class="mini" href="' + href(p) + '">' + media(p) +
      '<div><span class="badge">' + esc(label(p)) + '</span><h3>' + esc(p.title) + '</h3>' +
      '<p class="muted">' + esc(ago(p.created_at)) + '</p></div></a>';
  }
  function ugc(p) {
    return '<article class="panel ugc"><div class="byline"><b>' + esc(p.author_name) + '</b><span class="muted">' + esc(ago(p.created_at)) + ' · ' + esc(label(p)) + '</span></div>' +
      (safeImg(p.image_url) ? media(p) : '') +
      '<h3>' + esc(p.title) + '</h3><p class="muted">' + esc(excerpt(p.body, 160)) + '</p>' +
      '<div class="foot"><a href="' + href(p) + '">💬 Read &amp; comment</a><button type="button" data-share="' + esc(p.slug) + '">↗ Share</button></div></article>';
  }
  function empty(title, text, btn) {
    return '<div class="panel empty"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (btn || '') + '</div>';
  }
  function errBox(e) {
    return '<div class="err">Something went wrong loading this page. <button class="linkbtn" data-retry>Try again</button>' +
      (e && e.message ? '<div class="muted" style="margin-top:6px">' + esc(e.message) + '</div>' : '') + '</div>';
  }

  /* ---------- data ---------- */
  function listPosts(opts) {
    opts = opts || {};
    var q = sb.from('news_posts').select(POST_COLS).eq('status', 'published').order('created_at', { ascending: false }).limit(opts.limit || 40);
    if (opts.section) q = q.eq('section', opts.section);
    else if (!opts.sections) q = q.neq('section', 'community');   /* community posts show only inside citizen423report */
    if (opts.sections) q = q.in('section', opts.sections);
    if (opts.topic && opts.topic !== 'all') q = q.eq('topic', opts.topic);
    if (opts.photos) q = q.not('image_url', 'is', null);
    if (opts.search) {
      var t = opts.search.replace(/[%_,()\\]/g, ' ').trim().slice(0, 60);
      if (t) q = q.or('title.ilike.%' + t + '%,body.ilike.%' + t + '%');
    }
    return q.then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }

  /* ---------- views ---------- */
  var views = {};

  /* small mini feed of the latest citizen posts, with who posted them */
  function citizenMini(list) {
    return '<div class="sech"><h2>citizen423report</h2><a href="#/community">Join in →</a></div><div class="panel pad" style="margin-bottom:26px">' +
      list.map(function (p) {
        var nm = p.author_name || 'Neighbor';
        return '<a href="' + href(p) + '" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);color:inherit;text-decoration:none">' +
          '<span aria-hidden="true" style="flex:0 0 32px;width:32px;height:32px;border-radius:50%;background:#7c3aed;color:#fff;display:grid;place-items:center;font-weight:800">' + esc(nm.charAt(0).toUpperCase()) + '</span>' +
          '<span style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title) + '</b>' +
          '<small class="muted">' + esc(nm) + ' · ' + esc(ago(p.created_at)) + '</small></span></a>';
      }).join('') + '</div>';
  }

  views.home = function () {
    return Promise.all([
      listPosts({ sections: ['news', 'sports', 'schools', 'outdoors', 'government'], limit: 40 }),
      listPosts({ section: 'community', limit: 5 }),
      listPosts({ section: 'classifieds', limit: 4 }),
      sb.from('news_reports').select('id,kind,dateline,headline,ts').eq('published', true).order('ts', { ascending: false }).limit(4),
      sb.from('news_scores').select('*').in('status', ['in', 'pre']).gte('start_time', new Date(Date.now() - 12 * 3600e3).toISOString()).lte('start_time', new Date(Date.now() + 3 * 86400e3).toISOString()).order('start_time', { ascending: true }).limit(12)
    ]).then(function (r) {
      var news = r[0], comm = r[1], cls = r[2], wire = (r[3] && r[3].data) || [];
      var out = '';
      var quick = '<div class="quick">' +
        [['news', '#db2777'], ['sports', '#2563eb'], ['schools', '#16a34a'], ['outdoors', '#ca8a04'], ['classifieds', '#ea580c'], ['community', '#7c3aed']].map(function (x) {
          return '<a href="#/' + x[0] + '"><span style="background:' + x[1] + '" aria-hidden="true">' + SECTIONS[x[0]].emoji + '</span>' + SECTIONS[x[0]].label + '</a>';
        }).join('') + '</div>';

      if (news.length) {
        var lead = news[0], rail = news.slice(1, 4);
        out += '<div class="hero"><a class="lead" href="' + href(lead) + '">' + media(lead) +
          '<div class="lc"><span class="badge">' + esc(label(lead)) + '</span><h1>' + esc(lead.title) + '</h1>' +
          '<p>' + esc(excerpt(lead.body, 160)) + '</p><p class="muted">' + esc(lead.author_name) + ' · ' + esc(ago(lead.created_at)) + '</p></div></a>' +
          '<div class="rail">' + rail.map(mini).join('') + '</div></div>';
      } else {
        out += '<div class="panel pad" style="margin-bottom:18px"><span class="badge">Welcome</span><h1>Local news, written by the people who live here</h1>' +
          '<p class="muted">Be the first to file a story, post to citizen423report, or list something for sale.</p>' +
          '<div class="row-actions"><button class="btn" data-submit="news">Submit a Story</button><a class="btn dark" href="#/community">Visit citizen423report</a></div></div>';
      }
      out += quick;
      var allG = (r[4] && r[4].data) || [];
      var liveG = allG.filter(function (g) { return g.status === 'in'; });
      var soonG = allG.filter(function (g) { return g.status === 'pre'; }).slice(0, 4);
      var showG = liveG.length ? liveG.slice(0, 6) : soonG;
      out += '<div class="sech"><h2>' + (liveG.length ? 'Live now' : 'Up next') + '</h2><a href="#/scores">All scores →</a></div>' +
        (showG.length ? '<div class="games" style="margin-bottom:26px">' + showG.map(gameCard).join('') + '</div>'
                      : '<p class="muted" style="margin-bottom:26px">No games on right now. <a href="#/scores" style="text-decoration:underline">See scores, video and headlines →</a></p>');

      if (wire.length) {
        out += '<div class="sech"><h2>Claudia Green</h2><a href="claudia-scanner.html">All reports →</a></div><div class="wire">' +
          wire.map(function (w) {
            return '<a href="report.html?id=' + encodeURIComponent(w.id) + '"><div><span class="badge">' + esc(w.kind) + '</span></div><div><h3>' + esc(w.headline) + '</h3><span class="muted">' + esc(w.dateline || '') + ' · ' + esc(ago(w.ts)) + '</span></div></a>';
          }).join('') + '</div>';
      }
      if (news.length > 4) {
        out += '<div class="sech"><h2>Latest</h2><a href="#/news">More news →</a></div><div class="g4">' + news.slice(4, 8).map(tile).join('') + '</div>';
        if (news.length > 8) out += '<div class="lower panel pad" style="margin-bottom:26px"><div style="grid-column:1/-1"><h2 class="sm">More stories</h2>' + news.slice(8, 16).map(mini).join('') + '</div></div>';
      }
      if (cls.length) out += '<div class="sech"><h2>Classifieds</h2><a href="#/classifieds">See all →</a></div><div class="g4">' + cls.map(tile).join('') + '</div>';
      out += comm.length ? citizenMini(comm) : '<div class="sech"><h2>citizen423report</h2><a href="#/community">Join in →</a></div><p class="muted" style="margin-bottom:26px">No posts yet. <a href="#/community" style="text-decoration:underline">Be the first to post →</a></p>';
      return out;
    });
  };

  /* Live video on the News page: same table as Scores & Live (news_streams), kept apart by league = 'news'. */
  function newsVideos() {
    return sb.from('news_streams').select('*').eq('league', 'news').eq('active', true)
      .order('sort', { ascending: true }).order('created_at', { ascending: false }).limit(20).then(function (r) {
        var list = r.error ? [] : (r.data || []);
        var streams = list.filter(function (s) { return s.kind === 'live'; }).concat(list.filter(function (s) { return s.kind !== 'live'; }));
        state.streams = streams;
        var out = '';
        if (streams.length) {
          out += '<div class="sech"><h2>Live video</h2></div><div id="vplayer">' + player(streams[0]) + '</div><div class="chips" id="vlist">' + streams.map(function (st, i) {
            return '<span class="chip"><button type="button" class="linkbtn" style="text-decoration:none;color:inherit" data-play="' + i + '">' + (st.kind === 'live' ? '🔴 ' : '▶ ') + esc(st.title) + '</button>' +
              (isStaff() ? '<button type="button" data-delstream="' + esc(st.id) + '" aria-label="Remove">×</button>' : '') + '</span>';
          }).join('') + '</div>';
        }
        if (isStaff()) {
          out += '<form id="streamForm" class="panel pad" style="margin:12px 0 24px"><b>Add live video (editors)</b><div class="hint">Paste a YouTube video, live stream or playlist link. It shows here and on the home page. Only use streams you have the right to embed.</div>' +
            '<input name="title" placeholder="Title" maxlength="120" required><input name="url" placeholder="https://www.youtube.com/watch?v=…" required>' +
            '<input type="hidden" name="league" value="news">' +
            '<select name="kind"><option value="live">Live stream</option><option value="video">Video</option><option value="playlist">Playlist</option></select><button class="btn" type="submit">Add</button></form>';
        }
        return out;
      }, function () { return ''; });
  }

  function sectionView(sec, topic) {
    var meta = SECTIONS[sec];
    var tabs = '';
    var topics = sec === 'community' ? COMMUNITY_TOPICS : sec === 'classifieds' ? CLASSIFIED_TOPICS : null;
    topic = topic || 'all';
    if (topics) {
      tabs = '<div class="tabs">' + topics.map(function (t) {
        return '<a class="' + (t[0] === topic ? 'on' : '') + '" href="#/' + sec + (t[0] === 'all' ? '' : '/' + t[0]) + '">' + t[1] + '</a>';
      }).join('') + '</div>';
    }
    var opts = { section: sec, limit: 60 };
    if (sec === 'community' && topic === 'photos') opts.photos = true; else opts.topic = topic;
    var vidP = sec === 'news' && topic === 'all' ? newsVideos() : Promise.resolve('');
    return Promise.all([listPosts(opts), vidP]).then(function (rr) {
      var posts = rr[0], vid = rr[1];
      var head = '<div class="chead"><div style="margin-bottom:18px"><span class="badge">' + esc(meta.label) + '</span><h1>' + esc(meta.label) + '</h1><p class="muted">' + esc(meta.blurb) + '</p></div>' +
        '<button class="btn" data-submit="' + sec + '"' + (topic && topic !== 'all' && topic !== 'photos' ? ' data-topic="' + esc(topic) + '"' : '') + '>' +
        (sec === 'community' ? 'Create Post' : sec === 'classifieds' ? 'Post a Listing' : 'Submit a Story') + '</button></div>';
      var body;
      if (!posts.length) {
        body = empty('Nothing here yet', sec === 'news' || sec === 'sports' || sec === 'schools' || sec === 'outdoors' || sec === 'government'
          ? 'Stories are reviewed by an editor before they go live. Be the first to submit one.' : 'Be the first to post.');
      } else if (sec === 'community') {
        body = '<div class="ugcs">' + posts.map(ugc).join('') + '</div>';
      } else {
        body = '<div class="grid">' + posts.map(card).join('') + '</div>';
      }
      return head + vid + tabs + body;
    });
  }

  views.story = function (slug) {
    return sb.from('news_posts').select(POST_COLS).eq('slug', slug).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      var p = r.data;
      if (!p) return empty('Story not found', 'It may have been removed or is still awaiting review.', '<a class="btn" href="#/home">Back to home</a>');
      document.title = p.title + ' • 423.news';
      var canEdit = state.user && (state.user.id === p.author_id || isStaff());
      var html = '<article class="article"><a class="muted" href="#/' + p.section + '">← ' + esc(SECTIONS[p.section].label) + '</a>' +
        '<div style="margin-top:10px"><span class="badge">' + esc(label(p)) + '</span> ' +
        (p.status !== 'published' ? '<span class="st ' + esc(p.status) + '">' + esc(p.status) + '</span>' : '') + '</div>' +
        '<h1>' + esc(p.title) + '</h1>' +
        '<div class="muted">' + esc(p.author_name) + ' · ' + esc(ago(p.created_at)) + '</div>' +
        (p.price != null ? '<div class="price" style="margin-top:8px">' + esc(money(p.price)) + '</div>' : '') +
        (safeImg(p.image_url) ? '<img class="hero-img" src="' + esc(safeImg(p.image_url)) + '" alt="">' : '') +
        '<div class="body">' + esc(p.body) + '</div>' +
        '<div class="row-actions"><button class="btn dark sm" data-share="' + esc(p.slug) + '">↗ Share</button>' +
        (canEdit ? '<button class="btn danger sm" data-delpost="' + esc(p.id) + '">Delete</button>' : '') + '</div>' +
        '<h2 class="sm" style="margin-top:30px">Comments</h2><div id="cmts" data-post="' + esc(p.id) + '"><p class="muted">Loading…</p></div>' +
        '<div id="cform"></div></article>';
      state.currentPost = p.id;
      return html;
    });
  };

  function loadComments() {
    var box = $('#cmts'); if (!box) return;
    var pid = box.getAttribute('data-post');
    sb.from('news_comments').select('id,author_id,author_name,body,created_at').eq('post_id', pid).order('created_at', { ascending: true }).then(function (r) {
      if (!$('#cmts')) return;
      if (r.error) { box.innerHTML = '<p class="muted">Could not load comments.</p>'; return; }
      var rows = r.data || [];
      box.innerHTML = rows.length ? rows.map(function (c) {
        var mine = state.user && (state.user.id === c.author_id || isStaff());
        return '<div class="cmt"><div class="byline"><b>' + esc(c.author_name) + '</b><span class="muted">' + esc(ago(c.created_at)) + '</span>' +
          (mine ? ' <button class="linkbtn muted" data-delcmt="' + esc(c.id) + '">delete</button>' : '') + '</div><p>' + esc(c.body) + '</p></div>';
      }).join('') : '<p class="muted">No comments yet.</p>';
    });
    var cf = $('#cform');
    if (cf) {
      cf.innerHTML = state.user
        ? '<form id="cmtForm"><label for="cbody">Add a comment</label><textarea id="cbody" rows="3" maxlength="2000" required></textarea><button class="btn" type="submit">Post comment</button></form>'
        : '<p class="muted"><button class="linkbtn" data-auth="signin">Sign in</button> to join the conversation.</p>';
    }
  }

  views.search = function (q) {
    return listPosts({ search: q, limit: 60 }).then(function (posts) {
      return '<h1>Search</h1><form id="srch2" class="srch" style="max-width:none;margin:0 0 16px"><input name="q" type="search" value="' + esc(q) + '" placeholder="Search 423.news…"></form>' +
        (posts.length ? '<p class="muted">' + posts.length + ' result' + (posts.length === 1 ? '' : 's') + ' for “' + esc(q) + '”</p><div class="grid">' + posts.map(card).join('') + '</div>'
                      : empty('No results', 'Nothing matched “' + q + '”. Try a different word.'));
    });
  };

  views.teams = function () {
    if (!state.user) return Promise.resolve(empty('Follow your teams', 'Sign in to pick the teams you follow and see their stories here.', '<button class="btn" data-auth="signin">Sign in</button>'));
    return Promise.all([
      sb.from('news_follows').select('team').order('created_at', { ascending: true }),
      listPosts({ section: 'sports', limit: 100 })
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      var teams = (r[0].data || []).map(function (x) { return x.team; });
      var posts = r[1];
      var matched = posts.filter(function (p) {
        var hay = (p.title + ' ' + p.body + ' ' + (p.topic || '')).toLowerCase();
        return teams.some(function (t) { return hay.indexOf(t.toLowerCase()) >= 0; });
      });
      return '<div class="chead"><div><span class="badge">My Teams</span><h1>My Teams</h1><p class="muted">Sports stories that mention the teams you follow.</p></div></div>' +
        '<form id="teamForm" style="display:flex;gap:8px;align-items:flex-start"><input name="team" maxlength="80" placeholder="Add a team, e.g. Science Hill" required style="margin:0"><button class="btn" type="submit">Follow</button></form>' +
        '<div class="chips">' + (teams.length ? teams.map(function (t) { return '<span class="chip">' + esc(t) + '<button type="button" data-unfollow="' + esc(t) + '" aria-label="Unfollow ' + esc(t) + '">×</button></span>'; }).join('') : '<span class="muted">You are not following any teams yet.</span>') + '</div>' +
        (teams.length ? (matched.length ? '<div class="grid">' + matched.map(card).join('') + '</div>' : empty('No stories yet', 'We will list sports stories here as soon as one mentions your teams.')) : '');
    });
  };

  views.profile = function () {
    if (!state.user) return Promise.resolve(empty('Your profile', 'Sign in to manage your posts and display name.', '<button class="btn" data-auth="signin">Sign in</button>'));
    return sb.from('news_posts').select(POST_COLS).eq('author_id', state.user.id).order('created_at', { ascending: false }).limit(100).then(function (r) {
      if (r.error) throw r.error;
      var mine = r.data || [];
      return '<h1>Your profile</h1><div class="panel pad" style="max-width:520px"><form id="nameForm"><label for="dn">Display name (shown on your posts)</label>' +
        '<input id="dn" name="name" maxlength="60" required value="' + esc(state.profile ? state.profile.display_name : '') + '"><div class="muted" style="margin-bottom:10px">' + esc(state.user.email || '') + (isStaff() ? ' · ' + esc(state.profile.role) : '') + '</div>' +
        '<div class="row-actions"><button class="btn" type="submit">Save</button><button class="btn dark" type="button" data-signout>Sign out</button></div></form></div>' +
        '<div class="sech" style="margin-top:26px"><h2>Your posts</h2></div>' +
        (mine.length ? mine.map(function (p) {
          return '<div class="row"><div><a href="' + href(p) + '"><b>' + esc(p.title) + '</b></a><div class="muted">' + esc(label(p)) + ' · ' + esc(ago(p.created_at)) + '</div></div><span class="st ' + esc(p.status) + '">' + esc(p.status) + '</span></div>';
        }).join('') : empty('No posts yet', 'Anything you submit will show up here with its review status.'));
    });
  };


  /* ---------- live sports: scores, headlines, video ---------- */
  var LEAGUES = [['all', 'All Sports'], ['nfl', 'NFL'], ['nba', 'NBA'], ['ncaaf', 'College Football'], ['ncaab', 'College Basketball'], ['wwe', 'WWE']];
  var LEAGUE_NAME = { nfl: 'NFL', nba: 'NBA', ncaaf: 'College Football', ncaab: 'College Basketball', wwe: 'WWE', general: 'General' };
  function logo(u) { return (u && String(u).indexOf('https://a.espncdn.com/') === 0) ? '<img class="tl" src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="tl"></span>'; }
  function gameCard(g) {
    var live = g.status === 'in', done = g.status === 'post', pre = g.status === 'pre';
    var aw = !pre && g.away_score != null && g.home_score != null && g.away_score > g.home_score;
    var hw = !pre && g.away_score != null && g.home_score != null && g.home_score > g.away_score;
    var when = pre ? new Date(g.start_time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : (g.detail || (done ? 'Final' : 'Live'));
    function row(name, abbr, lg, sc, win) {
      return '<div class="trow' + (win ? ' win' : '') + '">' + logo(lg) + '<span class="tn">' + esc(name) + '</span><span class="ts">' + (pre || sc == null ? '' : esc(sc)) + '</span></div>';
    }
    return '<div class="panel game' + (live ? ' live' : '') + '"><div class="gh"><span class="st ' + (live ? 'published' : '') + '">' + (live ? '● LIVE' : done ? 'Final' : 'Upcoming') + '</span><span class="muted">' + esc(LEAGUE_NAME[g.league] || g.league) + '</span></div>' +
      row(g.away_name, g.away_abbr, g.away_logo, g.away_score, aw) + row(g.home_name, g.home_abbr, g.home_logo, g.home_score, hw) +
      '<div class="gf muted">' + esc(when) + (g.broadcast ? ' · ' + esc(g.broadcast) : '') + '</div></div>';
  }
  function ytId(input) {
    var t = String(input || '').trim();
    var m = t.match(/(?:v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/) || t.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : null;
  }
  function ytList(input) { var m = String(input || '').match(/[?&]list=([A-Za-z0-9_-]{10,64})/); return m ? m[1] : null; }
  function embedSrc(st) {
    var base = 'https://www.youtube-nocookie.com/embed/';
    return st.kind === 'playlist' ? base + 'videoseries?list=' + encodeURIComponent(st.ref) : base + encodeURIComponent(st.ref) + '?rel=0';
  }
  function player(st) {
    return '<div class="vwrap"><iframe src="' + esc(embedSrc(st)) + '" title="' + esc(st.title) + '" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
  }
  state.streams = [];

  views.scores = function (league) {
    league = LEAGUE_NAME[league] && league !== 'general' ? league : 'all';
    var since = new Date(Date.now() - 36 * 3600e3).toISOString();
    var until = new Date(Date.now() + 4 * 86400e3).toISOString();
    var sq = sb.from('news_scores').select('*').gte('start_time', since).lte('start_time', until).order('start_time', { ascending: true }).limit(400);
    var hq = sb.from('news_headlines').select('id,league,title,url,source,published,created_at').order('published', { ascending: false, nullsFirst: false }).limit(30);
    var vq = sb.from('news_streams').select('*').eq('active', true).neq('league', 'news').order('sort', { ascending: true }).order('created_at', { ascending: false }).limit(30);
    if (league !== 'all') { sq = sq.eq('league', league); hq = hq.eq('league', league); vq = vq.in('league', [league, 'general']); }
    return Promise.all([sq, hq, vq]).then(function (r) {
      var games = r[0].data || [], heads = r[1].data || [], streams = r[2].data || [];
      state.streams = streams;
      var live = games.filter(function (g) { return g.status === 'in'; });
      var upcoming = games.filter(function (g) { return g.status === 'pre'; }).slice(0, league === 'all' ? 12 : 30);
      var finals = games.filter(function (g) { return g.status === 'post'; }).reverse().slice(0, league === 'all' ? 12 : 30);
      var tabs = '<div class="tabs">' + LEAGUES.map(function (t) { return '<a class="' + (t[0] === league ? 'on' : '') + '" href="#/scores' + (t[0] === 'all' ? '' : '/' + t[0]) + '">' + t[1] + '</a>'; }).join('') + '</div>';
      var out = '<div class="chead"><div style="margin-bottom:14px"><span class="badge">Live</span><h1>Scores &amp; Live Sports</h1><p class="muted">Scores update automatically. Local high school results come from stories in the <a href="#/sports" style="text-decoration:underline">Sports</a> section.</p></div></div>' + tabs;

      out += '<div class="sech"><h2>Watch</h2></div>';
      if (streams.length) {
        out += '<div id="vplayer">' + player(streams[0]) + '</div><div class="chips" id="vlist">' + streams.map(function (st, i) {
          return '<span class="chip"><button type="button" class="linkbtn" style="text-decoration:none;color:inherit" data-play="' + i + '">' + (st.kind === 'live' ? '🔴 ' : '▶ ') + esc(st.title) + '</button>' +
            (isStaff() ? '<button type="button" data-delstream="' + esc(st.id) + '" aria-label="Remove">×</button>' : '') + '</span>';
        }).join('') + '</div>';
      } else {
        out += empty('No video yet', isStaff() ? 'Add a YouTube video, live stream or playlist below.' : 'Live streams and highlights will appear here.');
      }
      if (isStaff()) {
        out += '<form id="streamForm" class="panel pad" style="margin:12px 0 24px"><b>Add video (editors)</b><div class="hint">Paste a YouTube video, live stream or playlist link. Only use streams you have the right to embed.</div>' +
          '<input name="title" placeholder="Title" maxlength="120" required><input name="url" placeholder="https://www.youtube.com/watch?v=…" required>' +
          '<select name="league">' + ['general', 'nfl', 'nba', 'ncaaf', 'ncaab', 'wwe'].map(function (l) { return '<option value="' + l + '">' + LEAGUE_NAME[l] + '</option>'; }).join('') + '</select>' +
          '<select name="kind"><option value="video">Video</option><option value="live">Live stream</option><option value="playlist">Playlist</option></select><button class="btn" type="submit">Add</button></form>';
      }

      if (live.length) out += '<div class="sech"><h2>Live now</h2></div><div class="games">' + live.map(gameCard).join('') + '</div>';
      if (league !== 'wwe') {
        out += '<div class="sech"><h2>Upcoming</h2></div>' + (upcoming.length ? '<div class="games">' + upcoming.map(gameCard).join('') + '</div>' : '<p class="muted" style="margin-bottom:22px">No games scheduled in the next few days.</p>');
        out += '<div class="sech"><h2>Final scores</h2></div>' + (finals.length ? '<div class="games">' + finals.map(gameCard).join('') + '</div>' : '<p class="muted" style="margin-bottom:22px">No recent finals.</p>');
      }
      out += '<div class="sech"><h2>Headlines</h2></div>' + (heads.length ? '<div class="wire">' + heads.map(function (h) {
        return '<a href="' + esc(h.url) + '" target="_blank" rel="noopener noreferrer"><div><span class="badge">' + esc(LEAGUE_NAME[h.league] || h.league) + '</span></div><div><h3>' + esc(h.title) + '</h3><span class="muted">' + esc(h.source || '') + (h.published ? ' · ' + esc(ago(h.published)) : '') + '</span></div></a>';
      }).join('') + '</div>' : '<p class="muted">No headlines yet.</p>');
      out += '<p class="muted" style="margin-top:18px">Scores and headlines from ESPN and other public feeds; links open the original publisher.</p>';
      return out;
    });
  };

  views.review = function () {
    if (!isStaff()) return Promise.resolve(empty('Editors only', 'You need an editor account to review submissions.'));
    return sb.from('news_posts').select(POST_COLS).eq('status', 'pending').order('created_at', { ascending: true }).limit(100).then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      return '<h1>Review queue</h1><p class="muted">Submissions waiting for approval (' + rows.length + ').</p>' +
        (rows.length ? rows.map(function (p) {
          return '<div class="panel q-item"><span class="badge">' + esc(label(p)) + '</span> <span class="muted">by ' + esc(p.author_name) + ' · ' + esc(ago(p.created_at)) + '</span>' +
            '<h3>' + esc(p.title) + '</h3>' + (safeImg(p.image_url) ? '<img src="' + esc(safeImg(p.image_url)) + '" alt="" style="max-width:240px;border-radius:8px">' : '') +
            '<p style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(excerpt(p.body, 900)) + '</p>' +
            '<div class="row-actions"><button class="btn ok sm" data-setstatus="published" data-id="' + esc(p.id) + '">Approve</button>' +
            '<button class="btn dark sm" data-setstatus="rejected" data-id="' + esc(p.id) + '">Reject</button>' +
            '<a class="btn dark sm" href="' + href(p) + '">Open</a></div></div>';
        }).join('') : empty('All caught up', 'No submissions are waiting.'));
    });
  };

  /* ---------- router ---------- */
  var scrollTop = true;
  function parse() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    return { name: parts[0] || 'home', a: parts[1], b: parts[2] };
  }
  function setActive(name) {
    var map = { home: '#/home', news: '#/news', sports: '#/sports', scores: '#/scores', schools: '#/schools', outdoors: '#/outdoors', classifieds: '#/classifieds', community: '#/community', teams: '#/teams', government: '#/government' };
    document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === map[name]); });
  }
  function render() {
    var rt = parse(); state.route = rt;
    var my = ++state.token;
    var app = $('#app');
    setActive(rt.name);
    document.title = '423.news • Local News & Sports';
    app.innerHTML = '<p class="muted">Loading…</p>';
    var p;
    try {
      if (SECTIONS[rt.name]) {
        var topic = rt.a;
        if (rt.name === 'community' && topic === 'all') topic = 'all';
        p = sectionView(rt.name, topic);
        document.title = SECTIONS[rt.name].label + ' • 423.news';
      } else if (rt.name === 'story') p = views.story(rt.a || '');
      else if (rt.name === 'search') p = views.search(rt.a || '');
      else if (rt.name === 'scores') { p = views.scores(rt.a); document.title = 'Scores & Live • 423.news'; }
      else if (views[rt.name]) p = views[rt.name]();
      else p = views.home();
    } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (html) {
      if (my !== state.token) return;
      app.innerHTML = html;
      if (rt.name === 'story') loadComments();
      if (scrollTop) window.scrollTo(0, 0);
      scrollTop = true;
    }).catch(function (e) {
      if (my !== state.token) return;
      app.innerHTML = errBox(e);
    });
  }

  /* ---------- modal ---------- */
  function openModal(html) {
    var m = $('#modal'); m.className = 'modal'; m.innerHTML = '<div class="panel" role="dialog" aria-modal="true">' + html + '</div>';
    var f = m.querySelector('input,textarea,select'); if (f) f.focus();
  }
  function closeModal() { var m = $('#modal'); m.className = ''; m.innerHTML = ''; }

  function openAuth(mode) {
    var signup = mode === 'signup';
    openModal('<h2 style="margin-top:0">' + (signup ? 'Create your account' : 'Sign in') + '</h2>' +
      '<form id="authForm" data-mode="' + (signup ? 'signup' : 'signin') + '">' +
      (signup ? '<label for="an">Display name</label><input id="an" name="name" maxlength="60" required autocomplete="nickname">' : '') +
      '<label for="ae">Email</label><input id="ae" name="email" type="email" required autocomplete="email">' +
      '<label for="ap">Password</label><input id="ap" name="password" type="password" minlength="8" required autocomplete="' + (signup ? 'new-password' : 'current-password') + '">' +
      (signup ? '<div class="hint">At least 8 characters.</div>' : '') +
      '<div id="aerr" class="muted" style="color:#f87171;min-height:20px"></div>' +
      '<div class="row-actions"><button class="btn" type="submit">' + (signup ? 'Sign up' : 'Sign in') + '</button><button class="btn dark" type="button" data-close>Cancel</button></div></form>' +
      '<p class="muted" style="margin-top:14px">' + (signup ? 'Already have an account? <button class="linkbtn" data-auth="signin">Sign in</button>'
        : 'New here? <button class="linkbtn" data-auth="signup">Create an account</button>') + '</p>');
  }

  function openSubmit(section, topic) {
    if (!state.user) { toast('Sign in to post'); openAuth('signin'); return; }
    section = SECTIONS[section] ? section : 'news';
    var opts = Object.keys(SECTIONS).map(function (k) { return '<option value="' + k + '"' + (k === section ? ' selected' : '') + '>' + SECTIONS[k].label + '</option>'; }).join('');
    openModal('<h2 style="margin-top:0">Post to 423.news</h2><form id="postForm">' +
      '<label for="ps">Section</label><select id="ps" name="section">' + opts + '</select>' +
      '<div id="topicWrap"></div>' +
      '<label for="pt">Title</label><input id="pt" name="title" maxlength="200" minlength="3" required>' +
      '<label for="pb">Details</label><textarea id="pb" name="body" rows="7" maxlength="20000" required></textarea>' +
      '<div id="priceWrap" hidden><label for="pp">Price (USD, optional)</label><input id="pp" name="price" type="number" min="0" step="0.01" inputmode="decimal"></div>' +
      '<label for="pi">Photo (optional, up to 5 MB)</label><input id="pi" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif">' +
      '<div class="hint" id="pnote"></div><div id="perr" style="color:#f87171;min-height:20px"></div>' +
      '<div class="row-actions"><button class="btn" type="submit" id="psubmit">Submit</button><button class="btn dark" type="button" data-close>Cancel</button></div></form>');
    var sel = $('#ps');
    function sync() {
      var s = sel.value, tw = $('#topicWrap');
      var list = s === 'community' ? ['general', 'events', 'discussions', 'lost', 'announcements'] : s === 'classifieds' ? ['sell', 'buy', 'trade'] : null;
      tw.innerHTML = list ? '<label for="ptp">Type</label><select id="ptp" name="topic">' + list.map(function (t) { return '<option value="' + t + '"' + (t === topic ? ' selected' : '') + '>' + TOPIC_LABEL[t] + '</option>'; }).join('') + '</select>' : '';
      $('#priceWrap').hidden = s !== 'classifieds';
      $('#pnote').textContent = (s === 'community' || s === 'classifieds' || isStaff()) ? 'Posts in this section go live right away.' : 'Stories are reviewed by an editor before they are published.';
    }
    sel.addEventListener('change', sync); sync();
  }

  function uploadImage(file) {
    if (!file || !file.size) return Promise.resolve(null);
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
    if (!ext) return Promise.reject(new Error('Photo must be a JPG, PNG, WebP or GIF.'));
    if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('Photo is larger than 5 MB.'));
    var rand = Math.random().toString(36).slice(2, 10);
    var path = state.user.id + '/' + Date.now() + '-' + rand + '.' + ext;
    return sb.storage.from('news-media').upload(path, file, { contentType: file.type, upsert: false }).then(function (r) {
      if (r.error) throw r.error;
      return MEDIA_BASE + path;
    });
  }

  /* ---------- auth state ---------- */
  function loadProfile() {
    if (!state.user) { state.profile = null; return Promise.resolve(); }
    return sb.from('news_profiles').select('id,display_name,role').eq('id', state.user.id).maybeSingle().then(function (r) {
      state.profile = r.data || null;
    });
  }
  function paintAccount() {
    var b = $('#acctBtn'), bb = $('#bAcct');
    var nm = state.user ? (state.profile ? state.profile.display_name : 'Account') : 'Sign in';
    if (b) b.textContent = nm.length > 16 ? nm.slice(0, 15) + '…' : nm;
    if (bb) bb.innerHTML = '👤<span>' + (state.user ? 'Profile' : 'Sign in') + '</span>';
    var nav = $('#nav'), old = $('#navReview');
    if (old) old.remove();
    if (isStaff()) {
      var a = document.createElement('a'); a.id = 'navReview'; a.href = '#/review'; a.textContent = 'Review';
      nav.appendChild(a);
    }
  }
  function applySession(session) {
    state.user = session && session.user ? session.user : null;
    return loadProfile().then(paintAccount);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-submit],[data-auth],[data-close],[data-share],[data-delpost],[data-delcmt],[data-unfollow],[data-setstatus],[data-signout],[data-retry],[data-play],[data-delstream]');
    if (!t) { if (e.target.id === 'modal') closeModal(); return; }
    if (t.hasAttribute('data-close')) { closeModal(); return; }
    if (t.hasAttribute('data-retry')) { render(); return; }
    if (t.hasAttribute('data-play')) {
      var st = state.streams[parseInt(t.getAttribute('data-play'), 10)];
      var pv = $('#vplayer'); if (st && pv) pv.innerHTML = player(st);
      return;
    }
    if (t.hasAttribute('data-delstream')) {
      if (!confirm('Remove this video from the site?')) return;
      sb.from('news_streams').delete().eq('id', t.getAttribute('data-delstream')).then(function (r) { if (r.error) toast(r.error.message); else { scrollTop = false; render(); } });
      return;
    }

    if (t.hasAttribute('data-submit')) { openSubmit(t.getAttribute('data-submit'), t.getAttribute('data-topic')); return; }
    if (t.hasAttribute('data-auth')) { openAuth(t.getAttribute('data-auth')); return; }
    if (t.hasAttribute('data-signout')) {
      sb.auth.signOut().then(function () { toast('Signed out'); location.hash = '#/home'; });
      return;
    }
    if (t.hasAttribute('data-share')) {
      var url = location.origin + location.pathname + '#/story/' + encodeURIComponent(t.getAttribute('data-share'));
      if (navigator.share) { navigator.share({ title: '423.news', url: url }).catch(function () {}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, function () { toast(url); }); }
      else toast(url);
      return;
    }
    if (t.hasAttribute('data-delpost')) {
      if (!confirm('Delete this post? This cannot be undone.')) return;
      sb.from('news_posts').delete().eq('id', t.getAttribute('data-delpost')).then(function (r) {
        if (r.error) { toast('Could not delete: ' + r.error.message); return; }
        toast('Deleted'); location.hash = '#/home';
      });
      return;
    }
    if (t.hasAttribute('data-delcmt')) {
      sb.from('news_comments').delete().eq('id', t.getAttribute('data-delcmt')).then(function (r) {
        if (r.error) toast('Could not delete: ' + r.error.message); else loadComments();
      });
      return;
    }
    if (t.hasAttribute('data-unfollow')) {
      sb.from('news_follows').delete().eq('user_id', state.user.id).eq('team', t.getAttribute('data-unfollow')).then(function () { render(); });
      return;
    }
    if (t.hasAttribute('data-setstatus')) {
      sb.from('news_posts').update({ status: t.getAttribute('data-setstatus') }).eq('id', t.getAttribute('data-id')).then(function (r) {
        if (r.error) toast('Failed: ' + r.error.message); else { toast('Updated'); scrollTop = false; render(); }
      });
    }
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || !f.id) return;
    e.preventDefault();

    if (f.id === 'srch' || f.id === 'srch2') {
      var q = (new FormData(f).get('q') || '').toString().trim();
      if (q) location.hash = '#/search/' + encodeURIComponent(q);
      return;
    }

    if (f.id === 'authForm') {
      var fd = new FormData(f), mode = f.getAttribute('data-mode');
      var email = fd.get('email'), pw = fd.get('password'), btn = f.querySelector('button[type=submit]');
      var err = $('#aerr'); err.textContent = ''; btn.disabled = true;
      var run = mode === 'signup'
        ? sb.auth.signUp({ email: email, password: pw, options: { data: { name: (fd.get('name') || '').toString().trim() }, emailRedirectTo: location.origin + location.pathname } })
        : sb.auth.signInWithPassword({ email: email, password: pw });
      run.then(function (r) {
        btn.disabled = false;
        if (r.error) { err.textContent = r.error.message; return; }
        if (mode === 'signup' && !r.data.session) {
          openModal('<h2 style="margin-top:0">Check your email</h2><p>We sent a confirmation link to <b>' + esc(email) + '</b>. Open it, then come back and sign in.</p><button class="btn" data-close>OK</button>');
          return;
        }
        closeModal(); toast(mode === 'signup' ? 'Welcome to 423.news!' : 'Signed in');
      });
      return;
    }

    if (f.id === 'postForm') {
      var d = new FormData(f), submit = $('#psubmit'), perr = $('#perr'); perr.textContent = '';
      submit.disabled = true; submit.textContent = 'Posting…';
      var file = d.get('image');
      uploadImage(file && file.size ? file : null).then(function (imgUrl) {
        var section = d.get('section');
        var price = section === 'classifieds' && d.get('price') !== '' && d.get('price') != null ? Number(d.get('price')) : null;
        var row = { section: section, topic: d.get('topic') || null, title: (d.get('title') || '').toString().trim(), body: (d.get('body') || '').toString().trim(), image_url: imgUrl, price: price };
        return sb.from('news_posts').insert(row).select('slug,status,section').single();
      }).then(function (r) {
        if (r.error) throw r.error;
        closeModal();
        if (r.data.status === 'pending') { toast('Thanks! Your story was sent to an editor for review.'); location.hash = '#/profile'; }
        else { toast('Posted'); location.hash = '#/story/' + encodeURIComponent(r.data.slug); }
      }).catch(function (er) {
        submit.disabled = false; submit.textContent = 'Submit';
        perr.textContent = (er && er.message) || 'Could not post. Try again.';
      });
      return;
    }

    if (f.id === 'cmtForm') {
      var ta = $('#cbody'), body = ta.value.trim(); if (!body) return;
      var pid = $('#cmts').getAttribute('data-post'); var cb = f.querySelector('button'); cb.disabled = true;
      sb.from('news_comments').insert({ post_id: pid, body: body }).then(function (r) {
        cb.disabled = false;
        if (r.error) { toast('Could not post comment: ' + r.error.message); return; }
        ta.value = ''; loadComments();
      });
      return;
    }

    if (f.id === 'streamForm') {
      var sd = new FormData(f), url = (sd.get('url') || '').toString(), kind = sd.get('kind'), ref = kind === 'playlist' ? ytList(url) : ytId(url);
      if (!ref) { toast('That does not look like a YouTube ' + (kind === 'playlist' ? 'playlist' : 'video') + ' link.'); return; }
      sb.from('news_streams').insert({ title: (sd.get('title') || '').toString().trim(), league: sd.get('league'), kind: kind, ref: ref }).then(function (r) {
        if (r.error) toast(r.error.message); else { toast('Added'); scrollTop = false; render(); }
      });
      return;
    }

    if (f.id === 'teamForm') {
      var team = (new FormData(f).get('team') || '').toString().trim(); if (!team) return;
      sb.from('news_follows').upsert({ user_id: state.user.id, team: team }, { onConflict: 'user_id,team', ignoreDuplicates: true }).then(function (r) {
        if (r.error) toast(r.error.message); else render();
      });
      return;
    }

    if (f.id === 'nameForm') {
      var nm = (new FormData(f).get('name') || '').toString().trim(); if (!nm) return;
      sb.from('news_profiles').update({ display_name: nm }).eq('id', state.user.id).then(function (r) {
        if (r.error) { toast(r.error.message); return; }
        state.profile.display_name = nm; paintAccount(); toast('Saved');
      });
    }
  });

  $('#submitBtn').addEventListener('click', function () { openSubmit('news'); });
  $('#acctBtn').addEventListener('click', function () { if (state.user) location.hash = '#/profile'; else openAuth('signin'); });
  var bp = $('#bPost'); if (bp) bp.addEventListener('click', function () { var r = state.route || {}; openSubmit(SECTIONS[r.name] ? r.name : 'community'); });
  var bs = $('#bSearch'); if (bs) bs.addEventListener('click', function () { var i = $('#q'); i.scrollIntoView({ block: 'center' }); i.focus(); });
  var ba = $('#bAcct'); if (ba) ba.addEventListener('click', function () { if (state.user) location.hash = '#/profile'; else openAuth('signin'); });

  /* ---------- realtime: refresh list pages when posts change ---------- */
  var rtTimer;
  function onChange(payload) {
    var rt = state.route || {};
    if (rt.name === 'story' && payload && payload.table === 'news_comments') { loadComments(); return; }
    if (rt.name === 'story' || rt.name === 'profile' || rt.name === 'search' || rt.name === 'teams') return;
    if ($('#modal').className) return;
    clearTimeout(rtTimer);
    rtTimer = setTimeout(function () { scrollTop = false; render(); }, 900);
  }

  var nvTimer;
  function onNewsStreams() {
    var rt = state.route || {};
    if (rt.name !== 'news' || $('#modal').className) return;
    var ae = document.activeElement; if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    clearTimeout(nvTimer);
    nvTimer = setTimeout(function () { var y = window.scrollY; scrollTop = false; render(); setTimeout(function () { window.scrollTo(0, y); }, 400); }, 1500);
  }
  var scTimer;
  function onScores() {
    var rt = state.route || {};
    if (rt.name !== 'scores' || $('#modal').className) return;
    var ae = document.activeElement; if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    clearTimeout(scTimer);
    scTimer = setTimeout(function () { var y = window.scrollY; scrollTop = false; render(); setTimeout(function () { window.scrollTo(0, y); }, 400); }, 1500);
  }
  try {
    sb.channel('news-sports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_scores' }, onScores)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_streams' }, onScores)
      .subscribe();
    sb.channel('news-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_posts' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_comments' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news_streams' }, onNewsStreams)
      .subscribe();
  } catch (e) { /* page still works without live updates */ }

  /* ---------- header weather (Open-Meteo, no key) ---------- */
  function weather() {
    var el = $('#wx'); if (!el) return;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=36.3134&longitude=-82.3535&current=temperature_2m&temperature_unit=fahrenheit')
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.current && typeof j.current.temperature_2m === 'number') el.textContent = '☀️ ' + Math.round(j.current.temperature_2m) + '°F Tri-Cities'; })
      .catch(function () {});
  }

  /* ---------- boot ---------- */
  window.addEventListener('hashchange', render);
  sb.auth.onAuthStateChange(function (event, session) {
    /* defer: calling Supabase inside this callback can deadlock the auth lock */
    setTimeout(function () {
      var before = state.user && state.user.id;
      applySession(session).then(function () {
        var after = state.user && state.user.id;
        if (before !== after && state.route) render();
      });
    }, 0);
  });
  sb.auth.getSession().then(function (r) { return applySession(r.data && r.data.session); }).then(function () { render(); weather(); });
})();
