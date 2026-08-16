import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Organization, Profile, Role, Team } from '../types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  team: Team | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  createOrganization: (args: {
    orgName: string;
    ownerName: string;
    username: string;
    email: string;
    password: string;
  }) => Promise<void>;
  /** Sign in with Org ID + username + password — no email retyping. */
  signInWithUsername: (orgCode: string, username: string, password: string) => Promise<void>;
  /** Creates an account for someone else. Returns the new profile id. */
  adminCreateUser: (args: {
    name: string;
    username: string;
    password: string;
    role: 'employee' | 'team_admin';
    teamId: string | null;
    title?: string;
  }) => Promise<string>;
  adminResetPassword: (profileId: string, newPassword: string) => Promise<void>;
  adminSetUserActive: (profileId: string, active: boolean) => Promise<void>;
  /** Used by the forced-change screen; clears mustChangePassword on success. */
  changeOwnPassword: (newPassword: string) => Promise<void>;
  addRecoveryEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapProfile(row: {
  id: string;
  org_id: string;
  team_id: string | null;
  name: string;
  title: string | null;
  username: string | null;
  role: Role;
  must_change_password: boolean;
  active: boolean;
  recovery_email: string | null;
  created_at: string;
}): Profile {
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

function mapOrg(row: { id: string; org_code: string; name: string; owner_id: string; created_at: string }): Organization {
  return { id: row.id, orgCode: row.org_code, name: row.name, ownerId: row.owner_id, createdAt: row.created_at };
}

function mapTeam(row: { id: string; org_id: string; name: string; created_at: string }): Team {
  return { id: row.id, orgId: row.org_id, name: row.name, createdAt: row.created_at };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    profile: null,
    organization: null,
    team: null,
    loading: true,
    error: null,
  });

  const loadProfileAndOrg = async (session: Session | null) => {
    if (!session) {
      setState((s) => ({ ...s, session: null, profile: null, organization: null, team: null, loading: false }));
      return;
    }

    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError || !profileRow) {
      // Signed in but hasn't created/joined an org yet.
      setState((s) => ({ ...s, session, profile: null, organization: null, team: null, loading: false }));
      return;
    }

    const profile = mapProfile(profileRow);

    const [{ data: orgRow }, { data: teamRow }] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', profile.orgId).maybeSingle(),
      profile.teamId
        ? supabase.from('teams').select('*').eq('id', profile.teamId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setState((s) => ({
      ...s,
      session,
      profile,
      organization: orgRow ? mapOrg(orgRow) : null,
      team: teamRow ? mapTeam(teamRow) : null,
      loading: false,
    }));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => loadProfileAndOrg(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadProfileAndOrg(session);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfileAndOrg(data.session);
  };

  const clearError = () => setState((s) => ({ ...s, error: null }));

  const createOrganization: AuthContextValue['createOrganization'] = async ({ orgName, ownerName, username, email, password }) => {
    setState((s) => ({ ...s, error: null }));
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) throw signUpError;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error(
        'Account created, but no session yet — this Supabase project likely has "Confirm email" turned on. Disable it under Authentication > Providers > Email while testing.'
      );
    }

    const { error: rpcError } = await supabase.rpc('create_organization', {
      p_org_name: orgName,
      p_owner_name: ownerName,
      p_username: username,
    });
    if (rpcError) throw rpcError;

    await refreshProfile();
  };

  const adminCreateUser: AuthContextValue['adminCreateUser'] = async ({
    name,
    username,
    password,
    role,
    teamId,
    title,
  }) => {
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_name: name.trim(),
      p_username: username.trim(),
      p_password: password,
      p_role: role,
      p_team_id: teamId,
      p_title: title?.trim() || null,
    });
    if (error) throw error;
    return data as string;
  };

  const adminResetPassword: AuthContextValue['adminResetPassword'] = async (profileId, newPassword) => {
    const { error } = await supabase.rpc('admin_reset_password', {
      p_target_profile_id: profileId,
      p_new_password: newPassword,
    });
    if (error) throw error;
  };

  const adminSetUserActive: AuthContextValue['adminSetUserActive'] = async (profileId, active) => {
    const { error } = await supabase.rpc('admin_set_user_active', {
      p_target_profile_id: profileId,
      p_active: active,
    });
    if (error) throw error;
  };

  const changeOwnPassword: AuthContextValue['changeOwnPassword'] = async (newPassword) => {
    setState((s) => ({ ...s, error: null }));
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) throw updateError;

    const { error: rpcError } = await supabase.rpc('clear_must_change_password');
    if (rpcError) throw rpcError;

    await refreshProfile();
  };

  const addRecoveryEmail: AuthContextValue['addRecoveryEmail'] = async (email) => {
    const trimmed = email.trim();
    // Moves the auth email off the synthetic address so Supabase's built-in
    // password reset can reach a real mailbox.
    const { error: updateError } = await supabase.auth.updateUser({ email: trimmed });
    if (updateError) throw updateError;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ recovery_email: trimmed })
      .eq('id', state.profile?.id ?? '');
    if (profileError) throw profileError;

    await refreshProfile();
  };

  const signInWithUsername: AuthContextValue['signInWithUsername'] = async (orgCode, username, password) => {
    setState((s) => ({ ...s, error: null }));
    const { data: email, error: lookupError } = await supabase.rpc('get_login_email', {
      p_org_code: orgCode.trim().toUpperCase(),
      p_username: username.trim(),
    });
    if (lookupError) throw lookupError;
    if (!email) throw new Error('No account found with that Organization ID and username.');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      createOrganization,
      signInWithUsername,
      adminCreateUser,
      adminResetPassword,
      adminSetUserActive,
      changeOwnPassword,
      addRecoveryEmail,
      signOut,
      refreshProfile,
      clearError,
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
