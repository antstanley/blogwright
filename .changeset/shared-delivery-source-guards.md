---
"blogwright-core": minor
"blogwright": minor
---

Guard the shared CloudFront delivery source against cascading deletes.

AWS permits one delivery source per distribution, so the analytics plugin's delivery necessarily hangs off the site's. `LogsClient.deliveriesForSource` now returns each delivery's `deliveryDestinationArn` alongside its id, and on that the site's log-delivery node tells its own delivery from anyone else's: `delete()` and the `ConflictException` self-heal both refuse, before deleting anything, when the source carries a delivery this site did not create, and the retry now removes only the site's own delivery instead of every delivery on the source.

`blogwright destroy` can now fail where it previously threw a Conflict part-way through teardown, after the distribution was already gone. That is the point: it fails early, with nothing removed, and names the environment-scoped remedy (`blogwright analytics destroy <env> --yes`). `blogwright bootstrap`'s self-heal previously deleted the site's own delivery and then failed on the shared source, leaving a stack with no CloudWatch delivery; it now refuses up front instead.
