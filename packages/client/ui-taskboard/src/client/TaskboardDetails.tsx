/** Editable Issue details, comments, activity, dependencies, and archival. */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  IconArchiveOutline20,
  IconCloseOutline16,
  IconDownloadOutline16,
  IconLinkOutline16,
  IconPaperclipOutline16,
  IconPlayOutline16,
  IconSendOutline16,
  IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Issue, IssueAssignee, IssuePriority, IssueReference, IssueRelationType, IssueStatus } from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardDetailsProps as DetailsProps } from './contract.ts'
import { ISSUE_PRIORITIES, ISSUE_STATUSES, priorityLabel, statusLabel } from './model.ts'
import { PatrolPanel } from './PatrolPanel.tsx'
import css from './Taskboard.module.css'

export type { TaskboardDetailsProps } from './contract.ts'

interface IssueDraft {
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  assignee: IssueAssignee
  labels: string
  startDate: string
  dueDate: string
  reason: string
}

/** Convert the selected Issue to controlled form fields. */
function draftOf(issue: Issue | null): IssueDraft {
  return {
    title: issue?.title ?? '',
    description: issue?.description ?? '',
    status: issue?.status ?? 'backlog',
    priority: issue?.priority ?? 'none',
    assignee: issue?.assignee ?? 'unassigned',
    labels: issue?.labels.join(', ') ?? '',
    startDate: issue?.startDate ?? '',
    dueDate: issue?.dueDate ?? '',
    reason: '',
  }
}

