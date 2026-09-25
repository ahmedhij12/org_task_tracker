// Turns the raw admin_activity rows into what the super admin reads:
// "Fatima · deleted Karam · 37.238.x.x · iPhone · 9:14 AM".
//
// One admin action can write many rows in one transaction (submitting a
// 73-question audit writes the completion plus every answer), so change rows
// are grouped by transaction and described by their most telling row.
//
// No "@/..." imports: scripts/test/describeActivity.test.mjs loads this file
// straight into Node. Wording is returned as an i18n key + params; the screen
// translates it.

export interface ActivityRow {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  kind: 'change' | 'sign_in' | 'view' | 'export' | 'password';
  table_name: string | null;
  op: string | null;
  row_id: string | null;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  detail: Record<string, any> | null;
  ip: string | null;
  user_agent: string | null;
  txid: number;
  created_at: string;
}

export interface Summary {
  key: string;
  params: Record<string, string | number>;
}

export interface ActivityGroup {
  key: string;
  actorId: string | null;
  actorName: string;
  at: string;
  ip: string | null;
  device: string | null;
  rows: ActivityRow[];
  summary: Summary;
  /** How many more rows the same action wrote, beyond the one described. */
  more: number;
  /** One of the actions the super admin gets a phone alert for. */
  serious: boolean;
}

/** The screens, by route, as the i18n key of their name. */
const SCREENS: Record<string, string> = {
  '/': 'mainTabs.dashboard',
  '/teams': 'mainTabs.teams',
  '/report': 'mainTabs.report',
  '/checklists': 'mainTabs.checklists',
  '/history': 'mainTabs.history',
  '/people': 'mainTabs.people',
  '/settings': 'mainTabs.settings',
  '/control-panel': 'control.title',
};

// Which row speaks for a multi-row action: the first table in this list wins.
const PRIORITY = [
  'profiles', 'teams', 'organizations', 'task_completions', 'checklist_templates', 'tasks',
  'oil_fryers', 'oil_tests', 'chicken_marinations', 'points_adjustments', 'period_adjustments',
  'report_periods', 'brands', 'branch_brands', 'profile_teams', 'oil_slots', 'checklist_template_items',
];

export function deviceOf(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Computer';
}

const changed = (row: ActivityRow, field: string) =>
  row.op === 'update' && JSON.stringify(row.before?.[field] ?? null) !== JSON.stringify(row.after?.[field] ?? null);
const became = (row: ActivityRow, field: string, value: unknown) =>
  changed(row, field) && row.after?.[field] === value;
const of = (row: ActivityRow) => row.after ?? row.before ?? {};

export function describeChange(row: ActivityRow): Summary {
  const r = of(row);
  const name = String(r.name ?? r.title ?? r.task_title ?? '');
  const title = String(r.task_title ?? r.title ?? '');
  switch (row.table_name) {
    case 'profiles':
      if (row.op === 'insert') return { key: 'activity.createdAccount', params: { name } };
      if (row.op === 'delete') return { key: 'activity.deletedPerson', params: { name } };
      if (changed(row, 'deleted_at') && row.after?.deleted_at) return { key: 'activity.deletedPerson', params: { name } };
      if (became(row, 'active', false)) return { key: 'activity.deactivated', params: { name } };
      if (became(row, 'active', true)) return { key: 'activity.reactivated', params: { name } };
      if (became(row, 'must_change_password', true)) return { key: 'activity.resetPassword', params: { name } };
      if (changed(row, 'role')) return { key: 'activity.changedRole', params: { name, from: row.before?.role, to: row.after?.role } };
      return { key: 'activity.editedProfile', params: { name } };
    case 'organizations':
      if (changed(row, 'iqd_per_point'))
        return { key: 'activity.pointValue', params: { from: Number(row.before?.iqd_per_point).toLocaleString('en'), to: Number(row.after?.iqd_per_point).toLocaleString('en') } };
      return { key: 'activity.editedOrg', params: {} };
    case 'teams':
      if (row.op === 'insert') return { key: 'activity.createdBranch', params: { name } };
      if (row.op === 'delete') return { key: 'activity.deletedBranch', params: { name } };
      if (changed(row, 'radius_m')) return { key: 'activity.branchDistance', params: { name, from: row.before?.radius_m, to: row.after?.radius_m } };
      if (changed(row, 'lat') || changed(row, 'lng')) return { key: 'activity.movedPin', params: { name } };
      return { key: 'activity.editedBranch', params: { name } };
    case 'task_completions':
      if (row.op === 'insert') return { key: 'activity.submitted', params: { title } };
      if (row.op === 'delete') return { key: 'activity.deletedRecord', params: { title } };
      if (changed(row, 'reviewed_by') && row.after?.reviewed_by) return { key: 'activity.verified', params: { title } };
      if (changed(row, 'points_awarded'))
        return { key: 'activity.changedPoints', params: { title, from: row.before?.points_awarded ?? 0, to: row.after?.points_awarded ?? 0 } };
      return { key: 'activity.editedRecord', params: { title } };
    case 'tasks':
      if (row.op === 'insert') return { key: 'activity.createdTask', params: { title } };
      if (row.op === 'delete') return { key: 'activity.deletedTask', params: { title } };
      return { key: 'activity.editedTask', params: { title } };
    case 'checklist_templates':
      if (row.op === 'insert') return { key: 'activity.createdChecklist', params: { name } };
      if (row.op === 'delete' || became(row, 'archived', true)) return { key: 'activity.deletedChecklist', params: { name } };
      return { key: 'activity.editedChecklist', params: { name } };
    case 'checklist_template_items':
      return { key: 'activity.editedQuestions', params: {} };
    case 'oil_fryers':
      if (row.op === 'insert') return { key: 'activity.addedFryer', params: { name } };
      if (row.op === 'delete' || became(row, 'archived', true)) return { key: 'activity.removedFryer', params: { name } };
      if (changed(row, 'name')) return { key: 'activity.renamedFryer', params: { from: row.before?.name, to: row.after?.name } };
      return { key: 'activity.editedFryer', params: { name } };
    case 'oil_tests':
      if (row.op === 'insert') return { key: 'activity.didOilTest', params: {} };
      if (row.op === 'delete') return { key: 'activity.deletedOilTest', params: {} };
      return { key: 'activity.editedOilTest', params: {} };
    case 'chicken_marinations':
      if (row.op === 'insert') return { key: 'activity.marinated', params: {} };
      if (row.op === 'delete') return { key: 'activity.deletedMarination', params: {} };
      if (changed(row, 'unloaded_at') && row.after?.unloaded_at) return { key: 'activity.emptiedMarination', params: {} };
      return { key: 'activity.editedMarination', params: {} };
    case 'points_adjustments':
    case 'period_adjustments':
      return { key: 'activity.adjustedPoints', params: {} };
    case 'profile_teams':
      return { key: row.op === 'delete' ? 'activity.removedFromBranch' : 'activity.addedToBranch', params: {} };
    default:
      return { key: 'activity.changedTable', params: { table: String(row.table_name ?? '').replace(/_/g, ' '), op: row.op ?? '' } };
  }
}

