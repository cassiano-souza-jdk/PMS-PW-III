import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconArchive,
  IconArchiveOff,
  IconArrowsExchange,
  IconCheck,
  IconDownload,
  IconFolderPlus,
  IconLayoutKanban,
  IconListCheck,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Link } from 'react-router';
import { z } from 'zod';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { MessageId } from '@/shared/i18n';
import {
  asTeamId,
  asUserId,
  type OrganizationRole,
  type ProjectId,
  type TeamId,
  type UserId,
} from '@/shared/kernel';
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
  CreateProjectInput,
  ProjectDetails,
  ProjectListItem,
  ProjectParticipantDetails,
  TransferProjectTeamInput,
  UpdateProjectInput,
} from '../application/use-cases/project-service';
import { ProjectParticipantsPanel } from './project-participants-panel';

type ProjectMemberRole = ProjectParticipantDetails['projectRole'];

const ROLE_LABEL_ID_BY_CODE: Record<OrganizationRole, MessageId> = {
  ADMIN: 'roles.ADMIN',
  MANAGER: 'roles.MANAGER',
  MEMBER: 'roles.MEMBER',
};

const VALIDATION_MESSAGE_IDS: Readonly<Record<string, MessageId>> = {
  'validation.displayNameMin': 'validation.displayNameMin',
  'validation.required': 'validation.required',
  'errors.VALIDATION_ERROR': 'errors.VALIDATION_ERROR',
};

function resolveValidationMessageId(code: string | undefined): MessageId {
  if (code !== undefined && code in VALIDATION_MESSAGE_IDS) {
    return VALIDATION_MESSAGE_IDS[code] ?? 'errors.VALIDATION_ERROR';
  }
  return 'errors.VALIDATION_ERROR';
}

const createProjectFormSchema = z.object({
  name: z.string().trim().min(2, 'validation.displayNameMin').max(120),
  description: z.string().trim().max(500).optional(),
  teamId: z.string().optional(),
  ownerUserId: z.string().optional(),
  inactivityThresholdDays: z.coerce
    .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
    .int('errors.VALIDATION_ERROR')
    .min(1, 'errors.VALIDATION_ERROR'),
});

const editProjectFormSchema = z.object({
  name: z.string().trim().min(2, 'validation.displayNameMin').max(120),
  description: z.string().trim().max(500).optional(),
  ownerUserId: z.string().min(1, 'validation.required'),
  inactivityThresholdDays: z.coerce
    .number({ invalid_type_error: 'errors.VALIDATION_ERROR' })
    .int('errors.VALIDATION_ERROR')
    .min(1, 'errors.VALIDATION_ERROR'),
});

type CreateProjectFormValues = z.infer<typeof createProjectFormSchema>;
type EditProjectFormValues = z.infer<typeof editProjectFormSchema>;

export interface ProjectTeamScopeOption {
  readonly id: TeamId;
  readonly name: string;
}

export interface ProjectPanelFeedback {
  readonly type: 'success' | 'destructive';
  readonly message: string;
}

export interface ProjectsPanelProps {
  readonly organizationName: string;
  readonly actorRole: OrganizationRole;
  readonly actorUserId: UserId;
  readonly projects: readonly ProjectListItem[];
  readonly selectedProjectId: ProjectId | null;
  readonly selectedProjectDetails: ProjectDetails | null;
  readonly creatableTeamScopes: readonly ProjectTeamScopeOption[];
  readonly transferableTeamScopes: readonly ProjectTeamScopeOption[];
  readonly organizationMembers: readonly OrganizationMemberDetails[];
  readonly includeArchived: boolean;
  readonly isLoadingProjects: boolean;
  readonly isLoadingDetails: boolean;
  readonly canCreateProject: boolean;
  readonly canUpdateSelectedProject: boolean;
  readonly canTransferSelectedProject: boolean;
  readonly canUnlinkTeam: boolean;
  readonly canArchiveSelectedProject: boolean;
  readonly canRestoreSelectedProject: boolean;
  readonly canDeleteSelectedProject: boolean;
  readonly canManageSelectedProjectMembers: boolean;
  readonly canOpenSelectedProjectBoard: boolean;
  readonly canOpenBoardByProjectId: Readonly<Record<string, boolean>>;
  readonly feedback?: ProjectPanelFeedback | null;
  readonly onToggleIncludeArchived: (next: boolean) => void;
  readonly onSelectProject: (projectId: ProjectId) => void;
  readonly onOpenBoard: (projectId: ProjectId) => void;
  readonly onCreateProject: (input: CreateProjectInput) => Promise<void>;
  readonly onUpdateProject: (projectId: ProjectId, input: UpdateProjectInput) => Promise<void>;
  readonly onTransferProjectTeam: (
    projectId: ProjectId,
    input: TransferProjectTeamInput,
  ) => Promise<void>;
  readonly onArchiveProject: (projectId: ProjectId, name: string) => Promise<void>;
  readonly onRestoreProject: (projectId: ProjectId, name: string) => Promise<void>;
  readonly onDeleteProject: (projectId: ProjectId, name: string, reason?: string) => Promise<void>;
  readonly onExportProject: (projectId: ProjectId, name: string) => Promise<void>;
  readonly onAddParticipant: (
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
  ) => Promise<void>;
  readonly onUpdateParticipantRole: (
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
  ) => Promise<void>;
  readonly onRemoveParticipant: (
    projectId: ProjectId,
    targetUserId: UserId,
    reason?: string,
  ) => Promise<void>;
}

