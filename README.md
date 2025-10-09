# Azure Container Apps — Tenant Lookup (Managed Identity)

This container serves a static UI and an API that:
- reads the tenantId from ARM's `WWW-Authenticate` header for a subscription,
- calls Microsoft Graph `findTenantInformationByTenantId` using **Managed Identity**,
- returns: tenantId, displayName, defaultDomainName.

## Build & push (GHCR public image)
```bash
GH_USER=<your_github_username>
IMAGE=ghcr.io/$GH_USER/tenant-lookup-aca:latest

# login once with a GitHub PAT that has write:packages
echo <YOUR_GITHUB_PAT> | docker login ghcr.io -u $GH_USER --password-stdin

docker build -t $IMAGE .
docker push $IMAGE
# then set the image public in the package settings on GitHub
```

## Deploy to Azure Container Apps
```bash
SUBSCRIPTION_ID=<your-sub-guid>
RG=rg-tenant-lookup
LOC=westeurope
ENV_NAME=cae-tenant-lookup
APP_NAME=aca-tenant-lookup
IMAGE=ghcr.io/<your-username>/tenant-lookup-aca:latest

az account set --subscription "$SUBSCRIPTION_ID"
az group create -n "$RG" -l "$LOC"
az extension add --name containerapp --upgrade
az containerapp env create -g "$RG" -n "$ENV_NAME" -l "$LOC"

az containerapp create -g "$RG" -n "$APP_NAME"   --environment "$ENV_NAME"   --image "$IMAGE"   --ingress external --target-port 8080   --min-replicas 1 --max-replicas 1   --system-assigned

MI_PRINCIPAL_ID=$(az containerapp show -g "$RG" -n "$APP_NAME" --query "identity.principalId" -o tsv)
GRAPH_APP_ID=00000003-0000-0000-c000-000000000000
GRAPH_SP_ID=$(az ad sp list --filter "appId eq '$GRAPH_APP_ID'" --query "[0].id" -o tsv)
ROLE_ID=$(az ad sp show --id "$GRAPH_SP_ID"   --query "appRoles[?value=='CrossTenantInformation.ReadBasic.All' && contains(allowedMemberTypes, 'Application')].id | [0]" -o tsv)

az rest --method POST   --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI_PRINCIPAL_ID/appRoleAssignments"   --body "{"principalId":"$MI_PRINCIPAL_ID","resourceId":"$GRAPH_SP_ID","appRoleId":"$ROLE_ID"}"

APP_URL=$(az containerapp show -g "$RG" -n "$APP_NAME" --query "properties.configuration.ingress.fqdn" -o tsv)
echo "Open: https://$APP_URL"
```

No config edits are required in the files.
