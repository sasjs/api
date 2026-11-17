# App detail authorization parity

`GET /SASjsApi/app/{id}` authenticates identity-enabled hosts before looking up an app. An absent or inactive caller receives 401; a caller without access receives the same 404 as an unknown id. Administrators can read any registered app. For other callers, only Route permissions participate: the rules naming the id take precedence over rules naming the legacy app name; otherwise the name is used, and `/AppStream` is the parent rule. This mirrors `appDecidingPath` and `appIsGranted` in sasjs/server. Public stream grants do not authenticate this detail route.

One server edge case is not mirrored: an exact public grant on `/SASjsApi/app/<id>` can let an anonymous request through server authentication with the non-ObjectId `public_user_id` sentinel, which `mayOpen` then queries as a user id and may cause a Mongoose CastError. This is a source-level finding, not a verified server response; the dispatcher instead returns 401.

Hosts without identity or records and without a supplied subject/token retain desktop access. Identity-enabled hosts without records fail closed with 501. The existing `RecordService` interface is unchanged; the decision uses `mayAct`, `mayAdminister`, and caller-filtered `listPermissions`. Implementations of that interface must keep `listPermissions` scoped to the caller's own user/group rules. This path does not rely on a host supplying app ids in the route inventory.

The corpus covers anonymous and denied callers. `spec/dispatch.spec.ts` also exercises inactive users, desktop compatibility, missing records, grants and id/name precedence.

Run `npm run build && npm run bench:gates` to measure the built package. The benchmark's in-memory backend uses 2 user reads for an admin, and 3 user reads plus 1 permission read for denied and granted callers. Identity backends may make these reads more expensive.