/** Right-column Taskboard entry for the selected Issue. */
export function TaskboardDetails({
  useTaskboard,
  updateIssue,
  archiveIssue,
  addComment,
  addAttachment,
  readAttachment,
  deleteAttachment,
  addRelation,
  removeRelation,
  updatePatrol,
  runPatrol,
  removePatrolWorktree,
  openSession,
  close,
  t,
}: DetailsProps) {
  const snapshot = useTaskboard(value => value)
  const issue = snapshot.selectedIssue
  const [draft, setDraft] = useState(() => draftOf(issue))
  const [comment, setComment] = useState('')
  const [relationType, setRelationType] = useState<IssueRelationType>('blocked_by')
  const [relationReference, setRelationReference] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [attachmentPreviews, setAttachmentPreviews] = useState<Readonly<Partial<Record<string, string>>>>({})
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  useEffect(() => { setDraft(draftOf(issue)) }, [issue])
  useEffect(() => {
    setAttachmentPreviews({})
    setAttachmentError(null)
  }, [issue?.id])
  if (snapshot.detailPanel === 'patrol') {
    return <PatrolPanel useTaskboard={useTaskboard} updatePatrol={updatePatrol} runPatrol={runPatrol} close={close} t={t} />
  }
  if (issue === null) return <aside className={css.detailsEmpty}>{t('details.noSelection')}</aside>
  const patrolContext = snapshot.patrolIssue?.context ?? null
  const needsReason = draft.status === 'todo' && (issue.status === 'in_review' || issue.status === 'blocked' || issue.status === 'done')
  const save = (event: FormEvent): void => {
    event.preventDefault()
    void updateIssue(issue, {
      title: draft.title.trim(),
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      assignee: draft.assignee,
      labels: draft.labels.split(',').map(label => label.trim()).filter(Boolean),
      startDate: draft.startDate === '' ? null : draft.startDate,
      dueDate: draft.dueDate === '' ? null : draft.dueDate,
      ...(needsReason ? { reason: draft.reason } : {}),
    })
  }
  return (
    <aside className={css.details}>
      <header className={css.detailsHeader}>
        <div><span className={css.identifier}>{issue.identifier}</span><strong>{statusLabel(t, issue.status)}</strong></div>
        <button type="button" className={css.iconButton} aria-label={t('details.close')} onClick={close}><IconCloseOutline16 /></button>
      </header>
      <div className={css.detailsScroll}>
        <form className={css.issueForm} onSubmit={save}>
          <label>{t('field.title')}<input value={draft.title} onChange={(event) => { setDraft(value => ({ ...value, title: event.target.value })) }} /></label>
          <label>{t('field.description')}<textarea rows={5} value={draft.description} onChange={(event) => { setDraft(value => ({ ...value, description: event.target.value })) }} /></label>
          <div className={css.formColumns}>
            <label>{t('field.status')}<select value={draft.status} onChange={(event) => { setDraft(value => ({ ...value, status: event.target.value as IssueStatus })) }}>{ISSUE_STATUSES.map(status => <option value={status} key={status}>{statusLabel(t, status)}</option>)}</select></label>
            <label>{t('field.priority')}<select value={draft.priority} onChange={(event) => { setDraft(value => ({ ...value, priority: event.target.value as IssuePriority })) }}>{ISSUE_PRIORITIES.map(priority => <option value={priority} key={priority}>{priorityLabel(t, priority)}</option>)}</select></label>
          </div>
          <label>{t('field.assignee')}<select value={draft.assignee} onChange={(event) => { setDraft(value => ({ ...value, assignee: event.target.value as IssueAssignee })) }}><option value="unassigned">{t('assignee.unassigned')}</option><option value="user">{t('assignee.user')}</option><option value="patrol_agent">{t('assignee.patrol_agent')}</option></select></label>
          <label>{t('field.labels')}<input value={draft.labels} onChange={(event) => { setDraft(value => ({ ...value, labels: event.target.value })) }} /></label>
          <div className={css.formColumns}>
            <label>{t('field.startDate')}<input type="date" value={draft.startDate} onChange={(event) => { setDraft(value => ({ ...value, startDate: event.target.value })) }} /></label>
            <label>{t('field.dueDate')}<input type="date" value={draft.dueDate} onChange={(event) => { setDraft(value => ({ ...value, dueDate: event.target.value })) }} /></label>
          </div>
          {needsReason && <label>{t('field.reason')}<textarea rows={3} required value={draft.reason} onChange={(event) => { setDraft(value => ({ ...value, reason: event.target.value })) }} /></label>}
          <button type="submit" className={css.primaryButton} disabled={draft.title.trim() === ''}>{t('details.save')}</button>
        </form>

        <section className={css.detailSection}>
          <div className={css.attachmentHeading}>
            <div><h2>{t('details.attachments')}</h2><p>{t('details.attachment.limit')}</p></div>
            <label className={css.secondaryButton}>
              <IconPaperclipOutline16 />{t('details.attachment.add')}
              <input
                className={css.hiddenFileInput}
                type="file"
                aria-label={t('details.attachment.add')}
                onChange={(event) => {
                  const input = event.currentTarget
                  const file = input.files?.[0]
                  if (file === undefined) return
                  input.value = ''
                  void addAttachment(file)
                }}
              />
            </label>
          </div>
          {snapshot.attachments.length === 0
            ? <p className={css.muted}>{t('details.attachment.empty')}</p>
            : <div className={css.attachmentList}>{snapshot.attachments.map(attachment => (
              <article className={css.attachmentRow} key={attachment.id}>
                <div className={css.attachmentMetadata}>
                  <strong>{attachment.name}</strong>
                  <span>{attachment.mediaType} · {formatBytes(attachment.size)}</span>
                </div>
                <div className={css.attachmentActions}>
                  {attachment.mediaType.startsWith('image/') && <button
                    type="button"
                    className={css.ghostButton}
                    aria-label={t('details.attachment.previewLabel', { name: attachment.name })}
                    onClick={() => {
                      const existing = attachmentPreviews[attachment.id]
                      if (existing !== undefined) {
                        setAttachmentPreviews(current => ({ ...current, [attachment.id]: undefined }))
                        return
                      }
                      void readAttachment(attachment).then((result) => {
                        if (!result.ok) {
                          setAttachmentError(result.error.message)
                          return
                        }
                        setAttachmentError(null)
                        setAttachmentPreviews(current => ({
                          ...current,
                          [attachment.id]: `data:${result.value.attachment.mediaType};base64,${result.value.data}`,
                        }))
                      })
                    }}
                  >{t('details.attachment.preview')}</button>}
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('details.attachment.downloadLabel', { name: attachment.name })}
                    onClick={() => {
                      void readAttachment(attachment).then((result) => {
                        if (!result.ok) {
                          setAttachmentError(result.error.message)
                          return
                        }
                        setAttachmentError(null)
                        const link = document.createElement('a')
                        link.href = `data:${result.value.attachment.mediaType};base64,${result.value.data}`
                        link.download = result.value.attachment.name
                        document.body.append(link)
                        link.click()
                        link.remove()
                      })
                    }}
                  ><IconDownloadOutline16 /></button>
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('details.attachment.deleteLabel', { name: attachment.name })}
                    onClick={() => {
                      if (!window.confirm(t('details.attachment.confirm', { name: attachment.name }))) return
                      void deleteAttachment(attachment, true)
                    }}
                  ><IconTrashOutline16 /></button>
                </div>
                {attachmentPreviews[attachment.id] !== undefined && <img
                  className={css.attachmentPreview}
                  src={attachmentPreviews[attachment.id]}
                  alt={attachment.name}
                />}
              </article>
            ))}</div>}
          {attachmentError !== null && <p className={css.inlineError} role="alert">{attachmentError}</p>}
        </section>

        <section className={css.detailSection}>
          <h2>{t('details.comments')}</h2>
          <div className={css.timeline}>{snapshot.comments.map(item => (
            <article className={css.timelineItem} key={item.id}>
              <header>
                <strong>{item.actor.name}</strong>
                <time>{new Date(item.createdAt).toLocaleString()}</time>
              </header>
              <p>{item.body}</p>
            </article>
          ))}</div>
          <form className={css.commentForm} onSubmit={(event) => {
            event.preventDefault()
            const body = comment.trim()
            if (body === '') return
            void addComment(body).then((result) => { if (result.ok) setComment('') })
          }}>
            <textarea rows={3} placeholder={t('details.comment.placeholder')} value={comment} onChange={(event) => { setComment(event.target.value) }} />
            <button type="submit" className={css.secondaryButton} disabled={comment.trim() === ''}><IconSendOutline16 />{t('details.comment.submit')}</button>
          </form>
        </section>

        {patrolContext !== null && snapshot.patrolIssue !== null && (
          <section className={css.detailSection}>
            <h2>{t('details.development')}</h2>
            <dl className={css.evidenceGrid}>
              <div><dt>{t('details.session')}</dt><dd><button
                type="button"
                className={css.evidenceLink}
                aria-label={t('details.session.open', { id: patrolContext.sessionId })}
                onClick={() => { openSession(patrolContext.sessionId) }}
              ><code>{patrolContext.sessionId}</code></button></dd></div>
              <div><dt>{t('details.branch')}</dt><dd><code>{patrolContext.branch}</code></dd></div>
              <div><dt>{t('details.baseBranch')}</dt><dd><code>{patrolContext.baseBranch}</code></dd></div>
              <div><dt>{t('details.worktree')}</dt><dd><code>{patrolContext.worktreePath}</code></dd></div>
              <div><dt>{t('details.commit')}</dt><dd><code>{patrolContext.resultCommit ?? t('details.commitPending')}</code></dd></div>
            </dl>
            {snapshot.patrolIssue.worktreePresent
              ? <button type="button" className={css.secondaryButton} onClick={() => {
                if (!window.confirm(t('details.worktree.confirm'))) return
                void removePatrolWorktree(true)
              }}><IconTrashOutline16 />{t('details.worktree.remove')}</button>
              : <p className={css.muted}>{t('details.worktree.removed')}</p>}
            {snapshot.patrolIssue.diff !== null && <details className={css.diffEvidence} open>
              <summary>{t('details.diff')} · {snapshot.patrolIssue.diff.stat}</summary>
              <pre>{snapshot.patrolIssue.diff.patch}</pre>
            </details>}
            {snapshot.patrolIssue.reviews.map(review => <article className={css.reviewCard} key={review.attemptId}>
              <header><strong>{t(`details.review.${review.verdict}`)}</strong><time>{new Date(review.createdAt).toLocaleString()}</time></header>
              <p>{review.findings}</p>
              {review.verification.length > 0 && <p><strong>{t('details.verification')}</strong> {review.verification.join(' · ')}</p>}
              {review.risks.length > 0 && <p><strong>{t('details.risks')}</strong> {review.risks.join(' · ')}</p>}
              <code>{review.reviewedCommit}</code>
            </article>)}
          </section>
        )}

        {issue.status === 'in_review' && (
          <section className={css.humanReview}>
            <span className={css.eyebrow}>{t('details.humanReview')}</span>
            <h2>{t('details.reviewTitle')}</h2>
            <p>{t('details.reviewBody')}</p>
            <textarea rows={3} placeholder={t('details.reviewReason')} value={reviewReason} onChange={(event) => { setReviewReason(event.target.value) }} />
            <div className={css.buttonRow}>
              <button type="button" className={css.secondaryButton} disabled={reviewReason.trim() === ''} onClick={() => { void updateIssue(issue, { status: 'todo', reason: reviewReason.trim() }) }}>{t('details.requestChanges')}</button>
              <button type="button" className={css.primaryButton} onClick={() => { void updateIssue(issue, { status: 'done' }) }}>{t('details.markDone')}</button>
            </div>
          </section>
        )}

        {issue.status === 'todo' && issue.assignee !== 'user' && (
          <button type="button" className={css.secondaryButton} onClick={() => { void runPatrol(issue.id) }}><IconPlayOutline16 />{t('details.runIssue')}</button>
        )}

        <section className={css.detailSection}>
          <h2>{t('details.relations')}</h2>
          {snapshot.relations.map((relation) => {
            const related = snapshot.issues.find(candidate => candidate.id === relation.relatedIssueId)
            return <div className={css.relationRow} key={relation.id}><span><IconLinkOutline16 />{t(`relation.${relation.type}`)} <strong>{related?.identifier ?? relation.relatedIssueId}</strong></span><button type="button" className={css.ghostButton} onClick={() => { void removeRelation(relation) }}>{t('details.relation.remove')}</button></div>
          })}
          <form className={css.relationForm} onSubmit={(event) => {
            event.preventDefault()
            const reference = relationReference.trim()
            if (reference === '') return
            void addRelation(relationType, reference as IssueReference).then((result) => { if (result.ok) setRelationReference('') })
          }}>
            <select value={relationType} onChange={(event) => { setRelationType(event.target.value as IssueRelationType) }}><option value="blocked_by">{t('relation.blocked_by')}</option><option value="blocks">{t('relation.blocks')}</option></select>
            <input aria-label={t('details.relation.reference')} placeholder={t('details.relation.reference')} value={relationReference} onChange={(event) => { setRelationReference(event.target.value) }} />
            <button type="submit" className={css.iconButton} aria-label={t('details.relation.add')}><IconLinkOutline16 /></button>
          </form>
        </section>

        <section className={css.detailSection}>
          <h2>{t('details.activity')}</h2>
          {snapshot.activities.length === 0 ? <p className={css.muted}>{t('details.activity.empty')}</p> : <div className={css.timeline}>{snapshot.activities.map(item => <article className={css.timelineItem} key={item.id}><header><strong>{item.actor.name}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></header><p>{item.changes.map(change => change.field).join(', ')}</p></article>)}</div>}
        </section>

        {snapshot.detailError !== null && <p className={css.inlineError} role="alert">{snapshot.detailError}</p>}
        {snapshot.actionError !== null && <p className={css.inlineError} role="alert">{snapshot.actionError}</p>}
        <button type="button" className={css.archiveButton} onClick={() => { void archiveIssue(issue).then((result) => { if (result.ok) close() }) }}><IconArchiveOutline20 />{t('details.archive')}</button>
      </div>
    </aside>
  )
}

/** Format attachment sizes without implying decimal storage limits. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}
