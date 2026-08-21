import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { ChecklistItemDraft, ChecklistTemplate, ChecklistTemplateItem } from '../types';

// A checklist is a task with a template attached — see useOrgData for the
// task/completion side. This hook only owns the reusable question sets
// (templates), which get picked when creating a checklist task.

function mapTemplate(row: any): ChecklistTemplate {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    requiresNoteOnNo: row.requires_note_on_no,
    archived: row.archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapItem(row: any): ChecklistTemplateItem {
  return {
    id: row.id,
    templateId: row.template_id,
    sectionTitle: row.section_title,
    sortOrder: row.sort_order,
    question: row.question,
  };
}

interface ChecklistDataContextValue {
  templates: ChecklistTemplate[];
  templateItems: ChecklistTemplateItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  createTemplate: (name: string, requiresNoteOnNo: boolean, items: ChecklistItemDraft[]) => Promise<string>;
}

const ChecklistDataContext = createContext<ChecklistDataContextValue | null>(null);

export function ChecklistDataProvider({ children }: { children: ReactNode }) {
  const { profile, organization } = useAuth();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [templateItems, setTemplateItems] = useState<ChecklistTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile || !organization) {
      setTemplates([]);
      setTemplateItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: templateRows, error: templatesError } = await supabase
      .from('checklist_templates')
      .select('*')
      .eq('archived', false)
      .order('created_at', { ascending: true });
    if (!templatesError) setTemplates((templateRows ?? []).map(mapTemplate));

    if (templateRows && templateRows.length > 0) {
      const { data: itemRows, error: itemsError } = await supabase
        .from('checklist_template_items')
        .select('*')
        .in('template_id', templateRows.map((t) => t.id))
        .order('sort_order', { ascending: true });
      if (!itemsError) setTemplateItems((itemRows ?? []).map(mapItem));
    } else {
      setTemplateItems([]);
    }
    setLoading(false);
  }, [profile, organization]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTemplate = useCallback<ChecklistDataContextValue['createTemplate']>(
    async (name, requiresNoteOnNo, items) => {
      const { data, error } = await supabase.rpc('create_checklist_template', {
        p_name: name,
        p_requires_note_on_no: requiresNoteOnNo,
        p_items: items.map((it) => ({ section_title: it.sectionTitle, question: it.question })),
      });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [refresh]
  );

  const value = useMemo<ChecklistDataContextValue>(
    () => ({ templates, templateItems, loading, refresh, createTemplate }),
    [templates, templateItems, loading, refresh, createTemplate]
  );

  return <ChecklistDataContext.Provider value={value}>{children}</ChecklistDataContext.Provider>;
}

export function useChecklists(): ChecklistDataContextValue {
  const ctx = useContext(ChecklistDataContext);
  if (!ctx) throw new Error('useChecklists must be used within ChecklistDataProvider');
  return ctx;
}
