import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { OrgTask, Priority, Profile, Team } from '../types';

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
    proofPhotoUrl: row.proof_photo_url,
    createdAt: row.created_at,
    createdBy: row.created_by,
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
    role: row.role,
    createdAt: row.created_at,
  };
}

export function useOrgData() {
  const { profile, organization } = useAuth();
  const [tasks, setTasks] = useState<OrgTask[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile || !organization) {
      setTasks([]);
      setTeams([]);
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [tasksRes, teamsRes, membersRes] = await Promise.all([
      supabase.from('tasks').select('*').order('due', { ascending: true, nullsFirst: false }),
      supabase.from('teams').select('*').eq('org_id', organization.id).order('created_at', { ascending: true }),
      supabase.from('profiles').select('*').eq('org_id', organization.id),
    ]);
    if (!tasksRes.error) setTasks((tasksRes.data ?? []).map(mapTask));
    if (!teamsRes.error) setTeams((teamsRes.data ?? []).map(mapTeam));
    if (!membersRes.error) setMembers((membersRes.data ?? []).map(mapProfile));
    setLoading(false);
  }, [profile, organization]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: any task change in this org refreshes the list. Scoping the
  // subscription to org_id (not team_id) keeps this one hook correct for
  // both the owner's cross-team view and a team member's own view.
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

  const createTask = useCallback(
    async (input: {
      title: string;
      notes?: string;
      due?: string | null;
      priority: Priority;
      assigneeId: string | null;
      requiresProof: boolean;
      teamId: string;
    }) => {
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

  const setTaskCompletion = useCallback(
    async (taskId: string, completed: boolean, note?: string, photoUrl?: string) => {
      const { error } = await supabase.rpc('set_task_completion', {
        p_task_id: taskId,
        p_completed: completed,
        p_note: note ?? null,
        p_photo_url: photoUrl ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const createTeam = useCallback(
    async (name: string, adminProfileId?: string) => {
      const { error } = await supabase.rpc('create_team', {
        p_name: name,
        p_admin_profile_id: adminProfileId ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  return { tasks, teams, members, loading, refresh, createTask, setTaskCompletion, createTeam };
}
