import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Organization, Profile, Role, Team } from '../types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  /** Every team the signed-in profile belongs to. */
  teams: Team[];
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  /** A sign-up that has been started and is waiting on its emailed code. */
  pendingSignUp: PendingSignUp | null;
  /** Step 1 of org sign-up: creates the auth user and emails a confirmation
   *  code. The organization row is only written once the code is verified,
   *  because create_organization needs a real session to run under. */
  startOrganizationSignUp: (args: {
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
    role: 'employee' | 'team_admin' | 'owner';
    teamId: string | null;
    title?: string;
    brandId?: string | null;
  }) => Promise<string>;
  adminResetPassword: (profileId: string, newPassword: string) => Promise<void>;
  adminSetUserActive: (profileId: string, active: boolean) => Promise<void>;
  /** Owner-only, deactivated accounts only. Keeps their past audits. */
  adminDeleteUser: (profileId: string) => Promise<void>;
  /** Adds a further team on top of whatever the person already belongs to. */
  addProfileToTeam: (profileId: string, teamId: string, brandId?: string | null) => Promise<void>;
  removeProfileFromTeam: (profileId: string, teamId: string) => Promise<void>;
  /** Used by the forced-change screen; clears mustChangePassword on success. */
  changeOwnPassword: (newPassword: string) => Promise<void>;
  addRecoveryEmail: (email: string) => Promise<void>;
  /** Anyone: their own display name, company ID code and photo. */
  updateMyProfile: (name: string, employeeCode: string, avatarUrl: string | null) => Promise<void>;
  /** Owner-only: what one penalty point is worth in IQD from now on. */
  setIqdPerPoint: (rate: number) => Promise<void>;
  signOut: () => Promise<void>;
  /** Exchanges the emailed code for a session, then creates the organization. */
  verifySignUpCode: (code: string) => Promise<void>;
  resendSignUpCode: () => Promise<void>;
  cancelSignUp: () => void;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

/** Everything needed to finish a sign-up once its emailed code arrives.
 *  Held in memory only: navigating between auth screens keeps it, a full
 *  page reload deliberately starts over rather than resurrecting a form. */
export interface PendingSignUp {
  email: string;
  password: string;
  orgName: string;
  ownerName: string;
  username: string;
}

/** Digits in the emailed code. Must match the project's Auth OTP length
 *  (Supabase allows 6-10; the dashboard setting and this constant have to
 *  agree or the screen submits a half-typed code). */
export const SIGNUP_CODE_LENGTH = 6;

const AuthContext = createContext<AuthContextValue | null>(null);

