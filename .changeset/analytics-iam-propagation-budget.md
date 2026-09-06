---
'blogwright-analytics': patch
---

Allow about a minute for newly created IAM roles to propagate when bootstrapping or updating analytics Lambda functions and Firehose streams. Previously the role-assumption retries waited only three seconds in total, so fresh production environments could still fail with "Firehose is unable to assume role". Unrelated errors continue to fail immediately.
