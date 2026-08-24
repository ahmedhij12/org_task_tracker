import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { PersonalTask } from '@/types';

function mapTask(row: {
  id: string;
  owner_id: string;
  title: string;
  notes: string | null;
  due: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}): PersonalTask {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    notes: row.notes,
    due: row.due,
    completed: row.completed,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function usePersonalTasks() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('personal_tasks')
      .select('*')
      .order('due', { ascending: true, nullsFirst: false });
    if (!error && data) setTasks(data.map(mapTask));
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTask = async ({ title, notes, due }: { title: string; notes?: string; due?: string | null }) => {
    if (!session) throw new Error('Not signed in.');
    const { error } = await supabase.from('personal_tasks').insert({
      owner_id: session.user.id,
      title,
      notes: notes ?? null,
      due: due ?? null,
    });
    if (error) throw error;
    await refresh();
  };

  const setCompletion = async (id: string, completed: boolean) => {
    const { error } = await supabase
      .from('personal_tasks')
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('personal_tasks').delete().eq('id', id);
    if (error) throw error;
    await refresh();
  };

  return { tasks, loading, refresh, createTask, setCompletion, deleteTask };
}
