import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { useId, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import type { IsoDateTime } from '@/shared/kernel';
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
  ModalDialog,
} from '@/shared/ui';
import type { CreateCatalogItemInput, UpdateCatalogItemInput } from '../application/contracts';
import { CONTROL_TEXTAREA_CLASS_NAME, formatFeedbackDateTime } from './feedback-ui-helpers';

export interface CatalogVersionRow {
  readonly id: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly description?: string;
  readonly active: boolean;
  readonly createdAt: IsoDateTime;
}

export interface CatalogItemRow {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
  readonly sortOrder: number;
  readonly hasBeenUsed: boolean;
  readonly deletedAt?: IsoDateTime;
  readonly currentVersion: CatalogVersionRow;
  readonly versions: readonly CatalogVersionRow[];
}

export interface FeedbackCatalogSectionProps {
  readonly kind: 'category' | 'reason';
  readonly items: readonly CatalogItemRow[];
  readonly isBusy: boolean;
  readonly onCreate: (input: CreateCatalogItemInput) => Promise<void>;
  readonly onUpdate: (id: string, input: UpdateCatalogItemInput) => Promise<void>;
  readonly onReorder: (orderedIds: readonly string[]) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
}

export function FeedbackCatalogSection({
  kind,
  items,
  isBusy,
  onCreate,
  onUpdate,
  onReorder,
  onDelete,
}: FeedbackCatalogSectionProps) {
  const intl = useIntl();
  const sectionHeadingId = `feedback-catalog-${kind}-heading`;
  const includeDeletedId = useId();
  const codeId = useId();
  const nameId = useId();
  const descId = useId();
  const sortOrderId = useId();
  const activeId = useId();
  const deleteTitleId = useId();

  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>(String((items.length + 1) * 10));
  const [active, setActive] = useState<boolean>(true);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editSortOrder, setEditSortOrder] = useState<string>('0');
  const [editActive, setEditActive] = useState<boolean>(true);

  const [confirmDeleteItem, setConfirmDeleteItem] = useState<CatalogItemRow | null>(null);

  const visibleItems = items.filter((item) => includeDeleted || item.deletedAt === undefined);
  const activeOrderedItems = items.filter((item) => item.deletedAt === undefined);

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(trimmedCode) || trimmedName.length < 2) {
      setCreateError(intl.formatMessage({ id: 'validation.required' }));
      return;
    }

    const parsedOrder = Number.parseInt(sortOrder, 10);
    setCreateError(null);
    await onCreate({
      code: trimmedCode,
      name: trimmedName,
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      active,
      ...(Number.isInteger(parsedOrder) && parsedOrder >= 0 ? { sortOrder: parsedOrder } : {}),
    });
    setCode('');
    setName('');
    setDescription('');
    setSortOrder(String((items.length + 2) * 10));
    setActive(true);
  };

  const startEditing = (item: CatalogItemRow) => {
    setEditingId(item.id);
    setEditName(item.currentVersion.name);
    setEditDescription(item.currentVersion.description ?? '');
    setEditSortOrder(String(item.sortOrder));
    setEditActive(item.active);
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>, itemId: string) => {
    event.preventDefault();
    if (editName.trim().length < 2) {
      return;
    }
    const parsedOrder = Number.parseInt(editSortOrder, 10);
    await onUpdate(itemId, {
      name: editName.trim(),
      description: editDescription.trim().length > 0 ? editDescription.trim() : null,
      active: editActive,
      ...(Number.isInteger(parsedOrder) && parsedOrder >= 0 ? { sortOrder: parsedOrder } : {}),
    });
    setEditingId(null);
  };

  const handleMove = async (itemId: string, direction: -1 | 1) => {
    const index = activeOrderedItems.findIndex((entry) => entry.id === itemId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= activeOrderedItems.length) {
      return;
    }
    const reordered = [...activeOrderedItems];
    const current = reordered[index];
    const target = reordered[targetIndex];
    if (!current || !target) {
      return;
    }
    reordered[index] = target;
    reordered[targetIndex] = current;
    await onReorder(reordered.map((entry) => entry.id));
  };

  return (
    <Card aria-labelledby={sectionHeadingId}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id={sectionHeadingId} className="text-lg">
            {intl.formatMessage({
              id:
                kind === 'category'
                  ? 'feedbacks.governance.catalog.categoriesTitle'
                  : 'feedbacks.governance.catalog.reasonsTitle',
            })}
          </CardTitle>
          <label
            htmlFor={includeDeletedId}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-muted-foreground"
          >
            <input
              id={includeDeletedId}
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) => setIncludeDeleted(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span>
              {intl.formatMessage({ id: 'feedbacks.governance.catalog.includeDeletedLabel' })}
            </span>
          </label>
        </div>
        <CardDescription>
          {intl.formatMessage({ id: 'feedbacks.governance.catalog.usedDeletionBlockedHint' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          onSubmit={handleCreateSubmit}
          className="rounded-md border border-border p-4 space-y-3"
          noValidate
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={codeId}>
                {intl.formatMessage({ id: 'feedbacks.governance.catalog.codeLabel' })}
              </Label>
              <Input
                id={codeId}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (createError !== null) {
                    setCreateError(null);
                  }
                }}
                placeholder={intl.formatMessage({
                  id: 'feedbacks.governance.catalog.codePlaceholder',
                })}
                className="min-h-[44px]"
                disabled={isBusy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={nameId}>
                {intl.formatMessage({ id: 'feedbacks.governance.catalog.nameLabel' })}
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (createError !== null) {
                    setCreateError(null);
                  }
                }}
                className="min-h-[44px]"
                disabled={isBusy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={sortOrderId}>
                {intl.formatMessage({ id: 'feedbacks.governance.catalog.sortOrderLabel' })}
              </Label>
              <Input
                id={sortOrderId}
                type="number"
                min={0}
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                className="min-h-[44px]"
                disabled={isBusy}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={descId}>
              {intl.formatMessage({ id: 'feedbacks.governance.catalog.descriptionLabel' })}
            </Label>
            <textarea
              id={descId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={CONTROL_TEXTAREA_CLASS_NAME}
              disabled={isBusy}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label
              htmlFor={activeId}
              className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <input
                id={activeId}
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                disabled={isBusy}
                className="h-4 w-4 rounded border-input"
              />
              <span>{intl.formatMessage({ id: 'feedbacks.governance.catalog.activeLabel' })}</span>
            </label>

            <Button type="submit" disabled={isBusy} className="min-h-[44px] gap-2">
              <IconPlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {intl.formatMessage({
                  id:
                    kind === 'category'
                      ? 'feedbacks.governance.catalog.createCategoryAction'
                      : 'feedbacks.governance.catalog.createReasonAction',
                })}
              </span>
            </Button>
          </div>

          {createError !== null ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}
        </form>

        <ul className="space-y-3">
          {visibleItems.map((item) => {
            const activeIndex = activeOrderedItems.findIndex((entry) => entry.id === item.id);
            const isDeleted = item.deletedAt !== undefined;
            const isEditing = editingId === item.id;

            return (
              <li
                key={item.id}
                className="rounded-md border border-border bg-muted/15 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {item.currentVersion.name}
                      </span>
                      <Badge variant="outline">{item.code}</Badge>
                      <Badge variant="outline">
                        {intl.formatMessage(
                          { id: 'feedbacks.governance.catalog.versionBadge' },
                          { version: item.currentVersion.versionNumber },
                        )}
                      </Badge>
                      <Badge variant={item.active ? 'default' : 'secondary'}>
                        {intl.formatMessage({
                          id: item.active
                            ? 'feedbacks.governance.catalog.activeBadge'
                            : 'feedbacks.governance.catalog.inactiveBadge',
                        })}
                      </Badge>
                      {item.deletedAt !== undefined ? (
                        <Badge variant="destructive">
                          {intl.formatMessage(
                            { id: 'feedbacks.governance.catalog.deletedBadge' },
                            { date: formatFeedbackDateTime(item.deletedAt, intl) },
                          )}
                        </Badge>
                      ) : null}
                    </div>
                    {item.currentVersion.description !== undefined ? (
                      <p className="text-sm text-muted-foreground">
                        {item.currentVersion.description}
                      </p>
                    ) : null}
                  </div>

                  {!isDeleted ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy || activeIndex <= 0}
                        onClick={() => void handleMove(item.id, -1)}
                        aria-label={`${intl.formatMessage({ id: 'feedbacks.governance.catalog.moveUpAction' })}: ${item.currentVersion.name}`}
                        className="min-h-[44px] min-w-[44px]"
                      >
                        <IconArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy || activeIndex >= activeOrderedItems.length - 1}
                        onClick={() => void handleMove(item.id, 1)}
                        aria-label={`${intl.formatMessage({ id: 'feedbacks.governance.catalog.moveDownAction' })}: ${item.currentVersion.name}`}
                        className="min-h-[44px] min-w-[44px]"
                      >
                        <IconArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void onUpdate(item.id, { active: !item.active })}
                        className="min-h-[44px]"
                      >
                        {intl.formatMessage({
                          id: item.active
                            ? 'feedbacks.governance.catalog.deactivateAction'
                            : 'feedbacks.governance.catalog.activateAction',
                        })}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => (isEditing ? setEditingId(null) : startEditing(item))}
                        className="min-h-[44px]"
                      >
                        {intl.formatMessage({ id: isEditing ? 'common.cancel' : 'common.edit' })}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={isBusy || item.hasBeenUsed}
                        onClick={() => setConfirmDeleteItem(item)}
                        className="min-h-[44px] gap-1.5"
                      >
                        <IconTrash className="h-4 w-4" aria-hidden="true" />
                        <span>
                          {intl.formatMessage({ id: 'feedbacks.governance.catalog.deleteAction' })}
                        </span>
                      </Button>
                    </div>
                  ) : null}
                </div>

                {isEditing ? (
                  <form
                    onSubmit={(event) => void handleEditSubmit(event, item.id)}
                    className="space-y-3 border-t pt-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-name-${item.id}`}>
                          {intl.formatMessage({ id: 'feedbacks.governance.catalog.nameLabel' })}
                        </Label>
                        <Input
                          id={`edit-name-${item.id}`}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="min-h-[44px]"
                          disabled={isBusy}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-order-${item.id}`}>
                          {intl.formatMessage({
                            id: 'feedbacks.governance.catalog.sortOrderLabel',
                          })}
                        </Label>
                        <Input
                          id={`edit-order-${item.id}`}
                          type="number"
                          min={0}
                          value={editSortOrder}
                          onChange={(event) => setEditSortOrder(event.target.value)}
                          className="min-h-[44px]"
                          disabled={isBusy}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-desc-${item.id}`}>
                        {intl.formatMessage({
                          id: 'feedbacks.governance.catalog.descriptionLabel',
                        })}
                      </Label>
                      <textarea
                        id={`edit-desc-${item.id}`}
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        className={CONTROL_TEXTAREA_CLASS_NAME}
                        disabled={isBusy}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label
                        htmlFor={`edit-active-${item.id}`}
                        className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
                      >
                        <input
                          id={`edit-active-${item.id}`}
                          type="checkbox"
                          checked={editActive}
                          onChange={(event) => setEditActive(event.target.checked)}
                          disabled={isBusy}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span>
                          {intl.formatMessage({ id: 'feedbacks.governance.catalog.activeLabel' })}
                        </span>
                      </label>
                      <Button type="submit" disabled={isBusy} className="min-h-[44px]">
                        {intl.formatMessage({
                          id: 'feedbacks.governance.catalog.saveVersionAction',
                        })}
                      </Button>
                    </div>
                  </form>
                ) : null}

                <div className="border-t pt-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {intl.formatMessage(
                      { id: 'feedbacks.governance.catalog.versionsHistoryTitle' },
                      { count: item.versions.length },
                    )}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {item.versions.map((ver) => (
                      <li key={ver.id}>
                        <Badge variant="outline">
                          {intl.formatMessage(
                            { id: 'feedbacks.governance.catalog.versionBadge' },
                            { version: ver.versionNumber },
                          )}{' '}
                          — {ver.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <ModalDialog
        isOpen={confirmDeleteItem !== null}
        titleId={deleteTitleId}
        title={intl.formatMessage({ id: 'feedbacks.governance.catalog.deleteAction' })}
        description={confirmDeleteItem?.currentVersion.name}
        closeLabel={intl.formatMessage({ id: 'common.close' })}
        isBusy={isBusy}
        onClose={() => setConfirmDeleteItem(null)}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmDeleteItem(null)}
            disabled={isBusy}
            className="min-h-[44px]"
          >
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isBusy}
            onClick={() => {
              if (confirmDeleteItem !== null) {
                const targetId = confirmDeleteItem.id;
                setConfirmDeleteItem(null);
                void onDelete(targetId);
              }
            }}
            className="min-h-[44px]"
          >
            {intl.formatMessage({ id: 'common.confirm' })}
          </Button>
        </div>
      </ModalDialog>
    </Card>
  );
}
