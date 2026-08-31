---
"blogwright": minor
"blogwright-core": minor
"blogwright-pds": minor
---

`SendOptions.service` and `resolveEndpoint` now also accept a plugin-supplied service descriptor (`{ service, signingName, global? }`) alongside core's own `ServiceKey`, so a plugin can sign SigV4 requests against an AWS service core does not enumerate without an edit to core. `SIGNING_NAMES` is unchanged - core's own clients keep signing exactly as before, byte-identical requests included.
