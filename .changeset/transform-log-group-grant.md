---
'blogwright-analytics': patch
---

Grant the transform role `logs:CreateLogGroup`, so the Lambda's logs exist at all

The transform role granted `logs:CreateLogStream` and `logs:PutLogEvents` but not `logs:CreateLogGroup`. Lambda creates its log group on first invocation and cannot without that grant, so on the first real deployment the function ran twice, reported zero errors, and produced no log group — a transform that worked and could not be observed.

That mattered while diagnosing something else. The pipeline was healthy (11 records in, 11 rows in `page_views`, nothing dropped or failed), but confirming it meant working entirely from CloudWatch metrics, because the one artifact that says *why* the transform did what it did did not exist.

The grant is scoped to the function's own log group, exactly like the two it joins — nothing account-wide.

Note that a Lambda-created log group retains forever. Owning the group as a node, with the retention the site's log groups carry, remains a sensible follow-up.
