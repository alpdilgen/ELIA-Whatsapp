/* Logo yükleyici: dosya uzantısını otomatik dener (png, jpg, jpeg, webp).
   Hiçbiri yoksa grubun emojisine düşer. Böylece logoları PNG veya JPEG
   olarak yükleyebilirsin; kod ikisini de bulur. */
(function (global) {
  "use strict";
  var EXTS = ["png", "jpg", "jpeg", "webp"];

  function loadLogo(el, slug, emoji) {
    if (!el) return;
    var i = 0;
    (function next() {
      if (i >= EXTS.length) { el.textContent = emoji || "💬"; return; }
      var img = new Image();
      img.alt = "";
      img.onload = function () { el.innerHTML = ""; el.appendChild(img); };
      img.onerror = function () { i++; next(); };
      img.src = "data/logos/" + slug + "." + EXTS[i];
    })();
  }

  global.loadLogo = loadLogo;
})(window);
