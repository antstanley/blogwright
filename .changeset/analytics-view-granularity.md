---
'blogwright-analytics': patch
---

Add 15-minute, 1-hour, 6-hour, 12-hour, and 24-hour granularity for Views over time using UTC event-time buckets, with an animated, keyboard-accessible radio pill, validated API options, and matching mock preview data. The selection animation respects reduced-motion preferences.

Extract the compact animated selector into a reusable PillRadio component, and use it for Bot traffic above the reporting date inputs.