interface SelectedProjectDetailsViewProps {
  readonly details: ProjectDetails;
  readonly activeOrgMembers: readonly OrganizationMemberDetails[];
  readonly transferableTeamScopes: readonly ProjectTeamScopeOption[];
  readonly canUpdateSelectedProject: boolean;
  readonly canTransferSelectedProject: boolean;
  readonly canUnlinkTeam: boolean;
  readonly canArchiveSelectedProject: boolean;
  readonly canRestoreSelectedProject: boolean;
  readonly canDeleteSelectedProject: boolean;
  readonly canManageSelectedProjectMembers: boolean;
  readonly canOpenSelectedProjectBoard: boolean;
  readonly isMutatingProject: boolean;
  readonly onOpenBoard: (projectId: ProjectId) => void;
  readonly onUpdateProject: (projectId: ProjectId, input: UpdateProjectInput) => Promise<void>;
  readonly onTransferProjectTeam: (
    projectId: ProjectId,
    input: TransferProjectTeamInput,
  ) => Promise<void>;
  readonly onArchiveProject: (projectId: ProjectId, name: string) => Promise<void>;
  readonly onRestoreProject: (projectId: ProjectId, name: string) => Promise<void>;
  readonly onDeleteProject: (projectId: ProjectId, name: string, reason?: string) => Promise<void>;
  readonly onExportProject: (projectId: ProjectId, name: string) => Promise<void>;
  readonly onAddParticipant: (
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
  ) => Promise<void>;
  readonly onUpdateParticipantRole: (
    projectId: ProjectId,
    targetUserId: UserId,
    role: ProjectMemberRole,
  ) => Promise<void>;
  readonly onRemoveParticipant: (
    projectId: ProjectId,
    targetUserId: UserId,
    reason?: string,
  ) => Promise<void>;
  readonly setIsMutatingProject: (next: boolean) => void;
}

