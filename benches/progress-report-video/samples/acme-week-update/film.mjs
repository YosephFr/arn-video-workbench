// The "update" variant: opening sting, the status flip that closes last week's pending item, the real screen,
// and the brand close. It reuses the weekly sample's captures (same screens, same data).
export default () => ({
  captures: '../acme-week/captures',
  transition: 'sweep',
  sections: [
    { type: 'opening', title: 'Update', subtitle: 'Thursday 5 November 2026', lock: 0.85 },

    { type: 'status', from: 'U02',
      title: 'Spreadsheet export', icon: 'file-spreadsheet', detail: 'For every workspace',
      was: 'In review', now: 'Live', flipAt: 'U02:live', note: 'Since Monday’s update' },

    { type: 'screen', from: 'U03', title: 'Reports', capture: 'after-reports',
      focus: [{ at: 'U03:export', el: 'Export', kind: 'magnify', label: 'Spreadsheet export' }] },

    { type: 'close', from: 'U04', line: 'Platform updates, every Monday' },
  ],
})
