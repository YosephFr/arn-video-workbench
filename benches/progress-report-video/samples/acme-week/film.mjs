// The film of the sample week: six sections, each anchored to the narration (anchor syntax in
// engine/lib/timeline.mjs: 'L03', 'L03:word', 'L03:word:end', 'L03:end', '+/- seconds'). Re-record a line and
// every cue follows it. Section types and their options are documented at the top of each engine/scenes file.
export default () => ({
  transition: 'sweep',          // between content sections; the opening opens through the mark, the close shrinks into it
  captions: { maxWords: 7 },
  sections: [
    { type: 'opening', title: 'Weekly update', subtitle: '26 October – 2 November 2026' },

    { type: 'metric', from: 'L02',
      label: 'Weekly active workspaces',
      value: 1234, format: { sep: ',' }, countAt: 'L02:reached', landAt: 'L02:thirty:end',
      delta: { text: '+12% vs. last week', tone: 'positive', at: 'L02:twelve' },
      series: [880, 905, 948, 1002, 1040, 1101, 1234], seriesLabels: ['Seven weeks ago', 'This week'],
      source: 'Sample figure · read-only production replica, 2 November' },

    { type: 'beforeAfter', from: 'L03',
      title: 'Reports, before and after',
      before: 'before-reports', after: 'after-reports', revealAt: 'L03:here',
      focus: [
        { at: 'L04:totals', el: [{ text: 'Total active members', box: true }, { text: 'Total reports viewed', box: true }], kind: 'ring', label: 'Totals on top', zoom: 1 },
        { at: 'L04:exports', el: 'Export', kind: 'spot', label: 'One-step export' },
      ] },

    { type: 'feature', from: 'L05', transition: 'tile',
      title: 'Scheduled reports', icon: 'calendar-clock', tagline: 'Reports that arrive on their own', heroAt: 'L05:scheduled',
      steps: [
        { icon: 'bookmark', title: 'A saved view', detail: 'Any report with its filters', at: 'L06:view' },
        { icon: 'calendar-clock', title: 'A day and a time', detail: 'Every Monday at 09:00, for example', at: 'L06:day' },
        { icon: 'mail', title: 'Delivered by email', detail: 'With the latest data', at: 'L06:arrives' },
      ],
      screen: { capture: 'after-schedule', at: 'L07', focus: [{ at: 'L07:live', el: 'Schedule report', kind: 'ring', label: 'Live for every workspace' }] } },

    { type: 'list', from: 'L08',
      title: 'Also live this week',
      items: [
        { text: 'Faster exports', icon: 'zap', at: 'L08:faster' },
        { text: 'Search with a keyboard shortcut', icon: 'keyboard', at: 'L08:search' },
        { text: 'Clearer change badges', icon: 'trending-up', at: 'L08:clearer' },
      ] },

    { type: 'close', from: 'L09', line: 'Platform updates, every Monday' },
  ],
})
