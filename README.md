# sub2tenant - Map Azure Subscription IDs to Microsoft Entra tenants

sub2tenant maps an Azure Subscription ID to its Microsoft Entra tenant. It also supports tenant lookups using a tenant ID or a verified domain name, using only the minimal Microsoft Graph permission required in the hosting tenant.

The public service is available at **https://sub2tenant.com**.

This repository contains the full source code so anyone can review how it works.

------------------------------------------------------------------------

## What the service does

sub2tenant is a lightweight tenant lookup utility for Azure and
Microsoft Entra. It supports lookups using:

-   **Azure Subscription ID** (GUID)
-   **Tenant ID** (GUID)
-   **Domain name** (verified Entra/M365 custom domain)

### Subscription → Tenant lookup

When supplied with a Subscription ID:

1.  The backend calls ARM:

        GET https://management.azure.com/subscriptions/{id}?api-version=2022-12-01

2.  ARM responds with `401 Unauthorized` and includes the tenant ID in
    the `WWW-Authenticate` header:

        Bearer authorization_uri="https://login.microsoftonline.com/{tenantId}", ...

3.  sub2tenant extracts the `tenantId` from that header.

4.  Microsoft Graph's `tenantRelationships` API is called to retrieve:

    -   `tenantId`
    -   `displayName`
    -   `defaultDomainName`

Only these fields are returned to the client.

------------------------------------------------------------------------

## Privacy and security

sub2tenant is intentionally minimal, transparent, and privacy-first:

- Subscription IDs, tenant IDs, and domains are **never logged or stored**
- Lookup inputs are processed **in memory only** and discarded immediately
- No IP addresses, cookies, tokens, or personal data are collected
- A small amount of **anonymous technical usage metadata** is logged to keep the
  service reliable, including:
  - an anonymous browser-local client identifier
  - browser type (User-Agent)
  - country (via Cloudflare’s privacy-friendly `CF-IPCountry` header)
  - page views and request paths
  - lookup type, lookup outcome, and basic request timing
- None of the lookup inputs themselves are ever logged
- The backend uses a **system-assigned Managed Identity** in the author’s Azure tenant
- Only this Managed Identity is granted the Microsoft Graph permission
  **`CrossTenantInformation.ReadBasic.All`** (required for basic tenant discovery)
- Users of the public site do **not** need any permissions, tokens, or authentication
- ARM calls are unauthenticated; Graph calls are made by the Managed Identity

------------------------------------------------------------------------

## High-level architecture

    User request → Node/Express backend → ARM unauthenticated call
               → Extract tenantId → Microsoft Graph call (MI)
               → Return displayName + defaultDomainName

-   **No database**
-   **No persistent logs of input**
-   Frontend is static HTML/CSS/JS

------------------------------------------------------------------------

## Running locally

Requirements:

-   Node.js 20+
-   (Optional) Azure CLI if you plan to deploy your own environment

### Local development

``` bash
git clone https://github.com/olhel/sub2tenant-aca.git
cd sub2tenant-aca

npm install
npm start
```

This starts the app on the port defined in `server.js` or the `PORT` environment variable.

### Deploying your own instance (optional)

To run a self-hosted version in Azure:

1.  Deploy to a service that supports **Managed Identity**, such as:

    -   Azure Container Apps
    -   Azure App Service
    -   Azure Kubernetes Service (with workload identity)

2.  Grant the Managed Identity the Graph permission:

        CrossTenantInformation.ReadBasic.All

3.  Deploy the container using the included `Dockerfile`.

------------------------------------------------------------------------

## Project structure

    sub2tenant-aca/
      server.js           # Express backend (lookup logic)
      public/             # Static frontend (index.html, CSS, JS)
        index.html
        style.css
        script.js
      Dockerfile          # Container image build
      package.json
      package-lock.json
      .github/workflows/  # CI pipeline for container build/publish

------------------------------------------------------------------------

## Limitations

-   Does **not** enumerate subscriptions
-   Does **not** require or use user credentials
-   Does **not** bypass Azure RBAC
-   Domain lookups work only for **verified** domains in Entra ID
-   Only exposes minimal tenant metadata (displayName + defaultDomainName)

------------------------------------------------------------------------

## License

MIT License. See the [`LICENSE`](./LICENSE) file.
