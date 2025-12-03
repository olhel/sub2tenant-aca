(function () {
  const CLIENT_ID_KEY = "s2t_clientId";
  let clientId = null;

  try {
    clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      if (window.crypto && crypto.randomUUID) {
        clientId = crypto.randomUUID();
      } else {
        clientId = "cid-" + Math.random().toString(36).slice(2) + Date.now();
      }
      localStorage.setItem(CLIENT_ID_KEY, clientId);
    }
  } catch {
    clientId = null;
  }

  window.__s2tClientId = clientId;

  function logVisit() {
    const payload = {
      path: window.location.pathname,
      ts: new Date().toISOString(),
    };

    fetch("/api/visit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientId ? { "X-Client-Id": clientId } : {}),
      },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", logVisit);
  } else {
    logVisit();
  }
})();
