# sub2tenant – Identify the Tenant Behind an Azure Subscription ID

sub2tenant maps an **Azure Subscription ID** to its **Azure AD / Entra ID tenant**.

The public site is available at **https://sub2tenant.com**.  
This repository contains the source code so anyone can see how the service works.

## What the Service Does

- Reads the tenant ID from Azure Resource Manager's `WWW-Authenticate` header  
  (no authentication required)
- Calls Microsoft Graph with a Managed Identity and retrieves:
  - `tenantId`
  - `displayName`
  - `defaultDomainName`
- Returns only these fields to the client
- Does not store or log any lookup data

## Privacy and Security

- Subscription IDs, tenant IDs and domains are not logged
- No data is written to disk
- No secrets are used since the backend relies on a Managed Identity
- Only the Graph permission **CrossTenantInformation.ReadBasic.All** is used
- No user authentication is required

## How It Works

1. The service sends:

       GET https://management.azure.com/subscriptions/{id}?api-version=2020-01-01

   ARM responds with a 401 and includes the tenant ID in the `WWW-Authenticate` header.

2. The backend extracts the tenant ID.

3. The backend calls:

       GET https://graph.microsoft.com/v1.0/tenantRelationships/findTenantInformationByTenantId(...)

   using a Managed Identity.

4. The response is trimmed to the minimal required fields and returned.

## Project Structure

```
sub2tenant/
  server.js
  public/
  Dockerfile
  package.json
  package-lock.json
  .gitignore
  .dockerignore
```

## License

MIT License. See the `LICENSE` file.
