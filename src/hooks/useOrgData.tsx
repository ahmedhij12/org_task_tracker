import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Brand, ChecklistAnswer, ChecklistSectionPhoto, OrgTask, Priority, PointsAdjustment, Profile, Team, TaskCompletion } from '../types';

function mapTask(row: any): OrgTask {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    title: row.title,
    notes: row.notes,
    due: row.due,
    priority: row.priority as Priority,
    assigneeId: row.assignee_id,
    requiresProof: row.requires_proof,
    templateId: row.template_id,
    cooldownHours: row.cooldown_hours,
    requiresReview: row.requires_review,
    isAudit: row.is_audit,
    completed: row.completed,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    proofNote: row.proof_note,
    proofPhotoUrls: row.proof_photo_urls ?? [],
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapCompletion(row: any): TaskCompletion {
  return {
    id: row.id,
    taskId: row.task_id,
    orgId: row.org_id,
    teamId: row.team_id,
    taskTitle: row.task_title,
    actorId: row.actor_id,
    action: row.action,
    note: row.note,
    photoUrls: row.photo_urls ?? [],
    dueAt: row.due_at,
    wasLate: row.was_late,
    status: row.status,
    offDutyReason: row.off_duty_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    yesCount: row.yes_count,
    noCount: row.no_count,
    subjectProfileId: row.subject_profile_id,
    shift: row.shift,
    pointsAwarded: row.points_awarded,
    iqdPerPoint: Number(row.iqd_per_point),
    score: row.score != null ? Number(row.score) : null,
    signedLat: row.signed_lat,
    signedLng: row.signed_lng,
    signedAccuracyM: row.signed_accuracy_m,
    signedAddress: row.signed_address ?? null,
    selfieUrl: row.selfie_url ?? null,
    signatureUrl: row.signature_url,
    createdAt: row.created_at,
  };
}

function mapTeam(row: any): Team {
  return { id: row.id, orgId: row.org_id, name: row.name, timezone: row.timezone ?? 'Asia/Baghdad', createdAt: row.created_at };
}

function mapBrand(row: any): Brand {
  return { id: row.id, orgId: row.org_id, name: row.name, archived: row.archived, createdAt: row.created_at };
}

function mapProfile(row: any, teamIds: string[], teamBrandIds: Record<string, string | null>): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    teamIds,
    teamBrandIds,
    name: row.name,
    title: row.title,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password,
    active: row.active,
    recoveryEmail: row.recovery_email,
    deletedAt: row.deleted_at ?? null,
    avatarUrl: row.avatar_url ?? null,
    employeeCode: row.employee_code ?? null,
    createdAt: row.created_at,
  };
}

function mapAnswer(row: any): ChecklistAnswer {
  return {
    id: row.id,
    taskCompletionId: row.task_completion_id,
    sectionTitle: row.section_title,
    question: row.question,
    sortOrder: row.sort_order,
    answer: row.answer,
    note: row.note,
  };
}

