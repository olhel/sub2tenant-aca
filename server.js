import express from "express";
import fetch from "node-fetch";
import { ManagedIdentityCredential, DefaultAzureCredential } from "@azure/identity";

const app = express();
const port = process.env.PORT || 8080;

// ---------- Middleware ----------

// Serve static files from /public
app.use(express.static("public"));

// Parse JSON bodies
app.use(express.json());

// Extract authenticated user from EasyAuth header (if present)
app.use((req, _res, next) => {
  const raw = req.headers["x-ms-client-principal"];
  if (!raw) {
    return next();
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64").toString("utf8")
    );

    const claims = decoded.claims || [];

    const getClaim = (type) =>
      claims.find((c) => c.typ === type)?.val;

    const name =
      getClaim("name") ||
      getClaim("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name");

    const upn =
      getClaim("upn") ||
      getClaim(
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"
      ) ||
      getClaim("preferred_username");

    const oid = getClaim("oid");
    const tid = getClaim("tid");

    req.user = {
      name: name || null,
      upn: upn || null,
      oid: oid || null,
      tid: tid || null,
      authType: decoded.auth_typ || "aad",
    };
  } catch {
    // If parsing fails we just treat the request as anonymous
    req.user = undefined;
  }

  next();
});

// ---------- Helpers ----------
function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Use managed identity in ACA; DefaultAzureCredential is handy for local dev
let credential;
if (
  process.env.AZURE_CLIENT_ID ||
  process.env.MSI_ENDPOINT ||
  process.env.IDENTITY_ENDPOINT
) {
  credential = new ManagedIdentityCredential();
} else {
  credential = new DefaultAzureCredential();
}

async function getTenantIdFromSubscription(subscriptionId) {
  const url =
    "https://management.azure.com/subscriptions/" +
    encodeURIComponent(subscriptionId) +
    "?api-version=2020-01-01";

  // Intentionally call ARM *without* auth; we expect 401 with a WWW-Authenticate header
  const r = await fetch(url);
  if (r.status !== 401) {
    throw new Error(
      `Unexpected response from ARM (${r.status}) while resolving tenantId`
    );
  }

  const authHeader = r.headers.get("www-authenticate") || "";
  const match =
    authHeader.match(
      /authorization_uri=\"https:\/\/login\.windows\.net\/([0-9a-fA-F-]+)\"/i
    ) ||
    authHeader.match(
      /authorization_uri=\"https:\/\/login\.microsoftonline\.com\/([0-9a-fA-F-]+)\"/i
    );

  if (!match) {
    throw new Error("Could not parse tenantId from ARM WWW-Authenticate header");
  }

  return match[1];
}

async function getTenantInfoFromGraph(tenantId) {
  const scope = "https://graph.microsoft.com/.default";
  const token = await credential.getToken(scope);

  if (!token || !token.token) {
    throw new Error("Failed to obtain access token for Microsoft Graph");
  }

  const url =
    "https://graph.microsoft.com/v1.0/tenantRelationships/findTenantInformationByTenantId(tenantId='" +
    tenantId +
    "')";

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.token}`,
      Accept: "application/json",
    },
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(
      `Graph call failed (${r.status}): ${body || r.statusText}`
    );
  }

  return r.json();
}

// ---------- Routes ----------

// Who am I
app.get("/api/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(req.user);
});

// Main lookup API
app.post("/api/lookup", requireUser, async (req, res) => {
  const subscriptionId = (req.body?.subscriptionId || "").trim();

  if (!subscriptionId) {
    return res.status(400).json({ error: "subscriptionId is required" });
  }

  // Simple GUID-ish validation – mainly to catch obvious typos
  const guidLike = /^[0-9a-fA-F-]{30,}$/;
  if (!guidLike.test(subscriptionId)) {
    return res
      .status(400)
      .json({ error: "subscriptionId does not look like a valid GUID" });
  }

  try {
    const tenantId = await getTenantIdFromSubscription(subscriptionId);
    const info = await getTenantInfoFromGraph(tenantId);

// Build a reliable defaultDomain value
const verified = info.verifiedDomains || [];
const defaultDomain =
  info.defaultDomainName ||
  (verified.find(d => d.isDefault) || verified.find(d => d.isInitial) || {}).name ||
  null;

res.json({
  tenantId,
  displayName: info.displayName || null,
  defaultDomain,           // <- frontend expects this name
  defaultDomainName: defaultDomain // (optional, keeps backwards compat)
});
  } catch (err) {
    console.error("Lookup failed:", err);
    res.status(502).json({
      error: err.message || "Failed to look up tenant information",
    });
  }
});

// ---------- Start ----------

app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
