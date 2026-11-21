import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconArchive,
  IconArchiveOff,
  IconCheck,
  IconTrash,
  IconUserMinus,
  IconUserPlus,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { TeamId, UserId } from '@/shared/kernel';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui';
import type {
  CreateTeamInput,
  TeamDetails,
  UpdateTeamInput,
} from '../application/use-cases/team-service';

const teamFormSchema = z.object({
  name: z.string().trim().min(2, 'validation.displayNameMin').max(120),
  description: z.string().trim().max(500).optional(),
});

export type TeamFormValues = z.infer<typeof teamFormSchema>;

export interface TeamPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface TeamListItemSummary {
  readonly id: TeamId;
  readonly name: string;
  readonly description?: string;
  readonly isArchived: boolean;
  readonly managerCount: number;
}

export interface TeamsPanelProps {
  readonly organizationName: string;
  readonly teams: readonly TeamListItemSummary[];
  readonly selectedTeamId: TeamId | null;
  readonly selectedTeamDetails: TeamDetails | null;
  readonly organizationMembers: readonly OrganizationMemberDetails[];
  readonly includeArchived: boolean;
  readonly isLoadingTeams: boolean;
  readonly isLoadingDetails: boolean;
  readonly canCreateTeam: boolean;
  readonly canUpdateSelectedTeam: boolean;
  readonly canArchiveSelectedTeam: boolean;
  readonly canDeleteSelectedTeam: boolean;
  readonly canManageSelectedTeamMembers: boolean;
  readonly feedback?: TeamPanelFeedback | null;
  readonly onToggleIncludeArchived: (next: boolean) => void;
  readonly onSelectTeam: (teamId: TeamId) => void;
  readonly onCreateTeam: (input: CreateTeamInput) => Promise<void>;
  readonly onUpdateTeam: (teamId: TeamId, input: UpdateTeamInput) => Promise<void>;
  readonly onArchiveTeam: (teamId: TeamId, name: string) => Promise<void>;
  readonly onRestoreTeam: (teamId: TeamId, name: string) => Promise<void>;
  readonly onDeleteTeam: (teamId: TeamId, name: string, reason?: string) => Promise<void>;
  readonly onAddTeamMember: (teamId: TeamId, targetUserId: UserId) => Promise<void>;
  readonly onRemoveTeamMember: (teamId: TeamId, targetUserId: UserId) => Promise<void>;
}

