'use strict';

// Shared constants — loaded before content.js and popup.js
// content_scripts: ["shared.js", "content.js"] in manifest.json
// popup.html: <script src="shared.js"></script> before popup.js

const STATUS_COLOR = {
  major_outage: 'red',
  partial_outage: 'orange',
  degraded_performance: 'orange',
  under_maintenance: 'gray',
  operational: 'green',
};

const STATUS_PRIORITY = {
  major_outage: 4,
  partial_outage: 3,
  degraded_performance: 2,
  under_maintenance: 1,
  operational: 0,
};

function getOverallColor(components) {
  let maxPriority = -1;
  let worstStatus = 'operational';
  for (const c of components) {
    if (c.group) continue;
    const p = STATUS_PRIORITY[c.status] ?? 0;
    if (p > maxPriority) { maxPriority = p; worstStatus = c.status; }
  }
  return STATUS_COLOR[worstStatus] ?? 'gray';
}
