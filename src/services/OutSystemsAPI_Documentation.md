# OutSystems App Generation, Publication, and Authentication Flow

This document explains:
- The end-to-end flow in src/services/outsystems-api.ts to generate, publish, and retrieve the URL of an OutSystems application.
- The authentication flow in src/services/token-manager.ts and src/utils/getOutsystemsToken.ts used to obtain and cache an OAuth2 access token for calling ODC REST APIs.

Note: All requests target your ODC environment host provided by the environment variable OS_HOSTNAME.

Environment prerequisites:
- OS_HOSTNAME: Base hostname of your ODC environment (for example: your-org.outsystems.dev).
- OS_USERNAME, OS_PASSWORD: Credentials for Cognito SRP authentication (used in the token acquisition flow).
- Optional: OS_DEV_ENVID (present in code but not used in the current flow).

Authentication:
- All API calls use an OAuth2 Bearer token provided by getValidOutSystemsToken(), which wraps getOutsystemsToken() and caches the token until near expiry.

---

## High-level App Flow (outsystems-api.ts)

1) Create a generation job (prompt-based).
2) Poll the job until status is ReadyToGenerate.
3) Trigger the OML generation.
4) Poll the job until status is Done and capture the generated application key.
5) Start a publication for the generated application.
6) Poll the publication until status is Finished.
7) Retrieve the final application details and construct the live URL.

Error handling:
- Any non-2xx response throws an Error with the HTTP status and body.
- Job statuses Failed or publication status Failed abort the flow.
- Missing required fields (e.g., job key, publication key, application key, final url) abort the flow.

Delays:
- Job status polling: 5s before generation; 10s during generation.
- Publication polling: 10s.

---

## API Endpoints and Steps

### Step 1 — Create Generation Job
- Function: startGenerationJob(token, prompt)
- HTTP: POST https://{OS_HOSTNAME}/api/app-generation/v1alpha3/jobs
- Body:
  {
    "prompt": "<your prompt>",
    "files": [],
    "ignoreTenantContext": true
  }
- Success response: JSON with key (job identifier). Throws if missing.

Backstage API docs (App Generation v1alpha3):
- Jobs_CreateJob
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_CreateJob

---

### Step 2 — Poll Job Until ReadyToGenerate
- Function: getJobStatus(token, jobId)
- HTTP: GET https://{OS_HOSTNAME}/api/app-generation/v1alpha3/jobs/{jobId}
- Poll interval: 5s
- Exit condition: status === "ReadyToGenerate"
- Abort condition: status === "Failed" (throws)

Backstage API docs (App Generation v1alpha3):
- Jobs_GetJob
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_GetJob

---

### Step 3 — Trigger OML Generation
- Function: triggerGeneration(token, jobId)
- HTTP: POST https://{OS_HOSTNAME}/api/app-generation/v1alpha3/jobs/{jobId}/generation
- No body
- Success: 2xx status; no JSON required.

Backstage API docs (App Generation v1alpha3):
- Jobs_TriggerJobGeneration
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_TriggerJobGeneration

---

### Step 4 — Poll Job Until Done and Capture Application Key
- Function: getJobStatus(token, jobId)
- HTTP: GET https://{OS_HOSTNAME}/api/app-generation/v1alpha3/jobs/{jobId}
- Poll interval: 10s
- Exit condition: status === "Done"
- Extract: applicationKey from response at appSpec.appKey
- Abort condition: status === "Failed" (throws)
- Validates that applicationKey exists (throws if missing).

Backstage API docs (App Generation v1alpha3):
- Jobs_GetJob
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_GetJob

---

### Step 5 — Start Publication
- Function: startPublication(token, applicationKey)
- HTTP: POST https://{OS_HOSTNAME}/api/v1/publications
- Body:
  {
    "applicationKey": "<from Step 4>",
    "applicationRevision": 1,
    "downloadUrl": null
  }
- Success response: JSON with key (publicationKey). Throws if missing.

Backstage API docs (Publish service v1):
- Publications_Post
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/publish.service.openapi.v1/definition#/Publications/Publications_Post

