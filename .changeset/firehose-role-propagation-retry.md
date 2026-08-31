---
'blogwright-analytics': patch
---

Retry `CreateDeliveryStream` while IAM propagates the Firehose delivery role, and stop a transient refusal from replacing the stream

The previous release fixed this for the transform Lambda. The graph has **two** role-to-consumer pairings, and the next `analytics bootstrap` failed on the other one node later:

```
× firehose: InvalidArgumentException - createDeliveryStream "<env>-<site>-analytics-firehose":
  Firehose is unable to assume role arn:aws:iam::…:role/<env>-<site>-analytics-firehose-role.
  Please check the role provided. (HTTP 400)
```

Same cause: IAM is eventually consistent and each role is created in the node immediately before the one that assumes it. Firehose words the failure nothing like Lambda does and puts nothing machine-readable in the code, so the predicate now carries both phrasings and is documented as the place to add a third if a future node consumes a role from another service.

`UpdateDestination` matters more than consistency here. Its refusal handler is deliberately un-narrowed, so *any* failed update falls back to deleting and recreating the stream. That meant a transient propagation 400 was indistinguishable from a genuine refusal, and answering it destroyed a healthy stream: a new ARN, the CloudFront log delivery pointed at the old one orphaned, and the records in flight lost. Retrying the timing failure keeps the destructive fallback for the case that warrants it.

Four tests, each watched failing first, including that a role-propagation refusal on update issues no `CreateDeliveryStream` at all.