function mapProfile(
  row: {
    id: string;
    org_id: string;
    name: string;
    title: string | null;
    username: string | null;
    role: Role;
    must_change_password: boolean;
    active: boolean;
    recovery_email: string | null;
    deleted_at?: string | null;
    avatar_url?: string | null;
    employee_code?: string | null;
    created_at: string;
  },
  teamIds: string[],
  teamBrandIds: Record<string, string | null>
): Profile {
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

function mapOrg(row: { id: string; org_code: string; name: string; owner_id: string; iqd_per_point: number; created_at: string }): Organization {
  return {
    id: row.id,
    orgCode: row.org_code,
    name: row.name,
    ownerId: row.owner_id,
    iqdPerPoint: Number(row.iqd_per_point),
    createdAt: row.created_at,
  };
}

function mapTeam(row: { id: string; org_id: string; name: string; created_at: string }): Team {
  return { id: row.id, orgId: row.org_id, name: row.name, createdAt: row.created_at };
}

/** Supabase will not admit that an email is already registered: signUp on a
 *  confirmed address succeeds, returns a decoy user with an empty identities
 *  array, and sends nothing. Turn that into an honest error instead of parking
 *  the person on a code screen no code will ever reach. */
function assertCodeWasSent(user: { identities?: unknown[] | null } | null) {
  if (user && Array.isArray(user.identities) && user.identities.length === 0) {
    throw new Error('That email already has an account. Sign in instead, or use a different email.');
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    profile: null,
    organization: null,
    teams: [],
    loading: true,
    error: null,
  });

  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);

  const loadProfileAndOrg = async (session: Session | null) => {
    if (!session) {
      setState((s) => ({ ...s, session: null, profile: null, organization: null, teams: [], loading: false }));
      return;
    }

    const [{ data: profileRow, error: profileError }, { data: membershipRows }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('profile_teams').select('team_id, brand_id').eq('profile_id', session.user.id),
    ]);

    if (profileError || !profileRow) {
      // Signed in but hasn't created/joined an org yet.
      setState((s) => ({ ...s, session, profile: null, organization: null, teams: [], loading: false }));
      return;
    }

    const teamIds = (membershipRows ?? []).map((r) => r.team_id as string);
    const teamBrandIds = Object.fromEntries(
      (membershipRows ?? []).map((r) => [r.team_id as string, (r as { brand_id: string | null }).brand_id])
    );
    const profile = mapProfile(profileRow, teamIds, teamBrandIds);

    const [{ data: orgRow }, { data: teamRows }] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', profile.orgId).maybeSingle(),
      teamIds.length > 0
        ? supabase.from('teams').select('*').in('id', teamIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    setState((s) => ({
      ...s,
      session,
      profile,
      organization: orgRow ? mapOrg(orgRow) : null,
      teams: (teamRows ?? []).map(mapTeam),
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

  const startOrganizationSignUp: AuthContextValue['startOrganizationSignUp'] = async ({
    orgName,
    ownerName,
    username,
    email,
    password,
  }) => {
    setState((s) => ({ ...s, error: null }));
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password });
    if (error) throw error;
    assertCodeWasSent(data.user);
    setPendingSignUp({ email: normalizedEmail, password, orgName, ownerName, username });
  };

  const verifySignUpCode: AuthContextValue['verifySignUpCode'] = async (code) => {
    if (!pendingSignUp) throw new Error('That sign-up expired. Please start again.');
    setState((s) => ({ ...s, error: null }));

    const { data, error } = await supabase.auth.verifyOtp({
      email: pendingSignUp.email,
      token: code.trim(),
      type: 'signup',
    });

    if (error || !data.session) {
      // The OTP check itself can succeed server-side (the email is marked
      // confirmed) while session issuance still fails right after — seen live
      // as a transient "JWT issued at future" error. Retyping the same code
      // then correctly reads as invalid, since it was already consumed, which
      // would otherwise strand a confirmed account with no session and no
      // organization. A plain password sign-in recovers it, since the email
      // is confirmed by this point either way.
      const fallback = await supabase.auth.signInWithPassword({
        email: pendingSignUp.email,
        password: pendingSignUp.password,
      });
      if (fallback.error || !fallback.data.session) throw error ?? new Error('The code was accepted but no session came back. Please sign in.');
    }

    // Only now is there a session for create_organization's auth.uid() to use.
    const { error: rpcError } = await supabase.rpc('create_organization', {
      p_org_name: pendingSignUp.orgName,
      p_owner_name: pendingSignUp.ownerName,
      p_username: pendingSignUp.username,
    });
    if (rpcError) throw rpcError;

    setPendingSignUp(null);
    await refreshProfile();
  };

  const resendSignUpCode: AuthContextValue['resendSignUpCode'] = async () => {
    if (!pendingSignUp) throw new Error('That sign-up expired. Please start again.');
    const { error } = await supabase.auth.resend({ type: 'signup', email: pendingSignUp.email });
    if (error) throw error;
  };

  const cancelSignUp: AuthContextValue['cancelSignUp'] = () => setPendingSignUp(null);

  const adminCreateUser: AuthContextValue['adminCreateUser'] = async ({
    name,
    username,
    password,
    role,
    teamId,
    title,
    brandId,
  }) => {
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_name: name.trim(),
      p_username: username.trim(),
      p_password: password,
      p_role: role,
      p_team_id: teamId,
      p_title: title?.trim() || null,
      p_brand_id: brandId ?? null,
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

  const adminDeleteUser: AuthContextValue['adminDeleteUser'] = async (profileId) => {
    const { error } = await supabase.rpc('admin_delete_user', { p_target_profile_id: profileId });
    if (error) throw error;
  };

  const adminSetUserActive: AuthContextValue['adminSetUserActive'] = async (profileId, active) => {
    const { error } = await supabase.rpc('admin_set_user_active', {
      p_target_profile_id: profileId,
      p_active: active,
    });
    if (error) throw error;
  };

  const addProfileToTeam: AuthContextValue['addProfileToTeam'] = async (profileId, teamId, brandId) => {
    const { error } = await supabase.rpc('add_profile_to_team', {
      p_profile_id: profileId,
      p_team_id: teamId,
      p_brand_id: brandId ?? null,
    });
    if (error) throw error;
    if (profileId === state.profile?.id) await refreshProfile();
  };

  const removeProfileFromTeam: AuthContextValue['removeProfileFromTeam'] = async (profileId, teamId) => {
    const { error } = await supabase.rpc('remove_profile_from_team', { p_profile_id: profileId, p_team_id: teamId });
    if (error) throw error;
    if (profileId === state.profile?.id) await refreshProfile();
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

  const updateMyProfile: AuthContextValue['updateMyProfile'] = async (name, employeeCode, avatarUrl) => {
    const { error } = await supabase.rpc('update_my_profile', {
      p_name: name,
      p_employee_code: employeeCode,
      p_avatar_url: avatarUrl ?? '',
    });
    if (error) throw error;
    await refreshProfile();
  };

  const setIqdPerPoint: AuthContextValue['setIqdPerPoint'] = async (rate) => {
    const { error } = await supabase.rpc('set_iqd_per_point', { p_rate: rate });
    if (error) throw error;
    setState((s) => (s.organization ? { ...s, organization: { ...s.organization, iqdPerPoint: rate } } : s));
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
      pendingSignUp,
      startOrganizationSignUp,
      verifySignUpCode,
      resendSignUpCode,
      cancelSignUp,
      signInWithUsername,
      adminCreateUser,
      adminResetPassword,
      adminSetUserActive,
      adminDeleteUser,
      addProfileToTeam,
      removeProfileFromTeam,
      changeOwnPassword,
      addRecoveryEmail,
      setIqdPerPoint,
      updateMyProfile,
      signOut,
      refreshProfile,
      clearError,
    }),
    [state, pendingSignUp]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