---

### Step 6 — Poll Publication Until Finished
- Function: getPublicationStatus(token, publicationKey)
- HTTP: GET https://{OS_HOSTNAME}/api/v1/publications/{publicationKey}
- Poll interval: 10s
- Exit condition: status === "Finished"
- Abort condition: status === "Failed" (throws)

Backstage API docs (Publish service v1):
- Publications_Get
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/publish.service.openapi.v1/definition#/Publications/Publications_Get

---

### Step 7 — Retrieve Application Details and Build Final URL
- Function: getApplicationDetails(token, applicationKey)
- HTTP: GET https://{OS_HOSTNAME}/api/v1/applications/{applicationKey}
- Success response: JSON containing urlPath (validated, throws if missing).

Final URL assembly:
- Input host: OS_HOSTNAME (e.g., your-org.outsystems.dev)
- Live host mapping: replace ".outsystems.dev" with "-dev.outsystems.app"
- Final URL: https://{mappedHost}/{urlPath}

Backstage API docs (Application Versioning v1):
- Applications_GetApplication
  backstage.arch.outsystemscloudrd.net/catalog/odc/api/applicationversioning.service.openapi.v1/definition#/private/Applications_GetApplication

Example:
- OS_HOSTNAME = acme.outsystems.dev
- appDetails.urlPath = my-app
- final URL => https://acme-dev.outsystems.app/my-app

---

## Authentication Flow (token-manager.ts + getOutsystemsToken.ts)

This section documents how the code obtains and caches an OAuth2 access token for ODC APIs. According to ODC documentation, ODC REST APIs use OAuth 2.0 access tokens for authentication, and calls must include Authorization: Bearer <token>.[4][5]

### Overview

- getValidOutSystemsToken(): Returns a valid access token, caching it in-memory with an early-refresh buffer.
- getOutsystemsToken(): Executes a multi-step flow combining OIDC discovery, PKCE, Cognito SRP authentication, and code exchanges to obtain the ODC access token.

Key environment variables:
- OS_HOSTNAME: ODC tenant host, used for OIDC discovery and redirects.
- OS_USERNAME, OS_PASSWORD: Used for Cognito SRP login.

Local dependencies and roles:
- amazon-cognito-identity-js: Performs SRP login against Cognito.
- axios + axios-cookiejar-support + tough-cookie: Manages HTTP requests and cookie-based session state across redirects.
- pkce-challenge: Generates PKCE verifier and challenge used in the OAuth authorization_code flow with PKCE.

---

### Token Caching and Early Refresh (token-manager.ts)

- In-memory cache structure:
  - token: string
  - expiresAt: epoch seconds of token expiry
- Early refresh buffer:
  - TOKEN_EXPIRY_BUFFER_SECONDS = 300 (5 minutes). If now + 300 < expiresAt, the cached token is reused; otherwise, a fresh token is fetched.
- Expiry handling:
  - Current logic assumes a 3600-second token lifetime and sets expiresAt = now + 3600 after fetching.

Operational notes:
- Logging indicates when the cached token is reused vs. when a new token is fetched.
- Consider reading and using the real expires_in value if available from the token endpoint to avoid assuming 1 hour.

---

### Access Token Acquisition Flow (getOutsystemsToken.ts)

The function returns an access_token suitable for ODC REST API calls. Steps:

1) Discover OIDC endpoints
- GET https://{OS_HOSTNAME}/identity/.well-known/openid-configuration
- Extract authorization_endpoint and token_endpoint.

2) Generate PKCE parameters
- Use pkce-challenge to create code_verifier and code_challenge.
- Set redirect_uri = https://{OS_HOSTNAME}/authentication/redirect.
- Client ID used: unified_experience (public client for this flow).

3) Initiate authorization request
- Build authorization request to authorization_endpoint with:
  - response_type=code
  - client_id=unified_experience
  - redirect_uri={redirect_uri}
  - kc_idp_hint=cognito
  - scope=openid email profile
  - code_challenge={code_challenge}
  - code_challenge_method=S256
