---
'blogwright-pds': patch
'blogwright-analytics': patch
---

The pds and analytics plugins now declare `blogwright-core` as a peer dependency (`^` the release they were built with) instead of installing their own copy, so a site's plugins always share the core the CLI installed. A plugin left on an older release after upgrading the CLI now gets a peer-dependency warning from the package manager instead of silently running against a second core.