function SelectedProjectDetailsView({
  details,
  activeOrgMembers,
  transferableTeamScopes,
  canUpdateSelectedProject,
  canTransferSelectedProject,
  canUnlinkTeam,
  canArchiveSelectedProject,
  canRestoreSelectedProject,
  canDeleteSelectedProject,
  canManageSelectedProjectMembers,
  canOpenSelectedProjectBoard,
  isMutatingProject,
  onOpenBoard,
  onUpdateProject,
  onTransferProjectTeam,
  onArchiveProject,
  onRestoreProject,
  onDeleteProject,
  onExportProject,
  onAddParticipant,
  onUpdateParticipantRole,
  onRemoveParticipant,
  setIsMutatingProject,
}: SelectedProjectDetailsViewProps) {
  const intl = useIntl();
  const { project } = details;
  const isArchived = project.archivedAt !== undefined || project.status === 'ARCHIVED';

  const isCurrentTeamTransferable =
    project.teamId !== undefined &&
    transferableTeamScopes.some((team) => team.id === project.teamId);
  const initialTransferTeamId = isCurrentTeamTransferable
    ? project.teamId
    : canUnlinkTeam
      ? ''
      : (transferableTeamScopes[0]?.id ?? '');
  const [transferTeamId, setTransferTeamId] = useState<string>(initialTransferTeamId);
  const [transferReason, setTransferReason] = useState<string>('');
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<boolean>(false);
  const [deleteReason, setDeleteReason] = useState<string>('');

  const ownerOptions = activeOrgMembers.some((member) => member.userId === details.owner.userId)
    ? activeOrgMembers
    : [
        {
          id: details.owner.userId,
          organizationId: project.organizationId,
          userId: details.owner.userId,
          displayName: details.owner.displayName,
          email: details.owner.email,
          role: 'MEMBER' as const,
          status: 'ACTIVE' as const,
          joinedAt: project.createdAt,
        },
        ...activeOrgMembers,
      ];

  const editForm = useForm<EditProjectFormValues>({
    resolver: zodResolver(editProjectFormSchema),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      ownerUserId: project.ownerUserId,
      inactivityThresholdDays: project.inactivityThresholdDays,
    },
  });

  const handleEditSubmit = async (values: EditProjectFormValues) => {
    setIsMutatingProject(true);
    try {
      await onUpdateProject(project.id, {
        name: values.name,
        description:
          values.description !== undefined && values.description.trim().length > 0
            ? values.description.trim()
            : null,
        ownerUserId: asUserId(values.ownerUserId, 'ownerUserId'),
        inactivityThresholdDays: values.inactivityThresholdDays,
      });
    } finally {
      setIsMutatingProject(false);
    }
  };

  const handleTransferSubmit = async () => {
    if (!canUnlinkTeam && transferTeamId === '') {
      return;
    }
    setIsMutatingProject(true);
    try {
      await onTransferProjectTeam(project.id, {
        targetTeamId: transferTeamId === '' ? null : asTeamId(transferTeamId, 'targetTeamId'),
        ...(transferReason.trim().length > 0 ? { reason: transferReason.trim() } : {}),
      });
      setTransferReason('');
    } finally {
      setIsMutatingProject(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsMutatingProject(true);
    try {
      await onDeleteProject(project.id, project.name, deleteReason.trim() || undefined);
      setConfirmDeleteProject(false);
      setDeleteReason('');
    } finally {
      setIsMutatingProject(false);
    }
  };

  return (
    <div className="space-y-6">
      {isArchived ? (
        <Alert variant="warning">
          <AlertDescription>
            {intl.formatMessage({ id: 'projects.archivedBanner' })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{project.name}</CardTitle>
              <CardDescription>
                {details.teamName !== undefined
                  ? intl.formatMessage({ id: 'projects.teamLabel' }, { name: details.teamName })
                  : intl.formatMessage({ id: 'projects.noTeamLabel' })}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isArchived ? 'outline' : 'default'}>
                {intl.formatMessage({
                  id: isArchived ? 'projects.status.ARCHIVED' : 'projects.status.ACTIVE',
                })}
              </Badge>
              <Badge variant="secondary">
                {intl.formatMessage(
                  { id: 'projects.participantsCountLabel' },
                  { count: details.activeParticipantCount },
                )}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canOpenSelectedProjectBoard ? (
              <>
                <Button
                  type="button"
                  className="min-h-[44px]"
                  onClick={() => onOpenBoard(project.id)}
                >
                  <IconLayoutKanban className="h-4 w-4" aria-hidden="true" />
                  <span>{intl.formatMessage({ id: 'projects.openBoardAction' })}</span>
                </Button>

                <Button asChild variant="outline" className="min-h-[44px]">
                  <Link to={`/projects/${project.id}/tasks`}>
                    <IconListCheck className="h-4 w-4" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: 'projects.openTasksAction' })}</span>
                  </Link>
                </Button>
              </>
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isMutatingProject}
              onClick={() => void onExportProject(project.id, project.name)}
            >
              <IconDownload className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage({ id: 'projects.exportAction' })}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {canUpdateSelectedProject && !isArchived ? (
            <form
              onSubmit={editForm.handleSubmit(handleEditSubmit)}
              noValidate
              className="space-y-4"
            >
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {intl.formatMessage({ id: 'projects.edit.title' })}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: 'projects.edit.description' })}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-project-name" required>
                  {intl.formatMessage({ id: 'projects.edit.nameLabel' })}
                </Label>
                <Input
                  id="edit-project-name"
                  type="text"
                  aria-invalid={editForm.formState.errors.name !== undefined}
                  aria-describedby={
                    editForm.formState.errors.name !== undefined
                      ? 'edit-project-name-error'
                      : undefined
                  }
                  {...editForm.register('name')}
                />
                {editForm.formState.errors.name !== undefined ? (
                  <p
                    id="edit-project-name-error"
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    {intl.formatMessage({
                      id: resolveValidationMessageId(editForm.formState.errors.name.message),
                    })}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-project-description">
                  {intl.formatMessage({ id: 'projects.edit.descriptionLabel' })}
                </Label>
                <Input
                  id="edit-project-description"
                  type="text"
                  {...editForm.register('description')}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-project-owner" required>
                    {intl.formatMessage({ id: 'projects.edit.ownerLabel' })}
                  </Label>
                  <select
                    id="edit-project-owner"
                    aria-invalid={editForm.formState.errors.ownerUserId !== undefined}
                    aria-describedby={
                      editForm.formState.errors.ownerUserId !== undefined
                        ? 'edit-project-owner-error'
                        : undefined
                    }
                    className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    {...editForm.register('ownerUserId')}
                  >
                    {ownerOptions.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName} ({member.email})
                      </option>
                    ))}
                  </select>
                  {editForm.formState.errors.ownerUserId !== undefined ? (
                    <p
                      id="edit-project-owner-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({ id: 'validation.required' })}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-project-inactivity" required>
                    {intl.formatMessage({ id: 'projects.edit.inactivityThresholdLabel' })}
                  </Label>
                  <Input
                    id="edit-project-inactivity"
                    type="number"
                    min={1}
                    step={1}
                    aria-invalid={editForm.formState.errors.inactivityThresholdDays !== undefined}
                    aria-describedby={
                      editForm.formState.errors.inactivityThresholdDays !== undefined
                        ? 'edit-project-inactivity-error'
                        : undefined
                    }
                    {...editForm.register('inactivityThresholdDays')}
                  />
                  {editForm.formState.errors.inactivityThresholdDays !== undefined ? (
                    <p
                      id="edit-project-inactivity-error"
                      role="alert"
                      className="text-xs font-medium text-destructive"
                    >
                      {intl.formatMessage({
                        id: resolveValidationMessageId(
                          editForm.formState.errors.inactivityThresholdDays.message,
                        ),
                      })}
                    </p>
                  ) : null}
                </div>
              </div>

              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={isMutatingProject || editForm.formState.isSubmitting}
              >
                <IconCheck className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'projects.edit.saveAction' })}</span>
              </Button>
            </form>
          ) : (
            <div className="space-y-2 text-sm">
              {project.description !== undefined ? (
                <p className="text-muted-foreground">{project.description}</p>
              ) : null}
              <p className="text-foreground">
                {intl.formatMessage(
                  { id: 'projects.ownerLabel' },
                  { name: details.owner.displayName },
                )}
              </p>
            </div>
          )}

          {canTransferSelectedProject && !isArchived ? (
            <div className="space-y-3 border-t pt-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {intl.formatMessage({ id: 'projects.transfer.title' })}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: 'projects.transfer.description' })}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-project-team">
                    {intl.formatMessage({ id: 'projects.transfer.targetTeamLabel' })}
                  </Label>
                  <select
                    id="transfer-project-team"
                    value={transferTeamId}
                    onChange={(event) => setTransferTeamId(event.target.value)}
                    className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {canUnlinkTeam ? (
                      <option value="">
                        {intl.formatMessage({ id: 'projects.transfer.unlinkOption' })}
                      </option>
                    ) : null}
                    {transferableTeamScopes.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-project-reason">
                    {intl.formatMessage({ id: 'projects.transfer.reasonLabel' })}
                  </Label>
                  <Input
                    id="transfer-project-reason"
                    type="text"
                    value={transferReason}
                    onChange={(event) => setTransferReason(event.target.value)}
                    placeholder={intl.formatMessage({ id: 'projects.transfer.reasonPlaceholder' })}
                  />
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={isMutatingProject || (!canUnlinkTeam && transferTeamId === '')}
                onClick={() => void handleTransferSubmit()}
              >
                <IconArrowsExchange className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'projects.transfer.submit' })}</span>
              </Button>
            </div>
          ) : null}

          {canArchiveSelectedProject || canRestoreSelectedProject || canDeleteSelectedProject ? (
            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {canArchiveSelectedProject && !isArchived ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={isMutatingProject}
                    onClick={() => void onArchiveProject(project.id, project.name)}
                  >
                    <IconArchive className="h-4 w-4" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: 'projects.archiveAction' })}</span>
                  </Button>
                ) : null}

                {canRestoreSelectedProject && isArchived ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[44px]"
                    disabled={isMutatingProject}
                    onClick={() => void onRestoreProject(project.id, project.name)}
                  >
                    <IconArchiveOff className="h-4 w-4" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: 'projects.restoreAction' })}</span>
                  </Button>
                ) : null}

                {canDeleteSelectedProject && !confirmDeleteProject ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-[44px]"
                    disabled={isMutatingProject}
                    onClick={() => setConfirmDeleteProject(true)}
                  >
                    <IconTrash className="h-4 w-4" aria-hidden="true" />
                    <span>{intl.formatMessage({ id: 'projects.deleteAction' })}</span>
                  </Button>
                ) : null}
              </div>

              {confirmDeleteProject ? (
                <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-xs text-foreground">
                    {intl.formatMessage({ id: 'projects.deleteConfirmHint' })}
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="delete-project-reason">
                      {intl.formatMessage({ id: 'projects.deleteReasonLabel' })}
                    </Label>
                    <Input
                      id="delete-project-reason"
                      type="text"
                      value={deleteReason}
                      onChange={(event) => setDeleteReason(event.target.value)}
                      placeholder={intl.formatMessage({ id: 'projects.deleteReasonPlaceholder' })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      className="min-h-[44px]"
                      disabled={isMutatingProject}
                      onClick={() => void handleConfirmDelete()}
                    >
                      {intl.formatMessage({ id: 'projects.deleteAction' })}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-[44px]"
                      disabled={isMutatingProject}
                      onClick={() => setConfirmDeleteProject(false)}
                    >
                      {intl.formatMessage({ id: 'projects.cancelAction' })}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ProjectParticipantsPanel
        projectId={project.id}
        ownerUserId={project.ownerUserId}
        isProjectArchived={isArchived}
        canManageMembers={canManageSelectedProjectMembers}
        members={details.members}
        organizationMembers={activeOrgMembers}
        isMutating={isMutatingProject}
        onAddParticipant={onAddParticipant}
        onUpdateParticipantRole={onUpdateParticipantRole}
        onRemoveParticipant={onRemoveParticipant}
      />
    </div>
  );
}

export function ProjectsPanel({
  organizationName,
  actorRole,
  actorUserId,
  projects,
  selectedProjectId,
  selectedProjectDetails,
  creatableTeamScopes,
  transferableTeamScopes,
  organizationMembers,
  includeArchived,
  isLoadingProjects,
  isLoadingDetails,
  canCreateProject,
  canUpdateSelectedProject,
  canTransferSelectedProject,
  canUnlinkTeam,
  canArchiveSelectedProject,
  canRestoreSelectedProject,
  canDeleteSelectedProject,
  canManageSelectedProjectMembers,
  canOpenSelectedProjectBoard,
  canOpenBoardByProjectId,
  feedback = null,
  onToggleIncludeArchived,
  onSelectProject,
  onOpenBoard,
  onCreateProject,
  onUpdateProject,
  onTransferProjectTeam,
  onArchiveProject,
  onRestoreProject,
  onDeleteProject,
  onExportProject,
  onAddParticipant,
  onUpdateParticipantRole,
  onRemoveParticipant,
}: ProjectsPanelProps) {
  const intl = useIntl();
  const [isMutatingProject, setIsMutatingProject] = useState(false);

  const activeOrgMembers = organizationMembers.filter((member) => member.status === 'ACTIVE');

  const createForm = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: '',
      description: '',
      teamId: '',
      ownerUserId: actorUserId,
      inactivityThresholdDays: 7,
    },
  });

  const handleCreateSubmit = async (values: CreateProjectFormValues) => {
    const trimmedDescription = values.description?.trim() ?? '';
    const trimmedTeamId = values.teamId?.trim() ?? '';
    const trimmedOwnerId = values.ownerUserId?.trim() ?? '';

    await onCreateProject({
      name: values.name,
      ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
      ...(trimmedTeamId.length > 0 ? { teamId: asTeamId(trimmedTeamId, 'teamId') } : {}),
      ...(trimmedOwnerId.length > 0
        ? { ownerUserId: asUserId(trimmedOwnerId, 'ownerUserId') }
        : {}),
      inactivityThresholdDays: values.inactivityThresholdDays,
    });

    createForm.reset({
      name: '',
      description: '',
      teamId: '',
      ownerUserId: actorUserId,
      inactivityThresholdDays: 7,
    });
  };

  return (
    <section aria-labelledby="projects-heading" className="mx-auto w-full max-w-6xl space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            id="projects-heading"
            className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            {intl.formatMessage({ id: 'projects.title' })}
          </h1>
          <Badge variant="secondary">{organizationName}</Badge>
        </div>
        <p className="text-base text-muted-foreground">
          {intl.formatMessage({ id: 'projects.subtitle' })}
        </p>
      </div>

      {!canCreateProject ? (
        <Alert variant="info">
          <AlertDescription>
            {intl.formatMessage(
              { id: 'projects.noPermission' },
              { role: intl.formatMessage({ id: ROLE_LABEL_ID_BY_CODE[actorRole] }) },
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {feedback !== null ? (
        <Alert
          variant={feedback.type}
          role={feedback.type === 'destructive' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <label
          htmlFor="projects-include-archived"
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
        >
          <input
            id="projects-include-archived"
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => onToggleIncludeArchived(event.target.checked)}
            className="h-5 w-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <span>{intl.formatMessage({ id: 'projects.includeArchived' })}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          {isLoadingProjects ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'app.loading' })}
            </p>
          ) : projects.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{intl.formatMessage({ id: 'projects.emptyTitle' })}</CardTitle>
                <CardDescription>
                  {intl.formatMessage({ id: 'projects.emptyDescription' })}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="space-y-3">
              {projects.map((project) => {
                const isSelected = project.id === selectedProjectId;
                const isArchived =
                  project.archivedAt !== undefined || project.status === 'ARCHIVED';
                const canOpenProjectBoard = canOpenBoardByProjectId[project.id] ?? false;

                return (
                  <li
                    key={project.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'bg-card'
                    }`}
                  >
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => onSelectProject(project.id)}
                        className="min-h-[44px] w-full rounded-md p-1 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">{project.name}</span>
                          <Badge variant={isArchived ? 'outline' : 'default'}>
                            {intl.formatMessage({
                              id: isArchived
                                ? 'projects.status.ARCHIVED'
                                : 'projects.status.ACTIVE',
                            })}
                          </Badge>
                        </div>

                        {project.description !== undefined ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {project.description}
                          </p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {project.teamName !== undefined
                              ? intl.formatMessage(
                                  { id: 'projects.teamLabel' },
                                  { name: project.teamName },
                                )
                              : intl.formatMessage({ id: 'projects.noTeamLabel' })}
                          </span>
                          <span>
                            {intl.formatMessage(
                              { id: 'projects.ownerLabel' },
                              { name: project.ownerName },
                            )}
                          </span>
                          <span>
                            {intl.formatMessage(
                              { id: 'projects.participantsCountLabel' },
                              { count: project.participantCount },
                            )}
                          </span>
                        </div>
                      </button>

                      {canOpenProjectBoard ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px] w-full"
                          onClick={() => onOpenBoard(project.id)}
                        >
                          <IconLayoutKanban className="h-4 w-4" aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'projects.openBoardAction' })}</span>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canCreateProject ? (
            <Card>
              <CardHeader>
                <CardTitle>{intl.formatMessage({ id: 'projects.create.title' })}</CardTitle>
                <CardDescription>
                  {intl.formatMessage({ id: 'projects.create.description' })}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <form
                  onSubmit={createForm.handleSubmit(handleCreateSubmit)}
                  noValidate
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="create-project-name" required>
                      {intl.formatMessage({ id: 'projects.create.nameLabel' })}
                    </Label>
                    <Input
                      id="create-project-name"
                      type="text"
                      placeholder={intl.formatMessage({ id: 'projects.create.namePlaceholder' })}
                      aria-invalid={createForm.formState.errors.name !== undefined}
                      aria-describedby={
                        createForm.formState.errors.name !== undefined
                          ? 'create-project-name-error'
                          : undefined
                      }
                      {...createForm.register('name')}
                    />
                    {createForm.formState.errors.name !== undefined ? (
                      <p
                        id="create-project-name-error"
                        role="alert"
                        className="text-xs font-medium text-destructive"
                      >
                        {intl.formatMessage({
                          id: resolveValidationMessageId(createForm.formState.errors.name.message),
                        })}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="create-project-description">
                      {intl.formatMessage({ id: 'projects.create.descriptionLabel' })}
                    </Label>
                    <Input
                      id="create-project-description"
                      type="text"
                      placeholder={intl.formatMessage({
                        id: 'projects.create.descriptionPlaceholder',
                      })}
                      {...createForm.register('description')}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="create-project-team">
                      {intl.formatMessage({ id: 'projects.create.teamLabel' })}
                    </Label>
                    <select
                      id="create-project-team"
                      className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      {...createForm.register('teamId')}
                    >
                      <option value="">
                        {intl.formatMessage({ id: 'projects.create.noTeamOption' })}
                      </option>
                      {creatableTeamScopes.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {activeOrgMembers.length > 0 ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="create-project-owner">
                        {intl.formatMessage({ id: 'projects.create.ownerLabel' })}
                      </Label>
                      <select
                        id="create-project-owner"
                        className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...createForm.register('ownerUserId')}
                      >
                        {activeOrgMembers.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.displayName} ({member.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="create-project-inactivity" required>
                      {intl.formatMessage({ id: 'projects.create.inactivityThresholdLabel' })}
                    </Label>
                    <Input
                      id="create-project-inactivity"
                      type="number"
                      min={1}
                      step={1}
                      aria-invalid={
                        createForm.formState.errors.inactivityThresholdDays !== undefined
                      }
                      aria-describedby={
                        createForm.formState.errors.inactivityThresholdDays !== undefined
                          ? 'create-project-inactivity-error'
                          : undefined
                      }
                      {...createForm.register('inactivityThresholdDays')}
                    />
                    {createForm.formState.errors.inactivityThresholdDays !== undefined ? (
                      <p
                        id="create-project-inactivity-error"
                        role="alert"
                        className="text-xs font-medium text-destructive"
                      >
                        {intl.formatMessage({
                          id: resolveValidationMessageId(
                            createForm.formState.errors.inactivityThresholdDays.message,
                          ),
                        })}
                      </p>
                    ) : null}
                  </div>

                  <Button
                    type="submit"
                    className="min-h-[44px]"
                    disabled={createForm.formState.isSubmitting}
                  >
                    <IconFolderPlus className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {intl.formatMessage({
                        id: createForm.formState.isSubmitting
                          ? 'auth.common.submitting'
                          : 'projects.create.submit',
                      })}
                    </span>
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6 lg:col-span-7">
          {selectedProjectId === null ? null : isLoadingDetails ||
            selectedProjectDetails === null ? (
            <Card>
              <CardContent className="py-8">
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  {intl.formatMessage({ id: 'app.loading' })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <SelectedProjectDetailsView
              key={`${selectedProjectDetails.project.id}:${selectedProjectDetails.project.updatedAt}`}
              details={selectedProjectDetails}
              activeOrgMembers={activeOrgMembers}
              transferableTeamScopes={transferableTeamScopes}
              canUpdateSelectedProject={canUpdateSelectedProject}
              canTransferSelectedProject={canTransferSelectedProject}
              canUnlinkTeam={canUnlinkTeam}
              canArchiveSelectedProject={canArchiveSelectedProject}
              canRestoreSelectedProject={canRestoreSelectedProject}
              canDeleteSelectedProject={canDeleteSelectedProject}
              canManageSelectedProjectMembers={canManageSelectedProjectMembers}
              canOpenSelectedProjectBoard={canOpenSelectedProjectBoard}
              isMutatingProject={isMutatingProject}
              onOpenBoard={onOpenBoard}
              onUpdateProject={onUpdateProject}
              onTransferProjectTeam={onTransferProjectTeam}
              onArchiveProject={onArchiveProject}
              onRestoreProject={onRestoreProject}
              onDeleteProject={onDeleteProject}
              onExportProject={onExportProject}
              onAddParticipant={onAddParticipant}
              onUpdateParticipantRole={onUpdateParticipantRole}
              onRemoveParticipant={onRemoveParticipant}
              setIsMutatingProject={setIsMutatingProject}
            />
          )}
        </div>
      </div>
    </section>
  );
}