- Follow the initial redirect to extract:
  - state
  - kcUri (Keycloak endpoint used later for code exchange)
  - client_id (clientPoolId) returned by the page.

4) Perform Cognito SRP login
- Fetch tenant Cognito configuration:
  - GET https://{OS_HOSTNAME}/authentication/rest/api/v1/tenant-config
  - Extract poolId and amplifyClientId.
- Use amazon-cognito-identity-js to authenticate via SRP with OS_USERNAME and OS_PASSWORD.
- On success, obtain Cognito IdToken, AccessToken, RefreshToken.

5) Exchange Cognito tokens for an intermediate OutSystems auth code
- POST https://{OS_HOSTNAME}/identityapi/v1alpha1/oidc/store-token
- Body: { ClientId: clientPoolId, IdToken, AccessToken, RefreshToken }
- Response returns authCode (codeFromIdentity).

6) Exchange the intermediate code for a final authorization code
- GET {kcUri}?code={codeFromIdentity}&state={state}
- Handle redirect; parse the Location to retrieve final authorization code (finalCode) returned to the redirect_uri.

7) Exchange authorization code for access token
- POST token_endpoint with application/x-www-form-urlencoded:
  - grant_type=authorization_code
  - code={finalCode}
  - code_verifier={code_verifier}
  - redirect_uri={redirect_uri}
  - client_id=unified_experience
- Response returns access_token used for subsequent API calls.

Session handling:
- axios-cookiejar-support + tough-cookie are used so that redirects and session cookies are preserved across requests.

Error handling:
- On any failure, logs diagnostic info (including error.response.data when available) and throws a generic "OutSystems authentication failed." error.

Security considerations:
- Do not log access tokens or secrets.
- Prefer reading expires_in from the token response and propagate it to token-manager.ts to improve refresh accuracy.

References:
- ODC API authentication and authorization overview[4].
- Calling ODC APIs using an access token[5].

---

## Orchestration Generator Behavior

The exported generator createAndDeployApp(prompt) yields progress messages after each step and while polling:
- Fetch token
- Create job
- Poll job to ReadyToGenerate
- Trigger OML generation
- Poll job to Done, capture applicationKey
- Start publication
- Poll publication to Finished
- Fetch application details and yield final URL

Error strategy:
- Emits a final error message via yield and throws an Error, enabling both user-facing feedback and upstream error handling.

---

## Implementation Notes and Recommendations

- Timeouts and retries:
  - Add overall timeouts or maximum retries for each polling loop.
  - Consider exponential backoff for polling.
  - Wrap fetch calls with retry logic for transient network/5xx errors.

- Token expiry:
  - Use the token endpoint’s expires_in to set cachedToken.expiresAt precisely.
  - Consider persisting tokens securely if running across multiple processes.

- Host mapping for final URL:
  - The mapping ".outsystems.dev" -> "-dev.outsystems.app" is applied in code. Adjust if your organization uses a different convention.

- Least privilege:
  - Ensure the authenticated identity has the necessary scopes/permissions for App Generation and Publish APIs.

---

## Backstage API Documentation Links (from inline comments)

- App Generation v1alpha3 (Jobs)
  - Create Job: backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_CreateJob
  - Get Job: backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_GetJob
  - Trigger Generation: backstage.arch.outsystemscloudrd.net/catalog/odc/api/appgeneration.service.openapi.v1alpha3/definition#/Jobs/Jobs_TriggerJobGeneration

- Publish service v1 (Publications)
  - Create Publication: backstage.arch.outsystemscloudrd.net/catalog/odc/api/publish.service.openapi.v1/definition#/Publications/Publications_Post
  - Get Publication: backstage.arch.outsystemscloudrd.net/catalog/odc/api/publish.service.openapi.v1/definition#/Publications/Publications_Get

- Application Versioning v1
  - Get Application: backstage.arch.outsystemscloudrd.net/catalog/odc/api/applicationversioning.service.openapi.v1/definition#/private/Applications_GetApplication

- ODC Auth docs
  - API authentication and authorization (overview)[4]
  - Call API using the access token[5]