---
'blogwright': minor
'blogwright-core': minor
'blogwright-pds': minor
---

The CLI no longer installs the standard.site plugin, which takes about 16 MB of AT Protocol dependencies off every `blogwright` install. **A site that publishes to standard.site must now run `blogwright plugin add pds` once** and commit the `package.json` and lockfile change. Until then `blogwright pds <action>` reports that no plugin claims `pds`, and production deploys skip the record sync. Plugins can now declare an `afterDeploy` hook, which `blogwright deploy` runs for each installed plugin once the site is live. A failing hook warns and never fails the deploy. The pds plugin's post-deploy sync now runs through this hook. `blogwright/rkey` keeps working without the plugin: its implementation moved to `blogwright-core/rkey`, and `blogwright-pds/rkey` re-exports it.
