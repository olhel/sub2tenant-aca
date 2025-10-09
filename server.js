import express from "express";
import fetch from "node-fetch";
import { ManagedIdentityCredential, DefaultAzureCredential } from "@azure/identity";

const app = express();
const port = process.env.PORT || 8080;

app.use(express.static("public"));

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