export function describeSingle(row: ActivityRow): Summary {
  const d = row.detail ?? {};
  if (row.kind === 'sign_in') return { key: row.op === 'resume' ? 'activity.cameBack' : 'activity.openedApp', params: {} };
  if (row.kind === 'password') return { key: 'activity.resetPassword', params: { name: String(d.target_name ?? '') } };
  if (row.kind === 'export') {
    if (row.op === 'oil_pdf') return { key: 'activity.exportedOil', params: { branch: String(d.branch ?? '') } };
    if (row.op === 'month_report') return { key: 'activity.exportedMonth', params: {} };
    return { key: 'activity.exportedRecord', params: { title: String(d.title ?? '') } };
  }
  if (row.kind === 'view') {
    if (row.op === 'record') return { key: 'activity.openedRecord', params: { title: String(d.title ?? '') } };
    const screen = SCREENS[row.op ?? ''];
    return screen ? { key: 'activity.openedScreen', params: { screenKey: screen } } : { key: 'activity.openedPath', params: { path: row.op ?? '' } };
  }
  return describeChange(row);
}

const SERIOUS = new Set([
  'activity.deletedPerson', 'activity.deactivated', 'activity.resetPassword', 'activity.deletedBranch',
  'activity.deletedRecord', 'activity.deletedOilTest', 'activity.deletedMarination', 'activity.deletedChecklist',
]);

/** Newest first in, newest first out. Change rows from one transaction become one group. */
export function groupActivity(rows: ActivityRow[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const byTx = new Map<string, ActivityGroup>();
  for (const row of rows) {
    const txKey = row.kind === 'change' ? `${row.actor_id}:${row.txid}` : null;
    const existing = txKey ? byTx.get(txKey) : undefined;
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const g: ActivityGroup = {
      key: txKey ?? `row:${row.id}`,
      actorId: row.actor_id,
      actorName: row.actor_name ?? '',
      at: row.created_at,
      ip: row.ip,
      device: deviceOf(row.user_agent),
      rows: [row],
      summary: { key: '', params: {} },
      more: 0,
      serious: false,
    };
    groups.push(g);
    if (txKey) byTx.set(txKey, g);
  }
  for (const g of groups) {
    const rank = (r: ActivityRow) => {
      const i = PRIORITY.indexOf(r.table_name ?? '');
      return i === -1 ? PRIORITY.length : i;
    };
    const lead = g.rows.length === 1 ? g.rows[0] : [...g.rows].sort((a, b) => rank(a) - rank(b))[0];
    g.summary = describeSingle(lead);
    g.more = g.rows.length - 1;
    g.serious = SERIOUS.has(g.summary.key);
  }
  return groups;
}

/** Fields an update actually changed, for the detail view. */
export function changedFields(row: ActivityRow): { field: string; from: unknown; to: unknown }[] {
  if (row.op !== 'update' || !row.before || !row.after) return [];
  const keys = new Set([...Object.keys(row.before), ...Object.keys(row.after)]);
  return [...keys]
    .filter((k) => k !== 'updated_at' && JSON.stringify(row.before![k] ?? null) !== JSON.stringify(row.after![k] ?? null))
    .map((k) => ({ field: k, from: row.before![k], to: row.after![k] }));
}
