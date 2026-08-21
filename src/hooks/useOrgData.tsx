import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { ChecklistAnswer, ChecklistSectionPhoto, OrgTask, Priority, Profile, Team, TaskCompletion } from '../types';

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
    createdAt: row.created_at,
  };
}

function mapTeam(row: any): Team {
  return { id: row.id, orgId: row.org_id, name: row.name, createdAt: row.created_at };
}

function mapProfile(row: any, teamIds: string[]): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    teamIds,
    name: row.name,
    title: row.title,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password,
    active: row.active,
    recoveryEmail: row.recovery_email,
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
  answer: boolean;
  note?: string;
}

export interface SubmitPhotoInput {
  sectionTitle: string;
  photoUrl: string;
}

interface OrgDataContextValue {
  tasks: OrgTask[];
  teams: Team[];
  members: Profile[];
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
  }) => Promise<void>;
  setTaskCompletion: (
    taskId: string,
    completed: boolean,
    note?: string,
    photoUrls?: string[],
    answers?: SubmitAnswerInput[],
    sectionPhotos?: SubmitPhotoInput[]
  ) => Promise<void>;
  declareTaskOffDuty: (taskId: string, reason: string) => Promise<void>;
  reviewOffDuty: (completionId: string, approve: boolean, reviewNote?: string) => Promise<void>;
  reviewTaskCompletion: (completionId: string, reviewNote?: string) => Promise<void>;
  loadCompletionDetail: (completionId: string) => Promise<{ answers: ChecklistAnswer[]; photos: ChecklistSectionPhoto[] }>;
  createTeam: (name: string) => Promise<void>;
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

  const refresh = useCallback(async () => {
    if (!profile || !organization) {
      setTasks([]);
      setTeams([]);
      setMembers([]);
      setHistory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [tasksRes, teamsRes, membersRes, historyRes] = await Promise.all([
      supabase.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false }),
      supabase.from('teams').select('*').eq('org_id', organization.id).order('created_at', { ascending: true }),
      supabase.from('profiles').select('*').eq('org_id', organization.id),
      // No role filter here on purpose — the RLS policy already narrows this
      // to the whole org, one team, or just this user.
      supabase.from('task_completions').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    if (!teamsRes.error) setTeams((teamsRes.data ?? []).map(mapTeam));

    if (!membersRes.error) {
      const rows = membersRes.data ?? [];
      // Fetched separately so every member's memberships are known, not just
      // the signed-in profile's — People/Teams/task-assignment all need it.
      const { data: membershipRows } = rows.length
        ? await supabase.from('profile_teams').select('profile_id, team_id').in('profile_id', rows.map((r) => r.id))
        : { data: [] as { profile_id: string; team_id: string }[] };
      const byProfile = new Map<string, string[]>();
      for (const m of membershipRows ?? []) {
        const list = byProfile.get(m.profile_id) ?? [];
        list.push(m.team_id);
        byProfile.set(m.profile_id, list);
      }
      setMembers(rows.map((row) => mapProfile(row, byProfile.get(row.id) ?? [])));
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
        created_by: profile.id,
      });
      if (error) throw error;
      await refresh();
    },
    [profile, organization, refresh]
  );

  const setTaskCompletion = useCallback<OrgDataContextValue['setTaskCompletion']>(
    async (taskId, completed, note, photoUrls, answers, sectionPhotos) => {
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

  const createTeam = useCallback<OrgDataContextValue['createTeam']>(
    async (name) => {
      const { error } = await supabase.rpc('create_team', { p_name: name });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const value = useMemo<OrgDataContextValue>(
    () => ({
      tasks,
      teams,
      members,
      history,
      loading,
      refresh,
      createTask,
      setTaskCompletion,
      declareTaskOffDuty,
      reviewOffDuty,
      reviewTaskCompletion,
      loadCompletionDetail,
      createTeam,
    }),
    [
      tasks,
      teams,
      members,
      history,
      loading,
      refresh,
      createTask,
      setTaskCompletion,
      declareTaskOffDuty,
      reviewOffDuty,
      reviewTaskCompletion,
      loadCompletionDetail,
      createTeam,
    ]
  );

  return <OrgDataContext.Provider value={value}>{children}</OrgDataContext.Provider>;
}

export function useOrgData(): OrgDataContextValue {
  const ctx = useContext(OrgDataContext);
  if (!ctx) throw new Error('useOrgData must be used within OrgDataProvider');
  return ctx;
}
