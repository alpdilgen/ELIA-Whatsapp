/* Group page: read export, render WhatsApp-style chat flow,
   search, list top contributors. */

(function () {
  "use strict";

  var BATCH = 120;           // messages rendered per load
  var SEARCH_CAP = 600;      // max search results shown
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  var state = { all: [], rendered: 0, group: null };

  function $(id) { return document.getElementById(id); }
  function param(k) { return new URLSearchParams(location.search).get(k); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return n.toLocaleString("en-US"); }

  // Stable color per name (like WhatsApp group sender colors)
  var PALETTE = ["#1f8a70","#0a7cba","#b5651d","#9b1d64","#5b4ad6","#127e6b",
                 "#c0392b","#7d6608","#16635a","#8e44ad","#2c7873","#a04000"];
  function colorFor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function initials(name) {
    var parts = name.trim().split(/\s+/);
    var a = parts[0] ? parts[0][0] : "?";
    var b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase();
  }
  function dayKey(m) { return m.y + "-" + m.mo + "-" + m.d; }
  function dayLabel(m) { return m.d + " " + MONTHS[m.mo - 1] + " " + m.y; }
  function timeLabel(m) {
    return ("0" + m.hh).slice(-2) + ":" + ("0" + m.mi).slice(-2);
  }

  function highlight(text, q) {
    var safe = esc(text);
    if (!q) return safe;
    var rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return safe.replace(rx, "<mark>$1</mark>");
  }

  function bubbleHTML(m, q) {
    var inner = m.media
      ? '<span class="bubble__media">📎 Media (not included)</span>'
      : '<span class="bubble__text">' + highlight(m.text, q) + "</span>";
    return (
      '<div class="msg"><div class="bubble">' +
        '<span class="bubble__sender" style="color:' + colorFor(m.sender) + '">' + esc(m.sender) + "</span>" +
        inner +
        '<span class="bubble__time">' + timeLabel(m) + "</span>" +
      "</div></div>"
    );
  }

  // Convert a slice of messages to HTML, inserting day separators.
  function sliceHTML(msgs, q, prevDay) {
    var html = "";
    var last = prevDay || null;
    for (var i = 0; i < msgs.length; i++) {
      var k = dayKey(msgs[i]);
      if (k !== last) {
        html += '<div class="datesep"><span>' + dayLabel(msgs[i]) + "</span></div>";
        last = k;
      }
      html += bubbleHTML(msgs[i], q);
    }
    return { html: html, lastDay: last };
  }

  // Normal view: newest messages at the bottom, older loaded on demand.
  function renderInitial() {
    var chat = $("chat");
    chat.innerHTML = "";
    state.rendered = 0;
    if (!state.all.length) {
      chat.innerHTML =
        '<div class="chat-empty"><b>No conversation history yet</b>' +
        "Messages will appear here once the export file is added for this group.</div>";
      return;
    }
    appendOlder(true);
  }

  // Prepend older messages to the chat (preserve scroll position).
  function appendOlder(scrollToBottom) {
    var chat = $("chat");
    var total = state.all.length;
    var end = total - state.rendered;
    var start = Math.max(0, end - BATCH);
    var chunk = state.all.slice(start, end);
    if (!chunk.length) return;

    var out = sliceHTML(chunk, null, null);

    var prevH = chat.scrollHeight;
    // Keep the "load more" button at the top if it exists
    var btn = chat.querySelector(".loadmore");
    if (btn) btn.remove();

    chat.insertAdjacentHTML("afterbegin", out.html);
    state.rendered += chunk.length;

    if (start > 0) {
      var b = document.createElement("button");
      b.className = "loadmore";
      b.textContent = "↑ Load older messages";
      b.onclick = function () { appendOlder(false); };
      chat.insertAdjacentElement("afterbegin", b);
    }

    if (scrollToBottom) {
      chat.scrollTop = chat.scrollHeight;
    } else {
      chat.scrollTop = chat.scrollHeight - prevH; // keep position stable
    }
  }

  // Search view: filter across full history.
  function renderSearch(q) {
    var chat = $("chat");
    var ql = q.toLowerCase();
    var hits = state.all.filter(function (m) {
      return !m.media && m.text.toLowerCase().indexOf(ql) > -1;
    });
    $("search-count").textContent = hits.length + " results";

    if (!hits.length) {
      chat.innerHTML = '<div class="chat-empty"><b>No results</b>No messages found for "' + esc(q) + '".</div>';
      return;
    }
    var capped = hits.slice(0, SEARCH_CAP);
    var out = sliceHTML(capped, q, null);
    chat.innerHTML = out.html;
    if (hits.length > SEARCH_CAP) {
      chat.insertAdjacentHTML("beforeend",
        '<div class="chat-empty">Showing first ' + SEARCH_CAP + " results. Try a more specific search.</div>");
    }
    chat.scrollTop = 0;
  }

  function renderContributors(list) {
    var ul = $("contrib");
    if (!list.length) { ul.innerHTML = '<li class="skeleton">No data yet.</li>'; return; }
    var top = list.slice(0, 8);
    var max = top[0].count;
    ul.innerHTML = top.map(function (c, i) {
      var pct = Math.round((c.count / max) * 100);
      return (
        "<li>" +
          '<span class="contrib__rank">' + (i + 1) + "</span>" +
          '<span class="contrib__av" style="background:' + colorFor(c.name) + '">' + esc(initials(c.name)) + "</span>" +
          '<span class="contrib__info">' +
            '<span class="contrib__name">' + esc(c.name) + "</span>" +
            '<span class="contrib__bar"><i style="width:' + pct + '%"></i></span>' +
          "</span>" +
          '<span class="contrib__num">' + fmt(c.count) + "</span>" +
        "</li>"
      );
    }).join("");
  }

  function setHeader(g, stats) {
    document.title = g.name + " — ELIA";
    $("ch-name").textContent = g.name;
    $("s-desc").textContent = g.description || "";
    $("join").href = g.invite;

    var logo = $("ch-logo");
    loadLogo(logo, g.slug, g.emoji);

    if (stats) {
      $("ch-meta").textContent = fmt(stats.memberCount) + " members · " + fmt(stats.messageCount) + " messages";
      $("s-members").textContent = fmt(stats.memberCount);
      $("s-messages").textContent = fmt(stats.messageCount);
    } else {
      $("ch-meta").textContent = "awaiting conversation history";
    }
  }

  function showError(msg) {
    $("chat").innerHTML = '<div class="chat-error"><b>' + esc(msg) + "</b></div>";
  }

  // Show rules: use group-specific rules if present, otherwise community rules.
  function renderRules(communityRules, groupRules) {
    var rules = (groupRules && groupRules.length) ? groupRules : communityRules;
    var panel = $("rules-panel");
    if (!panel) return;
    if (!rules || !rules.length) { panel.style.display = "none"; return; }
    $("rules-list").innerHTML = rules.map(function (r) {
      if (r && typeof r === "object") {
        return "<li><b>" + esc(r.t) + "</b><span>" + esc(r.d) + "</span></li>";
      }
      return "<li><span>" + esc(r) + "</span></li>";
    }).join("");
  }

  // --- Initialise ---
  var slug = param("g");
  if (!slug) { location.href = "index.html"; return; }

  fetch("data/groups.json", { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var g = cfg.groups.filter(function (x) { return x.slug === slug; })[0];
      if (!g) { showError("Group not found."); return; }
      state.group = g;
      setHeader(g, null);
      renderRules(cfg.rules, g.rules);

      return fetch("data/chats/" + slug + ".txt", { cache: "no-cache" }).then(function (r) {
        if (!r.ok) { setHeader(g, null); renderInitial(); return; }
        return r.text().then(function (txt) {
          if (!txt.trim()) { renderInitial(); return; }
          var p = WAParser.parse(txt);
          state.all = p.messages;
          setHeader(g, { memberCount: p.memberCount, messageCount: p.messageCount });
          renderContributors(p.contributors);
          renderInitial();
        });
      });
    })
    .catch(function () { showError("Could not load data."); });

  // Search (debounced)
  var t = null;
  document.addEventListener("input", function (e) {
    if (e.target.id !== "search") return;
    clearTimeout(t);
    var q = e.target.value.trim();
    t = setTimeout(function () {
      if (!q) { $("search-count").textContent = ""; renderInitial(); }
      else renderSearch(q);
    }, 180);
  });
})();
