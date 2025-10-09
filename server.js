import express from "express";
import fetch from "node-fetch";
import os from "node:os";
import { ManagedIdentityCredential, DefaultAzureCredential } from "@azure/identity";

const app = express();
const port = process.env.PORT || 8080;

app.use(express.static("public"));

// --- User info: ACA header in prod; friendly fallback in local dev ---
app.use((req, res, next) => {
  const raw = req.headers['x-ms-client-principal']; // present only behind ACA auth
  if (raw) {
    try {
      req.user = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch { /* ignore parse errors */ }
} else if (process.env.NODE_ENV !== 'production') {
  // Local dev fallback (no ACA header)
  const osUser = os.userInfo().username;
  const name = process.env.LOCAL_USER_NAME || osUser;
  const upn  = process.env.LOCAL_USER_UPN  || `${osUser}@local.dev`;
  req.user = {
    auth_typ: "local-dev",
    claims: [
      { typ: "name", val: name },
      { typ: "upn",  val: upn  },
      { typ: "oid",  val: "00000000-0000-0000-0000-000000000000" }
    ]
  };
}
  next();
});

app.get("/api/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const claims = Object.fromEntries((req.user.claims || []).map(c => [c.typ, c.val]));
  const upn =
    claims.upn ||
    claims.preferred_username ||
    claims.emails || // sometimes array-like; ACA flattens to string
    null;

  const name = claims.name || null;

  res.json({ upn, name, oid: claims.oid || null, mode: req.user.auth_typ || "aca" });
});



async function getGraphToken(log = console) {
  try {
    const mi = new ManagedIdentityCredential();
    const tok = await mi.getToken("https://graph.microsoft.com/.default");
    log.log("[MI] token OK");
    return tok.token;
  } catch (e1) {
    log.warn("[MI] failed:", e1.message);
    try {
      const dac = new DefaultAzureCredential();
      const { token } = await dac.getToken("https://graph.microsoft.com/.default");
      log.log("[DAC] token OK");
      return token;
    } catch (e2) {
      log.error("[DAC] failed:", e2.message);
      throw new Error(`No Azure credential available. MI err: ${e1.message}`);
    }
  }
}

app.get("/api/tenant", async (req, res) => {
  const subscriptionId = (req.query.subscriptionId || "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(subscriptionId)) {
    res.status(400).json({ error: "Invalid subscriptionId format." });
    return;
  }

  try {
    const armUrl = `https://management.azure.com/subscriptions/${subscriptionId}?api-version=2022-12-01`;
    const arm = await fetch(armUrl, { method: "GET" });
    const wa = arm.headers.get("www-authenticate") || "";
    const m = wa.match(/authorization_uri="([^"]+)"/i);
    if (!m) throw new Error("authorization_uri not found in ARM response.");
    const authUri = m[1];
    const guid = authUri.match(/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}/);
    if (!guid) throw new Error("Tenant GUID not found in authorization_uri.");
    const tenantId = guid[0];

    const token = await getGraphToken(console);
    const graphUrl = `https://graph.microsoft.com/v1.0/tenantRelationships/findTenantInformationByTenantId(tenantId='${tenantId}')`;
    const g = await fetch(graphUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!g.ok) {
      const t = await g.text();
      throw new Error(`Graph error ${g.status}: ${t}`);
    }
    const info = await g.json();

    res.json({
      tenantId,
      displayName: info.displayName || null,
      defaultDomainName: info.defaultDomainName || null
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

app.listen(port, () => console.log(`Listening on ${port}`));