function mapPointsAdjustment(row: any): PointsAdjustment {
  return {
    id: row.id,
    taskCompletionId: row.task_completion_id,
    previousPoints: row.previous_points,
    newPoints: row.new_points,
    adjustedBy: row.adjusted_by,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapPhoto(row: any): ChecklistSectionPhoto {
  return {
    id: row.id,
    taskCompletionId: row.task_completion_id,
    sectionTitle: row.section_title,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
}

export interface SubmitAnswerInput {
  sectionTitle: string;
  question: string;
  sortOrder: number;
  /** null means N/A — excluded from scoring, no note required. */
  answer: boolean | null;
  note?: string;
}

export interface SubmitPhotoInput {
  sectionTitle: string;
  photoUrl: string;
}

interface OrgDataContextValue {
  tasks: OrgTask[];
  teams: Team[];
  /** Everyone current — deleted staff are left out, so no list or picker offers them. */
  members: Profile[];
  /** Including deleted staff — only for resolving names on past records (History, audit detail). */
  allMembers: Profile[];
  /** Audit log, already scoped by RLS to what this role is allowed to see. */
  history: TaskCompletion[];
  loading: boolean;
  refresh: () => Promise<void>;
  createTask: (input: {
    title: string;
    notes?: string;
    due?: string | null;
    priority: Priority;
    assigneeId: string | null;
    requiresProof: boolean;
    teamId: string;
    templateId?: string | null;
    cooldownHours?: number | null;
    requiresReview: boolean;
    isAudit?: boolean;
  }) => Promise<void>;
  setTaskCompletion: (
    taskId: string,
    completed: boolean,
    note?: string,
    photoUrls?: string[],
    answers?: SubmitAnswerInput[],
    sectionPhotos?: SubmitPhotoInput[],
    audit?: {
      subjectProfileId: string;
      shift: 'morning' | 'evening';
      signatureUrl?: string;
      location?: { lat: number; lng: number; accuracy: number | null; address?: string | null };
    },
    /** Supervisor daily checklist proof: live selfie + where it was submitted. */
    proof?: { selfieUrl: string; signatureUrl?: string; location: { lat: number; lng: number; accuracy: number | null; address?: string | null } }
  ) => Promise<void>;
  declareTaskOffDuty: (taskId: string, reason: string) => Promise<void>;
  /** Owner/team_admin only, matches the existing tasks DELETE RLS policy. Used for swipe-to-delete. */
  deleteTask: (taskId: string) => Promise<void>;
  reviewOffDuty: (completionId: string, approve: boolean, reviewNote?: string) => Promise<void>;
  reviewTaskCompletion: (completionId: string, reviewNote?: string) => Promise<void>;
  loadCompletionDetail: (completionId: string) => Promise<{ answers: ChecklistAnswer[]; photos: ChecklistSectionPhoto[] }>;
  loadPointsAdjustments: (completionId: string) => Promise<PointsAdjustment[]>;
  /** Owner: any audit in the org. Team_admin: only ones they personally performed — same rule as adjust_completion_points itself. */
  adjustCompletionPoints: (completionId: string, newPoints: number, reason?: string) => Promise<void>;
  createTeam: (name: string) => Promise<void>;
  brands: Brand[];
  branchBrandIds: Record<string, string[]>;
  createBrand: (name: string) => Promise<string>;
  setBranchBrands: (branchId: string, brandIds: string[]) => Promise<void>;
}

const OrgDataContext = createContext<OrgDataContextValue | null>(null);

// One instance of this provider lives above every (main) screen, so there is
// exactly one fetch and one Realtime subscription per org — not one per
// screen. Supabase's realtime client dedupes channels by topic name, so two
// independent hook instances both calling .channel(sameName).on(...).subscribe()
// throws ("cannot add postgres_changes callbacks ... after subscribe()") the
// moment a second screen mounts alongside the first (normal in a tab navigator,
// where previously-visited tabs stay mounted).
export function OrgDataProvider({ children }: { children: ReactNode }) {
  const { profile, organization } = useAuth();
  const [tasks, setTasks] = useState<OrgTask[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [history, setHistory] = useState<TaskCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branchBrandIds, setBranchBrandIds] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    if (!profile || !organization) {
      setTasks([]);
      setTeams([]);
      setMembers([]);
      setHistory([]);
      setBrands([]);
      setBranchBrandIds({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const [tasksRes, teamsRes, membersRes, historyRes, brandsRes, branchBrandsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false }),
      supabase.from('teams').select('*').eq('org_id', organization.id).order('created_at', { ascending: true }),
      supabase.from('profiles').select('*').eq('org_id', organization.id),
      // No role filter here on purpose — the RLS policy already narrows this
      // to the whole org, one team, or just this user.
      supabase.from('task_completions').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('brands').select('*').eq('org_id', organization.id).order('created_at', { ascending: true }),
      supabase.from('branch_brands').select('branch_id, brand_id'),
    ]);
    if (!teamsRes.error) setTeams((teamsRes.data ?? []).map(mapTeam));
    if (!brandsRes.error) setBrands((brandsRes.data ?? []).map(mapBrand));
    if (!branchBrandsRes.error) {
      // branch_brands has no ORDER BY, so Postgres doesn't guarantee row
      // order for it — sort each branch's list by the brand's position in
      // the already-ordered `brands` array so callers (Tasks 7-9) render a
      // consistent, brands-insertion-order sequence of chips.
      const brandOrder = new Map((brandsRes.data ?? []).map((b: any, i: number) => [b.id as string, i]));
      const byBranch = new Map<string, string[]>();
      for (const r of branchBrandsRes.data ?? []) {
        const list = byBranch.get(r.branch_id) ?? [];
        list.push(r.brand_id);
        byBranch.set(r.branch_id, list);
      }
      for (const list of byBranch.values()) {
        list.sort((a, b) => (brandOrder.get(a) ?? 0) - (brandOrder.get(b) ?? 0));
      }
      setBranchBrandIds(Object.fromEntries(byBranch));
    }

    if (!membersRes.error) {
      const rows = membersRes.data ?? [];
      // Fetched separately so every member's memberships are known, not just
      // the signed-in profile's — People/Teams/task-assignment all need it.
      const { data: membershipRows } = rows.length
        ? await supabase.from('profile_teams').select('profile_id, team_id, brand_id').in('profile_id', rows.map((r) => r.id))
        : { data: [] as { profile_id: string; team_id: string; brand_id: string | null }[] };
      const byProfile = new Map<string, string[]>();
      const brandByProfile = new Map<string, Record<string, string | null>>();
      for (const m of membershipRows ?? []) {
        const list = byProfile.get(m.profile_id) ?? [];
        list.push(m.team_id);
        byProfile.set(m.profile_id, list);
        const brandMap = brandByProfile.get(m.profile_id) ?? {};
        brandMap[m.team_id] = m.brand_id;
        brandByProfile.set(m.profile_id, brandMap);
      }
      setMembers(rows.map((row) => mapProfile(row, byProfile.get(row.id) ?? [], brandByProfile.get(row.id) ?? {})));
    }

    if (!tasksRes.error) setTasks((tasksRes.data ?? []).map(mapTask));
    if (!historyRes.error) setHistory((historyRes.data ?? []).map(mapCompletion));
    setLoading(false);
  }, [profile, organization]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!organization) return;
    const channel = supabase
      .channel(`org-${organization.id}-tasks`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `org_id=eq.${organization.id}` },
        () => refresh()
      )
      // A verification or off-duty review only touches task_completions, so the
      // supervisor's screen needs this to flip to "Verified" without a refresh.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_completions', filter: `org_id=eq.${organization.id}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organization, refresh]);

  const createTask = useCallback<OrgDataContextValue['createTask']>(
    async (input) => {
      if (!profile || !organization) return;
      const { error } = await supabase.from('tasks').insert({
        org_id: organization.id,
        team_id: input.teamId,
        title: input.title,
        notes: input.notes || null,
        due: input.due || null,
        priority: input.priority,
        assignee_id: input.assigneeId,
        requires_proof: input.requiresProof,
        template_id: input.templateId ?? null,
        cooldown_hours: input.cooldownHours ?? null,
        requires_review: input.requiresReview,
        is_audit: input.isAudit ?? false,
        created_by: profile.id,
      });
      if (error) throw error;
      await refresh();
    },
    [profile, organization, refresh]
  );

  const setTaskCompletion = useCallback<OrgDataContextValue['setTaskCompletion']>(
    async (taskId, completed, note, photoUrls, answers, sectionPhotos, audit, proof) => {
      const { error } = await supabase.rpc('set_task_completion', {
        p_task_id: taskId,
        p_completed: completed,
        p_note: note ?? null,
        p_photo_urls: photoUrls ?? [],
        p_answers: answers
          ? answers.map((a) => ({
              section_title: a.sectionTitle,
              question: a.question,
              sort_order: a.sortOrder,
              answer: a.answer,
              note: a.note ?? null,
            }))
          : null,
        p_section_photos: (sectionPhotos ?? []).map((p) => ({ section_title: p.sectionTitle, photo_url: p.photoUrl })),
        p_subject_profile_id: audit?.subjectProfileId ?? null,
        p_shift: audit?.shift ?? null,
        p_signature_url: audit?.signatureUrl ?? proof?.signatureUrl ?? null,
        p_location: audit?.location ?? proof?.location ?? null,
        p_selfie_url: proof?.selfieUrl ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const declareTaskOffDuty = useCallback<OrgDataContextValue['declareTaskOffDuty']>(
    async (taskId, reason) => {
      const { error } = await supabase.rpc('declare_task_off_duty', { p_task_id: taskId, p_reason: reason });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const deleteTask = useCallback<OrgDataContextValue['deleteTask']>(
    async (taskId) => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const reviewOffDuty = useCallback<OrgDataContextValue['reviewOffDuty']>(
    async (completionId, approve, reviewNote) => {
      const { error } = await supabase.rpc('review_off_duty', {
        p_completion_id: completionId,
        p_approve: approve,
        p_review_note: reviewNote ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const reviewTaskCompletion = useCallback<OrgDataContextValue['reviewTaskCompletion']>(
    async (completionId, reviewNote) => {
      const { error } = await supabase.rpc('review_task_completion', {
        p_completion_id: completionId,
        p_review_note: reviewNote ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const loadCompletionDetail = useCallback<OrgDataContextValue['loadCompletionDetail']>(async (completionId) => {
    const [answersRes, photosRes] = await Promise.all([
      supabase.from('checklist_answers').select('*').eq('task_completion_id', completionId).order('sort_order', { ascending: true }),
      supabase.from('checklist_section_photos').select('*').eq('task_completion_id', completionId),
    ]);
    if (answersRes.error) throw answersRes.error;
    if (photosRes.error) throw photosRes.error;
    return {
      answers: (answersRes.data ?? []).map(mapAnswer),
      photos: (photosRes.data ?? []).map(mapPhoto),
    };
  }, []);

  const loadPointsAdjustments = useCallback<OrgDataContextValue['loadPointsAdjustments']>(async (completionId) => {
    const { data, error } = await supabase
      .from('points_adjustments')
      .select('*')
      .eq('task_completion_id', completionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapPointsAdjustment);
  }, []);

  const adjustCompletionPoints = useCallback<OrgDataContextValue['adjustCompletionPoints']>(
    async (completionId, newPoints, reason) => {
      const { error } = await supabase.rpc('adjust_completion_points', {
        p_completion_id: completionId,
        p_new_points: newPoints,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const createTeam = useCallback<OrgDataContextValue['createTeam']>(
    async (name) => {
      const { error } = await supabase.rpc('create_team', { p_name: name });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const createBrand = useCallback<OrgDataContextValue['createBrand']>(
    async (name) => {
      const { data, error } = await supabase.rpc('create_brand', { p_name: name });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [refresh]
  );

  const setBranchBrands = useCallback<OrgDataContextValue['setBranchBrands']>(
    async (branchId, brandIds) => {
      const { error } = await supabase.rpc('set_branch_brands', { p_branch_id: branchId, p_brand_ids: brandIds });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const currentMembers = useMemo(() => members.filter((m) => !m.deletedAt), [members]);

  const value = useMemo<OrgDataContextValue>(
    () => ({
      tasks,
      teams,
      members: currentMembers,
      allMembers: members,
      history,
      loading,
      refresh,
      createTask,
      setTaskCompletion,
      declareTaskOffDuty,
      deleteTask,
      reviewOffDuty,
      reviewTaskCompletion,
      loadCompletionDetail,
      loadPointsAdjustments,
      adjustCompletionPoints,
      createTeam,
      brands,
      branchBrandIds,
      createBrand,
      setBranchBrands,
    }),
    [
      tasks,
      teams,
      members,
      currentMembers,
      history,
      loading,
      refresh,
      createTask,
      setTaskCompletion,
      declareTaskOffDuty,
      deleteTask,
      reviewOffDuty,
      reviewTaskCompletion,
      loadCompletionDetail,
      loadPointsAdjustments,
      adjustCompletionPoints,
      createTeam,
      brands,
      branchBrandIds,
      createBrand,
      setBranchBrands,
    ]
  );

  return <OrgDataContext.Provider value={value}>{children}</OrgDataContext.Provider>;
}

export function useOrgData(): OrgDataContextValue {
  const ctx = useContext(OrgDataContext);
  if (!ctx) throw new Error('useOrgData must be used within OrgDataProvider');
  return ctx;
}
