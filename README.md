# sub2tenant --- Identify the Tenant Behind Any Azure Subscription ID

**sub2tenant** is a small, transparent, privacy‑focused tool that maps
an **Azure Subscription ID → its Azure AD / Entra ID tenant**.

This repository exists so that anyone can inspect the code and
understand exactly what the service does --- and what it *does not* do.

------------------------------------------------------------------------

## ⭐ What the Service Does

-   Extracts the **tenant ID** from Azure Resource Manager's
    `WWW-Authenticate` header\
    (no authentication required).
-   Uses a **Managed Identity** to call Microsoft Graph\
    (`findTenantInformationByTenantId`) and retrieve:
    -   `tenantId`
    -   `displayName`
    -   `defaultDomainName`
-   Returns only those fields to the client.
-   Performs no caching, no analytics, and no storage.

------------------------------------------------------------------------

## 🔐 Privacy & Security

-   The service **does not log** subscription IDs, tenant IDs, or domain
    names.
-   No data is persisted or written to disk.
-   No secrets exist in the codebase --- the backend uses a **Managed
    Identity**.
-   The Graph permission used is
    **CrossTenantInformation.ReadBasic.All**, which exposes only basic
    public tenant metadata.
-   No end‑user authentication or tokens are ever requested.

This repo is intentionally simple so anyone can verify the behavior.

------------------------------------------------------------------------

## 📌 High‑Level Technical Overview

1.  The service sends:

        GET https://management.azure.com/subscriptions/{id}?api-version=2020-01-01

    ARM replies with **401** and includes the tenant ID in the
    `WWW-Authenticate` header.

2.  The backend extracts that tenant ID.

3.  It then calls:

        GET https://graph.microsoft.com/v1.0/tenantRelationships/findTenantInformationByTenantId(...)

    using a Managed Identity.

4.  The response is reduced to the minimal set of fields needed and
    returned to the user.

------------------------------------------------------------------------

## 🧱 Project Structure

    sub2tenant/
      server.js            # Backend logic
      public/              # Static HTML/CSS UI
      Dockerfile
      package.json
      package-lock.json
      .gitignore
      .dockerignore

------------------------------------------------------------------------

## 📝 License

This project is licensed under the **MIT License**.\
See the `LICENSE` file for details.
