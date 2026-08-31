---
"blogwright-analytics": minor
"blogwright-core": minor
---

The analytics plugin owns the two CloudWatch log groups its pipeline writes to. `analytics-transform-log-group` is `/aws/lambda/<prefix>-analytics-transform`, the group the transform Lambda never had - no node created it and its execution role could not - and `analytics-firehose-log-group` is `/aws/kinesisfirehose/<prefix>-analytics-firehose` with the `DestinationDelivery` stream Firehose writes its delivery errors to. Both are pinned to `us-east-1` with the rest of the pipeline, created with the environment's tags, and retained for 365 days, re-applied on every apply. Twelve nodes become fourteen.

On an environment provisioned before this change, the next `blogwright analytics bootstrap` does five things, and needs no teardown to do any of them: it creates the two log groups, applies the 365-day retention to each, creates the `DestinationDelivery` log stream, adds a fifth statement to the Firehose delivery role granting `logs:PutLogEvents` on that one stream's ARN, and issues one `UpdateDestination` against the live delivery stream to turn error logging on. The two groups appear as two new nodes in the bootstrap output and in `blogwright analytics status`; the role and stream updates are reported against the nodes that already existed. `UpdateDestination` keeps the stream's ARN, so the CloudFront log delivery pointed at it is untouched and no access log is lost.

The stream node's update guard was widened to make that last step reachable at all. It reconciled on the `AppendOnly` flag alone, which every stream this plugin created already matches, so it would otherwise have returned without a single AWS call and left every deployed stream unlogged. It now returns early only when `AppendOnly` matches **and** logging is already enabled on the live destination, read back off the stream rather than assumed.

`blogwright-core` gains `LogsClient.ensureLogStream(logGroupName, logStreamName)`, which swallows an already-exists response exactly as `ensureLogGroup` does. It is the second core operation this pipeline needs; the plugin has no CloudWatch Logs client of its own and gains none.
