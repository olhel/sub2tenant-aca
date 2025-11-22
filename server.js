import express from "express";
import fetch from "node-fetch";
import { ManagedIdentityCredential, DefaultAzureCredential } from "@azure/identity";

const app = express();
const port = process.env.PORT || 8080;

// ---------- STATIC + JSON ----------

app.use(express.static("public"));
app.use(express.json());

// ---------- CREDENTIALS ----------

// In Azure Container Apps, managed identity is available.
// Locally, DefaultAzureCredential lets you use Az CLI / VS Code login.
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

// ---------- HELPERS ----------

async function getTenantIdFromSubscription(subscriptionId) {
  const url =
    "https://management.azure.com/subscriptions/" +
    encodeURIComponent(subscriptionId) +
    "?api-version=2020-01-01";

  // Call ARM without auth – we expect 401 with WWW-Authenticate containing tenant.
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

// ---------- ROUTES ----------

// Public health/info endpoint if you ever want it
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public lookup – NO auth required
app.post("/api/lookup", async (req, res) => {
  const subscriptionId = (req.body?.subscriptionId || "").trim();

  if (!subscriptionId) {
    return res.status(400).json({ error: "subscriptionId is required" });
  }

  const guidLike = /^[0-9a-fA-F-]{30,}$/;
  if (!guidLike.test(subscriptionId)) {
    return res
      .status(400)
      .json({ error: "subscriptionId does not look like a valid GUID" });
  }

  try {
    const tenantId = await getTenantIdFromSubscription(subscriptionId);
    const info = await getTenantInfoFromGraph(tenantId);

    const verified = info.verifiedDomains || [];
    const defaultDomain =
      info.defaultDomainName ||
      (verified.find((d) => d.isDefault) ||
        verified.find((d) => d.isInitial) ||
        {}).name ||
      null;

    res.json({
      tenantId,
      displayName: info.displayName || null,
      defaultDomain,
      defaultDomainName: defaultDomain, // legacy name, if you want it
    });
  } catch (err) {
    console.error("Lookup failed:", err);
    res.status(502).json({
      error: err.message || "Failed to look up tenant information",
    });
  }
});

// ---------- START ----------

app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
