import { IconArrowDown, IconArrowUp, IconUserMinus, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import type { OrganizationMemberDetails } from '@/modules/organizations';
import type { ProjectId, UserId } from '@/shared/kernel';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label } from '@/shared/ui';
import type { ProjectParticipantDetails } from '../application/use-cases/project-service';

type ProjectMemberRole = ProjectParticipantDetails['projectRole'];

export interface ProjectParticipantsPanelProps {
  readonly projectId: ProjectId;
  readonly ownerUserId: UserId;
  readonly isProjectArchived: boolean;
  readonly canManageMembers: boolean;
  readonly members: readonly ProjectParticipantDetails[];
  readonly organizationMembers: readonly OrganizationMemberDetails[];
  readonly isMutating: boolean;
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

export function ProjectParticipantsPanel({
  projectId,
  ownerUserId,
  isProjectArchived,
  canManageMembers,
  members,
  organizationMembers,
  isMutating,
  onAddParticipant,
  onUpdateParticipantRole,
  onRemoveParticipant,
}: ProjectParticipantsPanelProps) {
  const intl = useIntl();
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<ProjectMemberRole>('PARTICIPANT');
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<UserId | null>(null);

  const activeMemberIds = new Set(members.map((member) => member.userId));
  const availableOrgMembers = organizationMembers.filter(
    (member) => member.status === 'ACTIVE' && !activeMemberIds.has(member.userId),
  );

  const handleAddSubmit = async () => {
    if (selectedUserId === '') {
      return;
    }
    const candidate = availableOrgMembers.find((member) => member.userId === selectedUserId);
    if (candidate === undefined) {
      return;
    }
    await onAddParticipant(projectId, candidate.userId, selectedRole);
    setSelectedUserId('');
    setSelectedRole('PARTICIPANT');
  };

  const handleConfirmRemove = async (targetUserId: UserId) => {
    await onRemoveParticipant(projectId, targetUserId);
    setConfirmRemoveUserId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: 'projects.members.title' })}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {canManageMembers && !isProjectArchived ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
            <div className="space-y-1.5 sm:col-span-6">
              <Label htmlFor="add-project-participant-select">
                {intl.formatMessage({ id: 'projects.members.addLabel' })}
              </Label>
              <select
                id="add-project-participant-select"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">
                  {intl.formatMessage({ id: 'projects.members.addPlaceholder' })}
                </option>
                {availableOrgMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName} ({member.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="add-project-participant-role">
                {intl.formatMessage({ id: 'projects.members.roleLabel' })}
              </Label>
              <select
                id="add-project-participant-role"
                value={selectedRole}
                onChange={(event) =>
                  setSelectedRole(event.target.value === 'MANAGER' ? 'MANAGER' : 'PARTICIPANT')
                }
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="PARTICIPANT">
                  {intl.formatMessage({ id: 'projects.members.role.PARTICIPANT' })}
                </option>
                <option value="MANAGER">
                  {intl.formatMessage({ id: 'projects.members.role.MANAGER' })}
                </option>
              </select>
            </div>

            <div className="sm:col-span-3">
              <Button
                type="button"
                className="min-h-[44px] w-full"
                disabled={isMutating || selectedUserId === ''}
                onClick={() => void handleAddSubmit()}
              >
                <IconUserPlus className="h-4 w-4" aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'projects.members.addAction' })}</span>
              </Button>
            </div>
          </div>
        ) : null}

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: 'projects.members.empty' })}
          </p>
        ) : (
          <ul className="space-y-3">
            {members.map((member) => {
              const isOwner = member.userId === ownerUserId;
              const isManager = member.projectRole === 'MANAGER';
              const isConfirmingRemove = confirmRemoveUserId === member.userId;

              return (
                <li key={member.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{member.displayName}</span>
                        <Badge variant={isManager ? 'default' : 'secondary'}>
                          {intl.formatMessage({
                            id: isManager
                              ? 'projects.members.role.MANAGER'
                              : 'projects.members.role.PARTICIPANT',
                          })}
                        </Badge>
                        {isOwner ? (
                          <Badge variant="outline">
                            {intl.formatMessage(
                              { id: 'projects.ownerLabel' },
                              { name: member.displayName },
                            )}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </div>

                    {canManageMembers && !isProjectArchived && !isOwner ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {isManager ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={isMutating}
                            onClick={() =>
                              void onUpdateParticipantRole(projectId, member.userId, 'PARTICIPANT')
                            }
                          >
                            <IconArrowDown className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {intl.formatMessage({ id: 'projects.members.demoteAction' })}
                            </span>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={isMutating}
                            onClick={() =>
                              void onUpdateParticipantRole(projectId, member.userId, 'MANAGER')
                            }
                          >
                            <IconArrowUp className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {intl.formatMessage({ id: 'projects.members.promoteAction' })}
                            </span>
                          </Button>
                        )}

                        {!isConfirmingRemove ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={isMutating}
                            onClick={() => setConfirmRemoveUserId(member.userId)}
                          >
                            <IconUserMinus className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {intl.formatMessage({ id: 'projects.members.removeAction' })}
                            </span>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {isConfirmingRemove ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-h-[44px]"
                        disabled={isMutating}
                        onClick={() => void handleConfirmRemove(member.userId)}
                      >
                        {intl.formatMessage({ id: 'projects.members.removeAction' })}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-[44px]"
                        disabled={isMutating}
                        onClick={() => setConfirmRemoveUserId(null)}
                      >
                        {intl.formatMessage({ id: 'projects.cancelAction' })}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
