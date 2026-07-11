/* =========================================================================
   WhatsApp konuşma geçmişi ayrıştırıcı (parser) — v3
   -------------------------------------------------------------------------
   - iOS/Android, Türkçe/İngilizce, 24 saat ve AM/PM.
   - "katıldı / ayrıldı / ekledi / çıkardı / oluşturdu" sistem satırlarını
     SOHBETTEN TEMİZLER, ÜYE SAYISINI bunlardan hesaplar:
        üye = (katılan ∪ eklenen ∪ oluşturan ∪ mesaj atan) − (ayrılan ∪ çıkarılan)
   - NOT: JS'te \b, Türkçe ı/ş/ğ/ç harflerinden sonra çalışmaz. Bu yüzden
     kelime sınırı için NB (Türkçe-güvenli lookahead) kullanılır.
   ========================================================================= */

(function (global) {
  "use strict";

  // Türkçe-güvenli kelime sınırı (kelimeden sonra başka harf gelmesin).
  var NB = "(?![A-Za-zÇĞİıÖŞÜçğıöşü])";
  function rx(body, flags) { return new RegExp(body, flags || "i"); }

  function clean(str) {
    return str
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\u00a0|\u202f/g, " ")
      .replace(/\r/g, "");
  }

  function norm(name) {
    return (name || "")
      .replace(/^[\s,~"'•·-]+|[\s,.:;~"'•·-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Satır başı: tarih + saat (+ opsiyonel AM/PM). iOS köşeli parantez de olur.
  var LINE_START =
    /^\[?\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})[,.]?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([APap])?\.?\s*([Mm])?\.?\s*\]?\s*[-–]?\s*/;

  // ---- Sistem mesajı kalıpları (satırın TAMAMINA bakılır) ----
  var RE_JOINED   = rx("^(.*?)\\s+(?:bu\\s+)?(?:gruba\\s+)?(?:davet\\s+bağlantısı\\s+(?:aracılığıyla|kullanarak|üzerinden)\\s+)?(?:telefon\\s+numarası(?:nı)?\\s+kullanan\\s+kişi\\s+)?katıldı" + NB + ".*$");
  var RE_JOINED_EN= rx("^(.*?)\\s+joined" + NB + ".*$");
  var RE_SELFJOIN = rx("^(?:siz\\s+katıldınız|you\\s+joined|bu\\s+gruba\\s+(?:davet.*)?katıldınız)");
  var RE_CREATED  = rx("^(.*?)\\s+(?:\".+?\"\\s+)?(?:grubu(?:nu)?|group)\\s+(?:oluşturdu|created)" + NB + ".*$");
  var RE_CREATED2 = rx("^(.*?)\\s+created\\s+(?:this\\s+)?group" + NB + ".*$");
  var RE_ADDED    = rx("^(.*?),\\s+(.+?)(?:'[^\\s]*)?\\s+(?:gruba\\s+)?ekledi" + NB + ".*$");
  var RE_ADDED_EN = rx("^(.*?)\\s+added\\s+(.+?)\\.?$");
  var RE_YOUADDED = rx("^(?:bu\\s+gruba\\s+eklendiniz|you\\s+were\\s+added|.*\\s+sizi\\s+ekledi)");
  var RE_ADDED_PASSIVE = rx("^(.*?)\\s+(?:bu\\s+)?(?:gruba\\s+)?eklendi" + NB + ".*$");

  var RE_LEFT     = rx("^(.*?)\\s+(?:gruptan\\s+)?ayrıldı" + NB + ".*$");
  var RE_LEFT_EN  = rx("^(.*?)\\s+left" + NB + ".*$");
  var RE_REMOVED  = rx("^(.*?),\\s+(.+?)(?:'[^\\s]*)?\\s+(?:gruptan\\s+)?çıkardı" + NB + ".*$");
  var RE_REMOVED_EN = rx("^(.*?)\\s+removed\\s+(.+?)\\.?$");
  var RE_REMOVED_PASSIVE = rx("^(.*?)\\s+(?:gruptan\\s+)?çıkarıldı" + NB + ".*$");

  // "Ahmet kişisini çıkardınız" (siz/admin çıkardı) -> çıkarılan = isim
  var RE_REMOVED_YOU = rx("^(.*?)\\s+kişisini\\s+(?:gruptan\\s+)?çıkardın(?:ız)?" + NB + ".*$");
  // "Ahmet kişisini eklediniz" (siz/admin ekledi) -> eklenen = isim
  var RE_ADDED_YOU = rx("^(.*?)\\s+kişisini\\s+(?:gruba\\s+)?ekledin(?:iz)?" + NB + ".*$");

  var RE_IGNORE = [
    // Katılma isteği GÖNDEREN kişi henüz ÜYE DEĞİLDİR; gizle ve sayma.
    /katılma\s+isteği\s+gönderdi/i, /requested\s+to\s+join/i,
    /katılma\s+isteğini?\s+(?:onayladı|reddetti|geri\s+çek|iptal)/i,
    /approved\s+(?:the\s+)?(?:join\s+)?request/i, /rejected\s+(?:the\s+)?(?:join\s+)?request/i,
    // Yönetici onayı / grup ayarları
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

  function names(chunk) {
    if (!chunk) return [];
    return chunk
      .split(/,|\s+ve\s+|\s+and\s+/i)
      .map(function (n) { return norm(n.replace(/['’][^\s]*$/u, "")); })
      .filter(Boolean);
  }

  function handleSystem(text, present, removed) {
    var m;
    if (RE_SELFJOIN.test(text)) { present.add("Siz"); return true; }
    if (RE_YOUADDED.test(text)) { present.add("Siz"); return true; }
    if ((m = text.match(RE_CREATED)) || (m = text.match(RE_CREATED2))) {
      var c = norm(m[1]); if (c) { present.add(c); removed.delete(c); } return true;
    }
    if ((m = text.match(RE_ADDED)) || (m = text.match(RE_ADDED_EN))) {
      names(m[2]).forEach(function (n) { present.add(n); removed.delete(n); }); return true;
    }
    if ((m = text.match(RE_REMOVED)) || (m = text.match(RE_REMOVED_EN))) {
      names(m[2]).forEach(function (n) { removed.add(n); present.delete(n); }); return true;
    }
    if ((m = text.match(RE_REMOVED_YOU))) {
      var ry = norm(m[1]); if (ry) { removed.add(ry); present.delete(ry); } return true;
    }
    if ((m = text.match(RE_ADDED_YOU))) {
      var ay = norm(m[1]); if (ay) { present.add(ay); removed.delete(ay); } return true;
    }
    if ((m = text.match(RE_JOINED)) || (m = text.match(RE_JOINED_EN))) {
      var j = norm(m[1]); if (j) { present.add(j); removed.delete(j); } return true;
    }
    if ((m = text.match(RE_ADDED_PASSIVE))) {
      var a = norm(m[1]); if (a) { present.add(a); removed.delete(a); } return true;
    }
    if ((m = text.match(RE_LEFT)) || (m = text.match(RE_LEFT_EN))) {
      var l = norm(m[1]); if (l) { removed.add(l); present.delete(l); } return true;
    }
    if ((m = text.match(RE_REMOVED_PASSIVE))) {
      var r = norm(m[1]); if (r) { removed.add(r); present.delete(r); } return true;
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
      var e = entries[j], body = e.body, t = body.trim();

      if (handleSystem(t, present, removed)) continue; // sistem satırı: gizle, say

      var sep = body.indexOf(": ");
      if (sep < 0 || sep > 60 || body.slice(0, sep).indexOf("\n") !== -1) continue;
      var sender = norm(body.slice(0, sep));
      if (!sender) continue;
      var content = body.slice(sep + 2).trim();

      present.add(sender);
      removed.delete(sender);
      counts[sender] = (counts[sender] || 0) + 1;

      var isMedia =
        /<\s*medya\s+dahil\s+edilmedi\s*>/i.test(content) ||
        /<\s*media\s+omitted\s*>/i.test(content) ||
        /(görsel|video|ses|belge|çıkartma|gif|sticker)\s+dahil\s+edilmedi/i.test(content) ||
        /(image|video|audio|document|sticker|gif)\s+omitted/i.test(content);

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
