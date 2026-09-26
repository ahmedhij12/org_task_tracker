import type { BranchSummaryRow } from '@/types';

/** What a person owes that month: the audit money plus late-checklist
 * penalties (points are negative, a penalty is a positive amount owed). */
export const totalIqdOf = (row: Pick<BranchSummaryRow, 'iqdAmount' | 'latePenaltyIqd'>) => row.iqdAmount - (row.latePenaltyIqd ?? 0);

export interface BrandGroup {
  brandKey: string;
  /** Null means "no brand" (brandKey === '__unassigned__') — presentation-agnostic,
   * the caller supplies its own translated "Unassigned" label. */
  brandName: string | null;
  totalPoints: number;
  iqdAmount: number;
  rows: BranchSummaryRow[];
}

export interface BranchGroup {
  branchId: string;
  branchName: string;
  totalPoints: number;
  iqdAmount: number;
  /** Across every scored audit in the branch — null when none has a score yet. */
  avgScore: number | null;
  scoreCount: number;
  brandGroups: BrandGroup[];
}

/** Branch -> brand -> subject, from the flat rows get_current_branch_summary
 * / get_period_report return. A subject with no brand (or a branch with no
 * brands configured at all) lands in an unassigned group (brandName: null),
 * never dropped — the caller decides how to label/render that group. */
export function groupBranchSummary(rows: BranchSummaryRow[]): BranchGroup[] {
  const branches = new Map<string, BranchGroup>();
  const scoreSums = new Map<string, number>();
  for (const row of rows) {
    let branch = branches.get(row.branchId);
    if (!branch) {
      branch = { branchId: row.branchId, branchName: row.branchName, totalPoints: 0, iqdAmount: 0, avgScore: null, scoreCount: 0, brandGroups: [] };
      branches.set(row.branchId, branch);
    }
    branch.totalPoints += row.totalPoints;
    branch.iqdAmount += totalIqdOf(row);
    if (row.scoreCount) {
      branch.scoreCount += row.scoreCount;
      scoreSums.set(row.branchId, (scoreSums.get(row.branchId) ?? 0) + (row.scoreSum ?? 0));
      branch.avgScore = scoreSums.get(row.branchId)! / branch.scoreCount;
    }

    const brandKey = row.brandId ?? '__unassigned__';
    let brandGroup = branch.brandGroups.find((g) => g.brandKey === brandKey);
    if (!brandGroup) {
      brandGroup = { brandKey, brandName: row.brandName ?? null, totalPoints: 0, iqdAmount: 0, rows: [] };
      branch.brandGroups.push(brandGroup);
    }
    brandGroup.totalPoints += row.totalPoints;
    brandGroup.iqdAmount += totalIqdOf(row);
    brandGroup.rows.push(row);
  }
  return Array.from(branches.values()).sort((a, b) => a.branchName.localeCompare(b.branchName));
}
