# Security basics

## OIDC (bearer tokens / Keycloak)

Add `quarkus-oidc`. In dev/test, Dev Services starts a Keycloak container when `quarkus.oidc.auth-server-url` is not set.

```properties
%prod.quarkus.oidc.auth-server-url=${OIDC_URL}
quarkus.oidc.client-id=${OIDC_CLIENT_ID}
quarkus.oidc.application-type=service
```

For web apps with browser login use `quarkus.oidc.application-type=web-app`. For plain JWT verification without an identity provider flow, use `quarkus-smallrye-jwt`.

## Authorization

```java
@Path("/admin")
@RolesAllowed("admin")
public class AdminResource { ... }
```

Or path rules:

```properties
quarkus.http.auth.permission.secured.paths=/api/*
quarkus.http.auth.permission.secured.policy=authenticated
```

## Hardening checklist

- Secure by default; explicitly `@PermitAll` public endpoints.
- Enable HTTPS in production (usually TLS terminated at the ingress); set `quarkus.http.cors.*` narrowly.
- Keep secrets out of `application.properties`.
- Expose `/q/health` and metrics only internally; restrict Dev UI (`/q/dev-ui` is dev mode only).
- In tests, use `@TestSecurity(user = "alice", roles = "admin")` (`quarkus-test-security`).
