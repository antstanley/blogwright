---
"blogwright-core": patch
"blogwright": patch
---

Retry AWS requests that are throttled, for every resource and every method.
`SigningClient` previously retried a `POST` only on a network error, so a
create refused with `Throttling - Rate exceeded` - CloudFront's answer when
several bootstraps run against one account - failed the command at once, and
idempotent requests gave up after about three seconds. A throttle is refused
before AWS acts on it, so it is now retried for any method, including creates,
with its own budget: eight attempts with jittered exponential backoff from 1
second up to 20 seconds, about 36-71 seconds in all. Throttling is recognised
across services (`Throttling`, `ThrottlingException`, `TooManyRequestsException`,
S3's `SlowDown`, Route 53's `PriorRequestNotComplete`, any HTTP 429, and the
rest of the family); quota errors such as `LimitExceededException` are not
retried. A `POST` that fails with a 5xx is still never retried, and the backoff
for other transient failures is unchanged.
