---
"blogwright": minor
---

After successful site bootstrap, warn once per plugin scope whose state key exists for that environment, with `blogwright <scope> bootstrap <env>` as the remedy. This works for uninstalled plugins without discovery, config inspection, object reads, or prompts. A never-bootstrapped plugin has no scoped key and produces no per-plugin warning; run its bootstrap explicitly as instructed by the migration notice.

A failed state listing emits a contextual diagnostic while bootstrap remains successful. Failed reconciliation performs no added listing. Destroy continues to refuse scoped state and fails closed on listing errors except `NoSuchBucket`.

Release together with task 59's `cli-site-graph-drops-pds.md`, never later: that site's deploy-role policy removal needs this reminder for existing plugin state. Pending specs and final public documentation remain for task 63.
