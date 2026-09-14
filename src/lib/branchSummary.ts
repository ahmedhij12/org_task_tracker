import type { BranchSummaryRow } from '@/types';

export interface BrandGroup {
  brandKey: string;
  brandName: string;
  totalPoints: number;
  iqdAmount: number;
  rows: BranchSummaryRow[];
}

export interface BranchGroup {
  branchId: string;
  branchName: string;
  totalPoints: number;
  iqdAmount: number;
  brandGroups: BrandGroup[];
}

/** Branch -> brand -> subject, from the flat rows get_current_branch_summary
 * / get_period_report return. A subject with no brand (or a branch with no
 * brands configured at all) lands in an "Unassigned" group, never dropped. */
export function groupBranchSummary(rows: BranchSummaryRow[]): BranchGroup[] {
  const branches = new Map<string, BranchGroup>();
  for (const row of rows) {
    let branch = branches.get(row.branchId);
    if (!branch) {
      branch = { branchId: row.branchId, branchName: row.branchName, totalPoints: 0, iqdAmount: 0, brandGroups: [] };
      branches.set(row.branchId, branch);
    }
    branch.totalPoints += row.totalPoints;
    branch.iqdAmount += row.iqdAmount;

    const brandKey = row.brandId ?? '__unassigned__';
    let brandGroup = branch.brandGroups.find((g) => g.brandKey === brandKey);
    if (!brandGroup) {
      brandGroup = { brandKey, brandName: row.brandName ?? 'Unassigned', totalPoints: 0, iqdAmount: 0, rows: [] };
      branch.brandGroups.push(brandGroup);
    }
    brandGroup.totalPoints += row.totalPoints;
    brandGroup.iqdAmount += row.iqdAmount;
    brandGroup.rows.push(row);
  }
  return Array.from(branches.values()).sort((a, b) => a.branchName.localeCompare(b.branchName));
}
