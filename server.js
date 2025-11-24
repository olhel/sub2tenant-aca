import express from "express";
import fetch from "node-fetch";
import { DefaultAzureCredential } from "@azure/identity";

const app = express();
const port = process.env.PORT || 8080;

// ---------- STATIC + JSON ----------

app.use(express.static("public"));
app.use(express.json());

// ---------- AZURE CREDENTIAL ----------

const credential = new DefaultAzureCredential();

// ---------- HELPERS ----------

// 1) Get tenantId from ARM using the WWW-Authenticate header
async function getTenantIdFromSubscription(subscriptionId) {
  const url =
    "https://management.azure.com/subscriptions/" +
    subscriptionId +
    "?api-version=2022-12-01";

  const res = await fetch(url);

  // We expect 401 with a WWW-Authenticate header that contains authorization_uri
  if (res.status === 401) {
    const header = res.headers.get("www-authenticate") || "";
    const match =
      header.match(
        /authorization_uri="https:\/\/login\.windows\.net\/([^"]+)"/i
      ) ||
      header.match(
        /authorization_uri="https:\/\/login\.microsoftonline\.com\/([^"]+)"/i
      );

    if (!match) {
      throw new Error(
        "Could not parse tenantId from ARM WWW-Authenticate header"
      );
    }

    return match[1]; // tenantId GUID
  }

  const body = await res.text();
  throw new Error(
    `Unexpected ARM response (${res.status}): ${body || res.statusText}`
  );
}

// 2) Graph: find tenant by tenantId
async function getTenantInfoFromGraphByTenantId(tenantId) {
  const scope = "https://graph.microsoft.com/.default";
  const token = await credential.getToken(scope);

  if (!token || !token.token) {
    throw new Error("Failed to obtain access token for Microsoft Graph");
  }

  const url =
    "https://graph.microsoft.com/v1.0/tenantRelationships/findTenantInformationByTenantId(tenantId='" +
    tenantId +
    "')";

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.token}`,
      Accept: "application/json",
    },
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(
      `Graph tenantId lookup failed (${res.status}): ${bodyText || res.statusText}`
    );
  }

  return JSON.parse(bodyText);
}

// 3) Graph: find tenant by domainName
async function getTenantInfoFromGraphByDomain(domainName) {
  const scope = "https://graph.microsoft.com/.default";
  const token = await credential.getToken(scope);

  if (!token || !token.token) {
    throw new Error("Failed to obtain access token for Microsoft Graph");
  }

  const url =
    "https://graph.microsoft.com/v1.0/tenantRelationships/findTenantInformationByDomainName(domainName='" +
    domainName +
    "')";

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.token}`,
      Accept: "application/json",
    },
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(
      `Graph domain lookup failed (${res.status}): ${bodyText || res.statusText}`
    );
  }

  return JSON.parse(bodyText);
}

// 4) Normalize/validate domain input (strip URL, email, etc.)
function normalizeDomainInput(input) {
  let v = (input || "").trim().toLowerCase();
  if (!v) return null;

  // email → domain
  const atIndex = v.indexOf("@");
  if (atIndex !== -1) {
    v = v.slice(atIndex + 1);
  }

  // strip protocol
  v = v.replace(/^[a-z]+:\/\//i, "");

  // strip path / query / fragment
  v = v.split(/[\/?#]/)[0];

  // strip port
  const colonIndex = v.indexOf(":");
  if (colonIndex !== -1) {
    v = v.slice(0, colonIndex);
  }

  // strip leading "www." – common case like www.bsure.io   // NEW
  if (v.startsWith("www.")) {                               // NEW
    v = v.slice(4);                                         // NEW
  }

  v = v.replace(/'/g, "").trim();

  const domainPattern = /^[a-z0-9.-]+\.[a-z]{2,}$/;
  if (!domainPattern.test(v)) return null;

  return v;
}

// 5) Helper to get defaultDomain from Graph result
function getDefaultDomainFromInfo(info) {
  const verified = info.verifiedDomains || [];
  return (
    info.defaultDomainName ||
    (verified.find((d) => d.isDefault) ||
      verified.find((d) => d.isInitial) ||
      {}).name ||
    null
  );
}

// ---------- ROUTES ----------

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Single lookup endpoint for:
//  - Subscription ID (GUID) → tenantId
//  - Tenant ID (GUID) → tenantId
//  - Domain → tenantId
app.post("/api/lookup", async (req, res) => {
  const rawInput = (req.body?.subscriptionId || "").trim();

  if (!rawInput) {
    return res
      .status(400)
      .json({ error: "An ID or domain is required." });
  }

  const guid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  // --------------------------
  // CASE 1: GUID → try subscription first, then tenantId
  // --------------------------
  if (guid.test(rawInput)) {
    // 1a) Try as Subscription ID
    try {
      const tenantIdFromSub = await getTenantIdFromSubscription(rawInput);
      const info = await getTenantInfoFromGraphByTenantId(tenantIdFromSub);
      const defaultDomain = getDefaultDomainFromInfo(info);

      return res.json({
        mode: "subscriptionId",
        subscriptionId: rawInput,
        tenantId: tenantIdFromSub,
        displayName: info.displayName || null,
        defaultDomain,
      });
    } catch (subErr) {
      console.log("Subscription lookup failed, falling back to tenantId resolution.");
    }

    // 1b) Try as Tenant ID
    try {
      const info = await getTenantInfoFromGraphByTenantId(rawInput);
      const defaultDomain = getDefaultDomainFromInfo(info);

      return res.json({
        mode: "tenantId",
        tenantId: rawInput,
        displayName: info.displayName || null,
        defaultDomain,
      });
    } catch (tenantErr) {
      console.error("TenantId resolution failed.");
    }
  }

  // --------------------------
  // CASE 2: Domain name
  // --------------------------
  const domain = normalizeDomainInput(rawInput);
  if (!domain) {
    return res.status(400).json({
      error:
        "That doesn’t look like a subscription ID, tenant ID, or domain. Please check the format and try again.",
    });
  }

  try {
    const info = await getTenantInfoFromGraphByDomain(domain);
    const defaultDomain = getDefaultDomainFromInfo(info);

    return res.json({
      mode: "domain",
      domain,
      tenantId: info.tenantId,
      displayName: info.displayName || null,
      defaultDomain,
    });
  } catch (_err) {
    console.error("Domain resolution failed.");
    return res.status(400).json({
      error:
        "Unable to resolve this domain to a Microsoft Entra tenant. Make sure it’s a verified custom domain.",
    });
  }
});

// ---------- START ----------

app.listen(port, () => {
  console.log("Service started.");
});
