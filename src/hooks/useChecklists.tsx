import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type {
  ChecklistAnswer,
  ChecklistAssignment,
  ChecklistItemDraft,
  ChecklistSectionPhoto,
  ChecklistSubmission,
  ChecklistTemplate,
  ChecklistTemplateItem,
} from '../types';

function mapTemplate(row: any): ChecklistTemplate {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    cooldownHours: row.cooldown_hours,
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

function mapAssignment(row: any): ChecklistAssignment {
  return {
    id: row.id,
    templateId: row.template_id,
    orgId: row.org_id,
    teamId: row.team_id,
    assigneeId: row.assignee_id,
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapSubmission(row: any): ChecklistSubmission {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    orgId: row.org_id,
    teamId: row.team_id,
    templateName: row.template_name,
    actorId: row.actor_id,
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

function mapAnswer(row: any): ChecklistAnswer {
  return {
    id: row.id,
    submissionId: row.submission_id,
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
    submissionId: row.submission_id,
    sectionTitle: row.section_title,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
}

interface SubmitAnswerInput {
  sectionTitle: string;
  question: string;
  sortOrder: number;
  answer: boolean;
  note?: string;
}

interface SubmitPhotoInput {
  sectionTitle: string;
  photoUrl: string;
}

interface ChecklistDataContextValue {
  templates: ChecklistTemplate[];
  templateItems: ChecklistTemplateItem[];
  assignments: ChecklistAssignment[];
  submissions: ChecklistSubmission[];
  loading: boolean;
  refresh: () => Promise<void>;
  createTemplate: (
    name: string,
    cooldownHours: number,
    requiresNoteOnNo: boolean,
    items: ChecklistItemDraft[]
  ) => Promise<string>;
  assignChecklist: (templateId: string, assigneeId: string) => Promise<void>;
  unassignChecklist: (assignmentId: string) => Promise<void>;
  submitChecklist: (assignmentId: string, answers: SubmitAnswerInput[], sectionPhotos: SubmitPhotoInput[]) => Promise<string>;
  declareOffDuty: (assignmentId: string, reason: string) => Promise<void>;
  reviewOffDuty: (submissionId: string, approve: boolean, reviewNote?: string) => Promise<void>;
  loadSubmissionDetail: (submissionId: string) => Promise<{ answers: ChecklistAnswer[]; photos: ChecklistSectionPhoto[] }>;
}

const ChecklistDataContext = createContext<ChecklistDataContextValue | null>(null);

export function ChecklistDataProvider({ children }: { children: ReactNode }) {
  const { profile, organization } = useAuth();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [templateItems, setTemplateItems] = useState<ChecklistTemplateItem[]>([]);
  const [assignments, setAssignments] = useState<ChecklistAssignment[]>([]);
  const [submissions, setSubmissions] = useState<ChecklistSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile || !organization) {
      setTemplates([]);
      setTemplateItems([]);
      setAssignments([]);
      setSubmissions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [templatesRes, assignmentsRes, submissionsRes] = await Promise.all([
      supabase.from('checklist_templates').select('*').eq('archived', false).order('created_at', { ascending: true }),
      supabase.from('checklist_assignments').select('*').eq('active', true),
      // Snapshots (template_name, yes/no counts) live on the row itself, so
      // the list view never needs to join back to templates or items.
      supabase.from('checklist_submissions').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    const templateRows = templatesRes.data ?? [];
    if (!templatesRes.error) setTemplates(templateRows.map(mapTemplate));

    if (templateRows.length > 0) {
      const { data: itemRows, error: itemsError } = await supabase
        .from('checklist_template_items')
        .select('*')
        .in('template_id', templateRows.map((t) => t.id))
        .order('sort_order', { ascending: true });
      if (!itemsError) setTemplateItems((itemRows ?? []).map(mapItem));
    } else {
      setTemplateItems([]);
    }

    if (!assignmentsRes.error) setAssignments((assignmentsRes.data ?? []).map(mapAssignment));
    if (!submissionsRes.error) setSubmissions((submissionsRes.data ?? []).map(mapSubmission));
    setLoading(false);
  }, [profile, organization]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTemplate = useCallback<ChecklistDataContextValue['createTemplate']>(
    async (name, cooldownHours, requiresNoteOnNo, items) => {
      const { data, error } = await supabase.rpc('create_checklist_template', {
        p_name: name,
        p_cooldown_hours: cooldownHours,
        p_requires_note_on_no: requiresNoteOnNo,
        p_items: items.map((it) => ({ section_title: it.sectionTitle, question: it.question })),
      });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [refresh]
  );

  const assignChecklist = useCallback<ChecklistDataContextValue['assignChecklist']>(
    async (templateId, assigneeId) => {
      const { error } = await supabase.rpc('assign_checklist', {
        p_template_id: templateId,
        p_assignee_id: assigneeId,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const unassignChecklist = useCallback<ChecklistDataContextValue['unassignChecklist']>(
    async (assignmentId) => {
      const { error } = await supabase.rpc('unassign_checklist', { p_assignment_id: assignmentId });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const submitChecklist = useCallback<ChecklistDataContextValue['submitChecklist']>(
    async (assignmentId, answers, sectionPhotos) => {
      const { data, error } = await supabase.rpc('submit_checklist', {
        p_assignment_id: assignmentId,
        p_answers: answers.map((a) => ({
          section_title: a.sectionTitle,
          question: a.question,
          sort_order: a.sortOrder,
          answer: a.answer,
          note: a.note ?? null,
        })),
        p_section_photos: sectionPhotos.map((p) => ({ section_title: p.sectionTitle, photo_url: p.photoUrl })),
      });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [refresh]
  );

  const declareOffDuty = useCallback<ChecklistDataContextValue['declareOffDuty']>(
    async (assignmentId, reason) => {
      const { error } = await supabase.rpc('declare_checklist_off_duty', {
        p_assignment_id: assignmentId,
        p_reason: reason,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const reviewOffDuty = useCallback<ChecklistDataContextValue['reviewOffDuty']>(
    async (submissionId, approve, reviewNote) => {
      const { error } = await supabase.rpc('review_checklist_off_duty', {
        p_submission_id: submissionId,
        p_approve: approve,
        p_review_note: reviewNote ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const loadSubmissionDetail = useCallback<ChecklistDataContextValue['loadSubmissionDetail']>(async (submissionId) => {
    const [answersRes, photosRes] = await Promise.all([
      supabase.from('checklist_answers').select('*').eq('submission_id', submissionId).order('sort_order', { ascending: true }),
      supabase.from('checklist_section_photos').select('*').eq('submission_id', submissionId),
    ]);
    if (answersRes.error) throw answersRes.error;
    if (photosRes.error) throw photosRes.error;
    return {
      answers: (answersRes.data ?? []).map(mapAnswer),
      photos: (photosRes.data ?? []).map(mapPhoto),
    };
  }, []);

  const value = useMemo<ChecklistDataContextValue>(
    () => ({
      templates,
      templateItems,
      assignments,
      submissions,
      loading,
      refresh,
      createTemplate,
      assignChecklist,
      unassignChecklist,
      submitChecklist,
      declareOffDuty,
      reviewOffDuty,
      loadSubmissionDetail,
    }),
    [
      templates,
      templateItems,
      assignments,
      submissions,
      loading,
      refresh,
      createTemplate,
      assignChecklist,
      unassignChecklist,
      submitChecklist,
      declareOffDuty,
      reviewOffDuty,
      loadSubmissionDetail,
    ]
  );

  return <ChecklistDataContext.Provider value={value}>{children}</ChecklistDataContext.Provider>;
}

export function useChecklists(): ChecklistDataContextValue {
  const ctx = useContext(ChecklistDataContext);
  if (!ctx) throw new Error('useChecklists must be used within ChecklistDataProvider');
  return ctx;
}
