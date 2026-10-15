"use client";

import { useActionState } from "react";
import { ROLES, isRole, type Role } from "@/lib/auth/authorization";
import {
  createUserAction,
  updateUserActiveAction,
  updateUserRoleAction,
  type UserActionState,
} from "./actions";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
};

type UserLabels = {
  createTitle: string;
  name: string;
  email: string;
  password: string;
  passwordHint: string;
  role: string;
  createUser: string;
  creating: string;
  usersTitle: string;
  status: string;
  active: string;
  disabled: string;
  saveRole: string;
  saving: string;
  disable: string;
  enable: string;
  errors: {
    invalidInput: string;
    userExists: string;
    userNotFound: string;
    lastAdministrator: string;
    cannotChangeSelf: string;
  };
  success: {
    userCreated: string;
    roleUpdated: string;
    accountUpdated: string;
  };
};

export function UserManagement({
  users,
  labels,
  roles,
  lang,
}: {
  users: UserRow[];
  labels: UserLabels;
  roles: Record<Role, string>;
  lang: string;
}) {
  return (
    <div className="space-y-8">
      <CreateUserForm labels={labels} roles={roles} lang={lang} />
      <section className="overflow-x-auto rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-4 text-lg font-semibold text-ink">
          {labels.usersTitle}
        </h2>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-canvas text-xs text-ink-muted">
            <tr>
              <th className="px-5 py-3 font-medium">{labels.name}</th>
              <th className="px-5 py-3 font-medium">{labels.email}</th>
              <th className="px-5 py-3 font-medium">{labels.role}</th>
              <th className="px-5 py-3 font-medium">{labels.status}</th>
              <th className="px-5 py-3 font-medium">{labels.saveRole}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <ManagedUserRow key={user.id} user={user} labels={labels} roles={roles} lang={lang} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function CreateUserForm({ labels, roles, lang }: { labels: UserLabels; roles: Record<Role, string>; lang: string }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(createUserAction, null);
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">{labels.createTitle}</h2>
      <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <Field label={labels.name} name="name" autoComplete="name" maxLength={120} />
        <Field label={labels.email} name="email" type="email" autoComplete="email" maxLength={254} />
        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-ink">{labels.password}</label>
          <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
          <p className="mt-1 text-xs text-ink-muted">{labels.passwordHint}</p>
        </div>
        <RoleSelect id="new-role" name="role" value="READ_ONLY_REVIEWER" label={labels.role} roles={roles} />
        <div className="md:col-span-2">
          <ActionFeedback state={state} labels={labels} />
          <button type="submit" disabled={pending} className="mt-3 rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {pending ? labels.creating : labels.createUser}
          </button>
        </div>
      </form>
    </section>
  );
}

function ManagedUserRow({
  user,
  labels,
  roles,
  lang,
}: {
  user: UserRow;
  labels: UserLabels;
  roles: Record<Role, string>;
  lang: string;
}) {
  const [roleState, roleAction, rolePending] = useActionState<UserActionState, FormData>(updateUserRoleAction, null);
  const [activeState, activeAction, activePending] = useActionState<UserActionState, FormData>(updateUserActiveAction, null);
  const role: Role = isRole(user.role) ? user.role : "READ_ONLY_REVIEWER";
  return (
    <tr>
      <td className="px-5 py-3 font-medium text-ink">{user.name}</td>
      <td className="px-5 py-3 text-ink-muted">{user.email}</td>
      <td className="px-5 py-3">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="userId" value={user.id} />
          <RoleSelect id={`role-${user.id}`} name="role" value={role} label={labels.role} roles={roles} />
          <button type="submit" disabled={rolePending} className="rounded border border-line px-2 py-1 text-xs text-ink disabled:opacity-60">
            {rolePending ? labels.saving : labels.saveRole}
          </button>
        </form>
        <ActionFeedback state={roleState} labels={labels} />
      </td>
      <td className="px-5 py-3 text-ink-muted">{user.isActive ? labels.active : labels.disabled}</td>
      <td className="px-5 py-3">
        <form action={activeAction}>
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="isActive" value={String(!user.isActive)} />
          <button type="submit" disabled={activePending} className="text-sm font-medium text-teal-strong underline disabled:opacity-60">
            {activePending ? labels.saving : user.isActive ? labels.disable : labels.enable}
          </button>
        </form>
        <ActionFeedback state={activeState} labels={labels} />
      </td>
    </tr>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  maxLength: number;
}) {
  return (
    <div>
      <label htmlFor={`new-${name}`} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input id={`new-${name}`} name={name} type={type} autoComplete={autoComplete} required maxLength={maxLength} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
    </div>
  );
}

function RoleSelect({
  id,
  name,
  value,
  label,
  roles,
}: {
  id: string;
  name: string;
  value: Role;
  label: string;
  roles: Record<Role, string>;
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select key={`${id}-${value}`} id={id} name={name} defaultValue={value} className="rounded-md border border-line bg-surface px-2 py-2 text-ink">
        {ROLES.map((item) => <option key={item} value={item}>{roles[item]}</option>)}
      </select>
    </div>
  );
}

function ActionFeedback({ state, labels }: { state: UserActionState; labels: UserLabels }) {
  if (!state) return null;
  if (state.error) {
    return <p role="alert" className="mt-2 text-xs text-red-700">{labels.errors[state.error]}</p>;
  }
  if (state.success) {
    return <p role="status" className="mt-2 text-xs text-green-800">{labels.success[state.success]}</p>;
  }
  return null;
}
