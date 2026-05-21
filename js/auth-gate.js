(function () {
  var USERNAME = "SHERRY";
  var PASSWORD_HASH = "b32318ead6449914a75fb6c6f347358e7088fe35cde6dd5eb50418e50794b59d";

  if (sessionStorage.getItem("_auth")) return;

  function sha256(str) {
    var encoder = new TextEncoder();
    return crypto.subtle.digest("SHA-256", encoder.encode(str)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  var overlay = document.createElement("div");
  overlay.id = "auth-gate";
  overlay.innerHTML =
    '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#0d0d1a;z-index:100000;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,\'Microsoft YaHei\',sans-serif">' +
    '<div style="text-align:center;background:#141428;padding:50px 36px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.6);max-width:380px;width:90%;border:1px solid #2a2a4a">' +
    '<div style="font-size:44px;margin-bottom:16px">🔒</div>' +
    '<h1 style="color:#e94560;font-size:22px;margin-bottom:6px">SHERRY 的个人博客</h1>' +
    '<p style="color:#7a7a9a;font-size:13px;margin-bottom:28px">请输入账号密码访问</p>' +
    '<input id="auth-user" type="text" placeholder="账号" value="SHERRY" style="width:100%;padding:12px 16px;border:2px solid #2a2a4a;border-radius:8px;background:#0d0d1a;color:#eee;font-size:15px;outline:none;box-sizing:border-box;margin-bottom:12px;transition:border-color 0.3s;text-align:center" />' +
    '<input id="auth-pass" type="password" placeholder="密码" style="width:100%;padding:12px 16px;border:2px solid #2a2a4a;border-radius:8px;background:#0d0d1a;color:#eee;font-size:15px;outline:none;box-sizing:border-box;text-align:center;transition:border-color 0.3s" />' +
    '<button id="auth-btn" style="width:100%;margin-top:20px;padding:12px;background:#e94560;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600;transition:background 0.3s">进入博客</button>' +
    '<p id="auth-error" style="color:#e94560;font-size:13px;margin-top:16px;display:none">账号或密码错误</p>' +
    "</div></div>";

  document.documentElement.style.overflow = "hidden";
  document.body.appendChild(overlay);

  var userInput = document.getElementById("auth-user");
  var passInput = document.getElementById("auth-pass");
  var errorEl = document.getElementById("auth-error");
  var btn = document.getElementById("auth-btn");

  setTimeout(function () { passInput.focus(); }, 400);

  function tryAuth() {
    var user = userInput.value.trim();
    var pass = passInput.value;
    if (user !== USERNAME) { showError(); return; }
    sha256(pass).then(function (hash) {
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem("_auth", "1");
        document.documentElement.style.overflow = "";
        overlay.remove();
      } else {
        showError();
      }
    });
  }

  function showError() {
    errorEl.style.display = "block";
    passInput.value = "";
    passInput.focus();
    passInput.style.borderColor = "#e94560";
    setTimeout(function () { passInput.style.borderColor = "#2a2a4a"; }, 1500);
  }

  btn.addEventListener("click", tryAuth);
  passInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryAuth();
  });
  userInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { passInput.focus(); }
  });
})();
