/* =========================================================================
   WhatsApp conversation history parser — v4
   -------------------------------------------------------------------------
   - iOS / Android, English / Turkish, 24-hour and AM/PM.
   - Strips system messages from the chat view and uses them to count members:
        members = (joined ∪ added ∪ created ∪ sent messages) − (left ∪ removed)

   iOS format: system messages appear as "Sender: Sender did_something".
   Fix: extract senderHint from before ":" and pass it to handleSystem so
   single-person actions (join/leave/create) use the clean sender field
   rather than a regex capture that includes "Sender: Sender extra text".

   English system-pattern guard: "added", "joined", "left" appear in normal
   chat. English patterns are only tested when the senderHint appears in the
   message text (iOS indicator) or when there is no senderHint (Android).
   Turkish keywords (katıldı, ekledi, ayrıldı …) are specific enough to be
   tested unconditionally.
   ========================================================================= */

(function (global) {
  "use strict";

  // Word boundary safe for Turkish (no \b after ı/ş/ğ/ç).
  var NB = "(?![A-Za-zÇĞİıÖŞÜçğıöşü])";
  function rx(b, f) { return new RegExp(b, f || "i"); }

  function clean(str) {
    return str
      .replace(/[‎‏‪-‮⁦-⁩]/g, "")
      .replace(/ | /g, " ")
      .replace(/\r/g, "");
  }

  function norm(name) {
    return (name || "")
      .replace(/^[\s,~"'•·-]+|[\s,.:;~"'•·-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Line start: date + time (+ optional AM/PM). iOS wraps in square brackets.
  var LINE_START =
    /^\[?\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})[,.]?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([APap])?\.?\s*([Mm])?\.?\s*\]?\s*[-–]?\s*/;

  // ---- System message patterns (tested against the message part only) ----

  // Self-join: phone owner joined the group. Return true, add no one
  // (the owner will appear in `present` through their own messages).
  var RE_SELFJOIN = rx(
    "^(?:" +
      "siz\\s+katıldınız" + "|" +
      "you\\s+joined" + "|" +
      "bu\\s+gruba\\s+(?:davet.*)?katıldınız" + "|" +
      "(?:bir\\s+grup\\s+bağlantısıyla|davet\\s+bağlantısıyla)\\s+katıldınız" + "|" +
      "katıldınız" +
    ")"
  );

  // "X joined [using an invite link / via invite link / …]"  (Turkish & English)
  var RE_JOINED = rx(
    "^(.*?)\\s+(?:bu\\s+)?(?:gruba\\s+)?" +
    "(?:(?:bir\\s+grup|davet)\\s+bağlantısıyla\\s+)?" +
    "(?:davet\\s+bağlantısı\\s+(?:aracılığıyla|kullanarak|üzerinden)\\s+)?" +
    "(?:telefon\\s+numarası(?:nı)?\\s+kullanan\\s+kişi\\s+)?" +
    "katıldı" + NB + ".*$"
  );
  // English join — only checked when isLikelySysMsg (see parse loop)
  var RE_JOINED_EN = rx("^(.*?)\\s+joined" + NB + ".*$");

  var RE_CREATED  = rx("^(.*?)\\s+(?:\".+?\"\\s+)?(?:grubu(?:nu)?|group)\\s+(?:oluşturdu|created)" + NB + ".*$");
  var RE_CREATED2 = rx("^(.*?)\\s+created\\s+(?:this\\s+)?group" + NB + ".*$");

  // "A [,] B'i gruba ekledi"  (Turkish)
  var RE_ADDED    = rx("^(.*?),\\s+(.+?)(?:'[^\\s]*)?\\s+(?:gruba\\s+)?ekledi" + NB + ".*$");
  // "A added B"  (English) — only checked when isLikelySysMsg
  var RE_ADDED_EN = rx("^(.*?)\\s+added\\s+(.+?)\\.?$");

  // "Sizi ekledi" / "You were added"
  var RE_YOUADDED = rx("^(?:bu\\s+gruba\\s+eklendiniz|you\\s+were\\s+added|.*\\s+sizi\\s+ekledi)");
  // "X gruba eklendi"  (Turkish passive)
  var RE_ADDED_PASSIVE = rx("^(.*?)\\s+(?:bu\\s+)?(?:gruba\\s+)?eklendi" + NB + ".*$");

  var RE_LEFT    = rx("^(.*?)\\s+(?:gruptan\\s+)?ayrıldı" + NB + ".*$");
  // English left — only checked when isLikelySysMsg
  var RE_LEFT_EN = rx("^(.*?)\\s+left" + NB + ".*$");

  var RE_REMOVED  = rx("^(.*?),\\s+(.+?)(?:'[^\\s]*)?\\s+(?:gruptan\\s+)?çıkardı" + NB + ".*$");
  // English removed — only checked when isLikelySysMsg
  var RE_REMOVED_EN = rx("^(.*?)\\s+removed\\s+(.+?)\\.?$");

  var RE_REMOVED_PASSIVE = rx("^(.*?)\\s+(?:gruptan\\s+)?çıkarıldı" + NB + ".*$");
  var RE_REMOVED_YOU = rx("^(.*?)\\s+kişisini\\s+(?:gruptan\\s+)?çıkardın(?:ız)?" + NB + ".*$");
  var RE_ADDED_YOU   = rx("^(.*?)\\s+kişisini\\s+(?:gruba\\s+)?ekledin(?:iz)?" + NB + ".*$");

  var RE_IGNORE = [
    /katılma\s+isteği\s+gönderdi/i, /requested\s+to\s+join/i,
    /katılma\s+isteğini?\s+(?:onayladı|reddetti|geri\s+çek|iptal)/i,
    /approved\s+(?:the\s+)?(?:join\s+)?request/i, /rejected\s+(?:the\s+)?(?:join\s+)?request/i,
    /katılmak\s+için\s+yönetici\s+onay/i, /yönetici\s+onayın?ı?\s+(?:etkinleştir|devre\s+dışı|kapat|aç)/i,
    /admin\s+approval/i,
    /uçtan\s+uca\s+şifreli/i, /end-to-end\s+encrypted/i,
    /güvenlik\s+kodun?u?z?\s+değişti/i, /security\s+code\s+changed/i,
    /grup\s+açıklamasını\s+(?:değiştirdi|güncelledi)/i, /changed\s+the\s+group\s+description/i,
    /grup\s+(?:simgesini|resmini|fotoğrafını)\s+(?:değiştirdi|sildi)/i, /changed\s+this\s+group'?s?\s+icon/i,
    /(?:grubun\s+)?konusunu\s+.*\s+olarak\s+değiştirdi/i, /grup\s+adını\s+.*\s+değiştirdi/i, /changed\s+the\s+subject/i,
    /grup\s+ayarlarını\s+değiştirdi/i, /changed\s+the\s+group\s+settings/i,
    /sadece\s+yöneticiler/i, /yalnızca\s+yöneticiler/i,
    /mesajların\s+süresi\s+dol/i, /disappearing\s+messages/i, /kaybolan\s+mesaj/i,
    /telefon\s+numarası(?:nı)?\s+değiştirdi/i, /changed\s+(?:their|to)\s+(?:a\s+new\s+)?(?:phone\s+)?number/i,
    /bu\s+mesajı?\s+sildi/i, /this\s+message\s+was\s+deleted/i, /you\s+deleted\s+this\s+message/i,
    /(?:bir\s+mesaj|mesaj)\s+sabitledi/i, /pinned\s+a\s+message/i,
    /(?:artık\s+)?yönetici\s+(?:yapıldı|oldu|değil)/i, /(?:is\s+now\s+an?|no\s+longer)\s+admin/i,
    /davet\s+bağlantısını\s+sıfırladı/i, /reset\s+(?:this\s+group'?s?\s+)?invite\s+link/i,
    /güvenlik\s+numaranız/i
  ];

  // Split comma/ve/and separated names; strip Turkish kişisini suffix and
  // trailing possessives.
  function names(chunk) {
    if (!chunk) return [];
    return chunk
      .split(/,|\s+ve\s+|\s+and\s+/i)
      .map(function (n) {
        return norm(
          n.replace(/[''][^\s]*$/u, "")        // trailing possessive ('s etc.)
           .replace(/\s+kişisi(?:ni|nin)?$/i, "")  // Turkish "kişisini" suffix
        );
      })
      .filter(Boolean);
  }

  // handleSystem: detect and process system actions from the message part.
  //   text       — message part (after "Sender: " has been stripped in iOS)
  //   senderHint — name from before ":" (iOS); null for Android plain messages
  //   isSysCtx   — true when senderHint appears in text (iOS system-msg signal)
  //                or when there is no senderHint (Android format).
  //                English join/left/added/removed patterns are gated on this
  //                to avoid false-positives on regular chat.
  function handleSystem(text, present, removed, senderHint, isSysCtx) {
    var m;

    // Self-join: just mark as handled, don't add to present.
    if (RE_SELFJOIN.test(text)) { return true; }
    if (RE_YOUADDED.test(text)) { return true; }

    if ((m = text.match(RE_CREATED)) || (m = text.match(RE_CREATED2))) {
      var c = senderHint || norm(m[1]);
      if (c) { present.add(c); removed.delete(c); }
      return true;
    }

    // Turkish add/remove patterns — specific enough to run unconditionally.
    if ((m = text.match(RE_ADDED))) {
      names(m[2]).forEach(function (n) { present.add(n); removed.delete(n); });
      return true;
    }
    if ((m = text.match(RE_REMOVED))) {
      names(m[2]).forEach(function (n) { removed.add(n); present.delete(n); });
      return true;
    }
    if ((m = text.match(RE_REMOVED_YOU))) {
      var ry = norm(m[1]); if (ry) { removed.add(ry); present.delete(ry); } return true;
    }
    if ((m = text.match(RE_ADDED_YOU))) {
      var ay = norm(m[1]); if (ay) { present.add(ay); removed.delete(ay); } return true;
    }

    // Turkish join/leave/passive-add/passive-remove — unconditional.
    if ((m = text.match(RE_JOINED))) {
      var jt = senderHint || norm(m[1]);
      if (jt) { present.add(jt); removed.delete(jt); }
      return true;
    }
    if ((m = text.match(RE_ADDED_PASSIVE))) {
      var ap = senderHint || norm(m[1]);
      if (ap) { present.add(ap); removed.delete(ap); }
      return true;
    }
    if ((m = text.match(RE_LEFT))) {
      var lt = senderHint || norm(m[1]);
      if (lt) { removed.add(lt); present.delete(lt); }
      return true;
    }
    if ((m = text.match(RE_REMOVED_PASSIVE))) {
      var rp = senderHint || norm(m[1]);
      if (rp) { removed.add(rp); present.delete(rp); }
      return true;
    }

    // English patterns — gated: only run when this looks like a system message.
    // Words like "added", "joined", "left" are common in regular chat text;
    // without gating they generate false members from normal messages.
    if (isSysCtx) {
      if ((m = text.match(RE_ADDED_EN))) {
        names(m[2]).forEach(function (n) { present.add(n); removed.delete(n); });
        return true;
      }
      if ((m = text.match(RE_REMOVED_EN))) {
        names(m[2]).forEach(function (n) { removed.add(n); present.delete(n); });
        return true;
      }
      if ((m = text.match(RE_JOINED_EN))) {
        var je = senderHint || norm(m[1]);
        if (je) { present.add(je); removed.delete(je); }
        return true;
      }
      if ((m = text.match(RE_LEFT_EN))) {
        var le = senderHint || norm(m[1]);
        if (le) { removed.add(le); present.delete(le); }
        return true;
      }
    }

    for (var i = 0; i < RE_IGNORE.length; i++) if (RE_IGNORE[i].test(text)) return true;
    return false;
  }

  function parse(raw) {
    var lines = clean(raw || "").split("\n");
    var entries = [];
    var cur = null;

    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(LINE_START);
      if (m) {
        if (cur) entries.push(cur);
        var yyyy = m[3].length === 2 ? "20" + m[3] : m[3];
        var hh = parseInt(m[4], 10);
        var ap = (m[7] || "").toUpperCase();
        if (ap === "P" && hh < 12) hh += 12;
        if (ap === "A" && hh === 12) hh = 0;
        cur = {
          d: parseInt(m[1], 10), mo: parseInt(m[2], 10), y: parseInt(yyyy, 10),
          hh: hh, mi: parseInt(m[5], 10),
          body: lines[i].slice(m[0].length)
        };
      } else if (cur) {
        cur.body += "\n" + lines[i];
      }
    }
    if (cur) entries.push(cur);

    var present = new Set();
    var removed = new Set();
    var messages = [];
    var counts = {};

    for (var j = 0; j < entries.length; j++) {
      var e = entries[j], body = e.body;

      // ── Step 1: Extract senderHint from "Sender: Message" prefix (iOS).
      var sep = body.indexOf(": ");
      var senderHint = null;
      var msgPart = body;
      if (sep > 0 && sep <= 80 && body.slice(0, sep).indexOf("\n") === -1) {
        senderHint = norm(body.slice(0, sep));
        msgPart = body.slice(sep + 2);
      }

      // ── Step 2: Determine if this looks like a system message context.
      //    iOS system messages repeat the sender name in the message body.
      //    Android system messages have no "Sender:" prefix at all.
      var t = msgPart.trim();
      var isSysCtx = !senderHint || (senderHint && t.indexOf(senderHint) >= 0);

      if (handleSystem(t, present, removed, senderHint, isSysCtx)) continue;

      // ── Step 3: Regular chat message.
      if (!senderHint) continue;
      var sender = senderHint;
      var content = t;

      present.add(sender);
      removed.delete(sender);
      counts[sender] = (counts[sender] || 0) + 1;

      var isMedia =
        /<\s*medya\s+dahil\s+edilmedi\s*>/i.test(content) ||
        /<\s*media\s+omitted\s*>/i.test(content) ||
        /(görsel|video|ses|belge|çıkartma|gif|sticker)\s+dahil\s+edilmedi/i.test(content) ||
        /(image|video|audio|document|sticker|gif)\s+omitted/i.test(content) ||
        /\.(jpg|jpeg|png|mp4|mov|pdf|opus|aac|m4a|webp|gif)\s+(?:eklendi)/i.test(content);

      messages.push({ sender: sender, text: content, media: isMedia,
                      y: e.y, mo: e.mo, d: e.d, hh: e.hh, mi: e.mi });
    }

    var contributors = Object.keys(counts)
      .map(function (n) { return { name: n, count: counts[n] }; })
      .sort(function (a, b) { return b.count - a.count; });

    return { messages: messages, memberCount: present.size,
             messageCount: messages.length, contributors: contributors };
  }

  global.WAParser = { parse: parse, clean: clean, norm: norm };
})(window);
