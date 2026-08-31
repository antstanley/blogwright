---
"blogwright-core": minor
---

`AwsClients` gains `signingUsEast1`, the us-east-1 `SigningClient` `createClients` already built for ACM/CloudFront/Route 53, exposed so a plugin can construct clients for AWS services core does not enumerate against that region while sharing the host's credentials, endpoint override and injected transport. No service client moves: `logs`, `s3`, `microvms`, `secrets` and every other member still sign exactly where they did, `SIGNING_NAMES` is unchanged, and the bundle gains no new service key.
