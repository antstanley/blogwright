---
"blogwright-analytics": minor
---

`blogwright analytics bootstrap` and `blogwright analytics destroy --yes` now answer. The plugin contributes the twelve resource nodes the pipeline is built from - the S3 Tables bucket, its namespace and the `page_views` table, the Glue `s3tablescatalog` federation, the `visitor_key` salt secret, the transform Lambda and its execution role, the Firehose error bucket, delivery role and delivery stream, and the CloudWatch delivery destination and delivery - and the CLI's own graph engine reconciles them. Until now the plugin declared no `nodes`, so both verbs were unanswered and unadvertised in `blogwright --help`.

Two things an operator should know. Every node's title states the `us-east-1` pin, so `analytics bootstrap` says out loud that these resources diverge from `config.region` rather than deriving it silently; the two IAM roles state it as the pipeline they serve, because IAM is global. And the plugin's resources are recorded in their own state object, `state/<env>.analytics.json`: `blogwright bootstrap` provisions none of them and `blogwright destroy --yes` removes none of them - it refuses while that object exists and tells you to run `blogwright analytics destroy <env> --yes` first.
