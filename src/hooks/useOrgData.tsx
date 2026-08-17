import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { OrgTask, Priority, Profile, Team, TaskCompletion } from '../types';

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
    createdAt: row.created_at,
  };
}

function mapTeam(row: any): Team {
  return { id: row.id, orgId: row.org_id, name: row.name, createdAt: row.created_at };
}

function mapProfile(row: any): Profile {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
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
  }) => Promise<void>;
  setTaskCompletion: (taskId: string, completed: boolean, note?: string, photoUrls?: string[]) => Promise<void>;
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
    if (!tasksRes.error) setTasks((tasksRes.data ?? []).map(mapTask));
    if (!teamsRes.error) setTeams((teamsRes.data ?? []).map(mapTeam));
    if (!membersRes.error) setMembers((membersRes.data ?? []).map(mapProfile));
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
        created_by: profile.id,
      });
      if (error) throw error;
      await refresh();
    },
    [profile, organization, refresh]
  );

  const setTaskCompletion = useCallback<OrgDataContextValue['setTaskCompletion']>(
    async (taskId, completed, note, photoUrls) => {
      const { error } = await supabase.rpc('set_task_completion', {
        p_task_id: taskId,
        p_completed: completed,
        p_note: note ?? null,
        p_photo_urls: photoUrls ?? [],
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

  const value = useMemo<OrgDataContextValue>(
    () => ({ tasks, teams, members, history, loading, refresh, createTask, setTaskCompletion, createTeam }),
    [tasks, teams, members, history, loading, refresh, createTask, setTaskCompletion, createTeam]
  );

  return <OrgDataContext.Provider value={value}>{children}</OrgDataContext.Provider>;
}

export function useOrgData(): OrgDataContextValue {
  const ctx = useContext(OrgDataContext);
  if (!ctx) throw new Error('useOrgData must be used within OrgDataProvider');
  return ctx;
}
