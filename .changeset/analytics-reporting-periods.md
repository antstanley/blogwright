---
'blogwright-analytics': patch
---

Add UTC minute-precision reporting windows and rolling presets from three hours to one year, anchored to the current minute on each selection. Apply exact start-inclusive/end-exclusive event-time filtering to every query while preserving the existing inclusive date-only API. Calendar month/year presets clamp month ends and leap days. Update mock time series to cover the selected window.