export function TeamsPanel({
  organizationName,
  teams,
  selectedTeamId,
  selectedTeamDetails,
  organizationMembers,
  includeArchived,
  isLoadingTeams,
  isLoadingDetails,
  canCreateTeam,
  canUpdateSelectedTeam,
  canArchiveSelectedTeam,
  canDeleteSelectedTeam,
  canManageSelectedTeamMembers,
  feedback = null,
  onToggleIncludeArchived,
  onSelectTeam,
  onCreateTeam,
  onUpdateTeam,
  onArchiveTeam,
  onRestoreTeam,
  onDeleteTeam,
  onAddTeamMember,
  onRemoveTeamMember,
}: TeamsPanelProps) {
  const intl = useIntl();
  const [selectedAddUserId, setSelectedAddUserId] = useState<string>('');
  const [isMutatingTeam, setIsMutatingTeam] = useState(false);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<UserId | null>(null);

  const createForm = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: { name: '', description: '' },
  });

  const editForm = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: selectedTeamDetails?.team.name ?? '',
      description: selectedTeamDetails?.team.description ?? '',
    },
  });

  useEffect(() => {
    editForm.reset({
      name: selectedTeamDetails?.team.name ?? '',
      description: selectedTeamDetails?.team.description ?? '',
    });
  }, [editForm, selectedTeamDetails?.team.description, selectedTeamDetails?.team.name]);

  const handleCreateSubmit = async (values: TeamFormValues) => {
    await onCreateTeam({
      name: values.name,
      ...(values.description !== undefined && values.description.trim().length > 0
        ? { description: values.description.trim() }
        : {}),
    });
    createForm.reset({ name: '', description: '' });
  };

  const handleUpdateSubmit = async (values: TeamFormValues) => {
    if (selectedTeamDetails === null) {
      return;
    }
    await onUpdateTeam(selectedTeamDetails.team.id, {
      name: values.name,
      description:
        values.description !== undefined && values.description.trim().length > 0
          ? values.description.trim()
          : null,
    });
  };

  const handleAddMember = async () => {
    if (selectedTeamDetails === null || selectedAddUserId === '') {
      return;
    }
    const memberCandidate = organizationMembers.find((m) => m.userId === selectedAddUserId);
    if (memberCandidate === undefined) {
      return;
    }
    setIsMutatingTeam(true);
    try {
      await onAddTeamMember(selectedTeamDetails.team.id, memberCandidate.userId);
      setSelectedAddUserId('');
    } finally {
      setIsMutatingTeam(false);
    }
  };

  const handleConfirmRemoveMember = async (targetUserId: UserId) => {
    if (selectedTeamDetails === null) {
      return;
    }
    setIsMutatingTeam(true);
    try {
      await onRemoveTeamMember(selectedTeamDetails.team.id, targetUserId);
      setConfirmRemoveMemberId(null);
    } finally {
      setIsMutatingTeam(false);
    }
  };

  const handleConfirmDeleteTeam = async () => {
    if (selectedTeamDetails === null) {
      return;
    }
    setIsMutatingTeam(true);
    try {
      await onDeleteTeam(
        selectedTeamDetails.team.id,
        selectedTeamDetails.team.name,
        deleteReason.trim() || undefined,
      );
      setConfirmDeleteTeam(false);
      setDeleteReason('');
    } finally {
      setIsMutatingTeam(false);
    }
  };

  const activeMemberIds = new Set(
    selectedTeamDetails?.members.map((member) => member.userId) ?? [],
  );
  const availableOrgMembersToAdd = organizationMembers.filter(
    (member) => member.status === 'ACTIVE' && !activeMemberIds.has(member.userId),
  );

  const selectedTeamIsArchived = selectedTeamDetails?.team.archivedAt !== undefined;

  return (
    <section aria-labelledby="teams-heading" className="mx-auto w-full max-w-5xl space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            id="teams-heading"
            className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            {intl.formatMessage({ id: 'teams.title' })}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
        </div>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'teams.subtitle' })}
        </p>
      </div>

      {feedback !== null ? (
        <Alert variant={feedback.type}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          id="teams-include-archived"
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => onToggleIncludeArchived(event.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <label
          htmlFor="teams-include-archived"
          className="cursor-pointer text-sm font-medium text-foreground"
        >
          Incluir arquivadas
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          {isLoadingTeams ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'app.loading' })}
            </p>
          ) : teams.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{intl.formatMessage({ id: 'teams.emptyTitle' })}</CardTitle>
                <CardDescription>
                  {intl.formatMessage({ id: 'teams.emptyDescription' })}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="space-y-3">
              {teams.map((team) => {
                const isSelected = team.id === selectedTeamId;
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteTeam(false);
                        setConfirmRemoveMemberId(null);
                        onSelectTeam(team.id);
                      }}
                      className={`w-full rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                          : 'bg-card hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{team.name}</span>
                        <Badge variant={team.isArchived ? 'outline' : 'default'}>
                          {intl.formatMessage({
                            id: team.isArchived ? 'teams.status.ARCHIVED' : 'teams.status.ACTIVE',
                          })}
                        </Badge>
                      </div>
                      {team.description !== undefined ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {team.description}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {canCreateTeam ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {intl.formatMessage({ id: 'teams.create.title' })}
                </CardTitle>
                <CardDescription>
                  {intl.formatMessage({ id: 'teams.create.description' })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={createForm.handleSubmit(handleCreateSubmit)}
                  noValidate
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="create-team-name" required>
                      {intl.formatMessage({ id: 'teams.create.nameLabel' })}
                    </Label>
                    <Input
                      id="create-team-name"
                      type="text"
                      placeholder={intl.formatMessage({ id: 'teams.create.namePlaceholder' })}
                      aria-invalid={createForm.formState.errors.name !== undefined}
                      aria-describedby={
                        createForm.formState.errors.name !== undefined
                          ? 'create-team-name-error'
                          : undefined
                      }
                      {...createForm.register('name')}
                    />
                    {createForm.formState.errors.name !== undefined ? (
                      <p
                        id="create-team-name-error"
                        role="alert"
                        className="text-xs font-medium text-destructive"
                      >
                        {intl.formatMessage({ id: 'validation.displayNameMin' })}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="create-team-description">
                      {intl.formatMessage({ id: 'teams.create.descriptionLabel' })}
                    </Label>
                    <Input
                      id="create-team-description"
                      type="text"
                      placeholder={intl.formatMessage({
                        id: 'teams.create.descriptionPlaceholder',
                      })}
                      {...createForm.register('description')}
                    />
                  </div>

                  <Button type="submit" disabled={createForm.formState.isSubmitting}>
                    <IconUsersGroup className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {intl.formatMessage({
                        id: createForm.formState.isSubmitting
                          ? 'auth.common.submitting'
                          : 'teams.create.submit',
                      })}
                    </span>
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6 lg:col-span-7">
          {selectedTeamId === null ? null : isLoadingDetails || selectedTeamDetails === null ? (
            <Card>
              <CardContent className="py-8">
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'app.loading' })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{selectedTeamDetails.team.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {intl.formatMessage(
                          { id: 'teams.activeProjectsCountLabel' },
                          { count: selectedTeamDetails.activeProjectCount },
                        )}
                      </Badge>
                      <Badge variant={selectedTeamIsArchived ? 'outline' : 'default'}>
                        {intl.formatMessage({
                          id: selectedTeamIsArchived
                            ? 'teams.status.ARCHIVED'
                            : 'teams.status.ACTIVE',
                        })}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {canUpdateSelectedTeam && !selectedTeamIsArchived ? (
                    <form
                      onSubmit={editForm.handleSubmit(handleUpdateSubmit)}
                      noValidate
                      className="space-y-4"
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-team-name" required>
                          {intl.formatMessage({ id: 'teams.create.nameLabel' })}
                        </Label>
                        <Input
                          id="edit-team-name"
                          type="text"
                          aria-invalid={editForm.formState.errors.name !== undefined}
                          aria-describedby={
                            editForm.formState.errors.name !== undefined
                              ? 'edit-team-name-error'
                              : undefined
                          }
                          {...editForm.register('name')}
                        />
                        {editForm.formState.errors.name !== undefined ? (
                          <p
                            id="edit-team-name-error"
                            role="alert"
                            className="text-xs font-medium text-destructive"
                          >
                            {intl.formatMessage({ id: 'validation.displayNameMin' })}
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="edit-team-description">
                          {intl.formatMessage({ id: 'teams.create.descriptionLabel' })}
                        </Label>
                        <Input
                          id="edit-team-description"
                          type="text"
                          {...editForm.register('description')}
                        />
                      </div>

                      <Button type="submit" disabled={editForm.formState.isSubmitting}>
                        <IconCheck className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'teams.edit.saveAction' })}</span>
                      </Button>
                    </form>
                  ) : selectedTeamDetails.team.description !== undefined ? (
                    <p className="text-sm text-muted-foreground">
                      {selectedTeamDetails.team.description}
                    </p>
                  ) : null}

                  <div className="space-y-3 border-t pt-4">
                    {canDeleteSelectedTeam && selectedTeamDetails.activeProjectCount > 0 ? (
                      <Alert variant="warning" role="status">
                        <AlertDescription>
                          {intl.formatMessage({ id: 'teams.deleteBlockedByActiveProjectsHint' })}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      {canArchiveSelectedTeam ? (
                        selectedTeamIsArchived ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isMutatingTeam}
                            onClick={() =>
                              void onRestoreTeam(
                                selectedTeamDetails.team.id,
                                selectedTeamDetails.team.name,
                              )
                            }
                          >
                            <IconArchiveOff className="h-4 w-4" aria-hidden="true" />
                            <span>{intl.formatMessage({ id: 'teams.restoreAction' })}</span>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isMutatingTeam}
                            onClick={() =>
                              void onArchiveTeam(
                                selectedTeamDetails.team.id,
                                selectedTeamDetails.team.name,
                              )
                            }
                          >
                            <IconArchive className="h-4 w-4" aria-hidden="true" />
                            <span>{intl.formatMessage({ id: 'teams.archiveAction' })}</span>
                          </Button>
                        )
                      ) : null}

                      {canDeleteSelectedTeam && !confirmDeleteTeam ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={isMutatingTeam}
                          onClick={() => setConfirmDeleteTeam(true)}
                        >
                          <IconTrash className="h-4 w-4" aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'teams.deleteAction' })}</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {confirmDeleteTeam ? (
                    <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <p className="text-xs text-foreground">
                        {intl.formatMessage({ id: 'teams.deleteConfirmHint' })}
                      </p>
                      <div className="space-y-1.5">
                        <Label htmlFor="delete-team-reason">Motivo da exclusão (opcional)</Label>
                        <Input
                          id="delete-team-reason"
                          type="text"
                          value={deleteReason}
                          onChange={(event) => setDeleteReason(event.target.value)}
                          placeholder="Ex.: Reestruturação interna da área"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={isMutatingTeam}
                          onClick={() => void handleConfirmDeleteTeam()}
                        >
                          {intl.formatMessage({ id: 'teams.deleteAction' })}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isMutatingTeam}
                          onClick={() => setConfirmDeleteTeam(false)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {intl.formatMessage({ id: 'teams.members.title' })}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                  {canManageSelectedTeamMembers && !selectedTeamIsArchived ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="add-team-member-select">
                          {intl.formatMessage({ id: 'teams.members.addLabel' })}
                        </Label>
                        <select
                          id="add-team-member-select"
                          value={selectedAddUserId}
                          onChange={(event) => setSelectedAddUserId(event.target.value)}
                          className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <option value="">
                            {intl.formatMessage({ id: 'teams.members.addPlaceholder' })}
                          </option>
                          {availableOrgMembersToAdd.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.displayName} ({member.email})
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        type="button"
                        disabled={isMutatingTeam || selectedAddUserId === ''}
                        onClick={() => void handleAddMember()}
                      >
                        <IconUserPlus className="h-4 w-4" aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'teams.members.addAction' })}</span>
                      </Button>
                    </div>
                  ) : null}

                  {selectedTeamDetails.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {intl.formatMessage({ id: 'teams.members.empty' })}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {selectedTeamDetails.members.map((member) => {
                        const isConfirmingRemove = confirmRemoveMemberId === member.userId;

                        return (
                          <li key={member.id} className="space-y-2 rounded-lg border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-foreground">
                                    {member.displayName}
                                  </span>
                                  <Badge variant={member.isManager ? 'default' : 'secondary'}>
                                    {intl.formatMessage({
                                      id: member.isManager
                                        ? 'teams.members.managerBadge'
                                        : 'teams.members.memberBadge',
                                    })}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{member.email}</p>
                              </div>

                              {canManageSelectedTeamMembers &&
                              !selectedTeamIsArchived &&
                              !isConfirmingRemove ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isMutatingTeam}
                                  onClick={() => setConfirmRemoveMemberId(member.userId)}
                                >
                                  <IconUserMinus className="h-4 w-4" aria-hidden="true" />
                                  <span>
                                    {intl.formatMessage({ id: 'teams.members.removeAction' })}
                                  </span>
                                </Button>
                              ) : null}
                            </div>

                            {isConfirmingRemove ? (
                              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                                <p className="text-xs text-foreground">
                                  {intl.formatMessage({ id: 'teams.members.removeHint' })}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={isMutatingTeam}
                                    onClick={() => void handleConfirmRemoveMember(member.userId)}
                                  >
                                    {intl.formatMessage({ id: 'teams.members.removeAction' })}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={isMutatingTeam}
                                    onClick={() => setConfirmRemoveMemberId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
