import React, { useEffect, useRef, useState } from 'react'
import { DotsHorizontal } from '@openai/apps-sdk-ui/components/Icon'
import { ChevronRightIcon } from './Icons.jsx'
import { ArtifactThumbnail } from './ArtifactThumbnail.jsx'

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ArtifactCard({ artifact, shared, storage, onOpen, canImport = false, onImport }) {
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef(null)
  const press = useRef(null)
  const suppressClick = useRef(false)
  const actionRef = useRef(null)
  const menuButton = useRef(null)
  function cancelPress() { clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (menu) actionRef.current?.focus() }, [menu])
  useEffect(() => { if (!canImport) setMenu(false) }, [canImport])
  function openMenu(event) {
    if (!canImport) return
    event.preventDefault()
    suppressClick.current = true
    cancelPress()
    setMenu(true)
  }
  async function addToProjects() {
    setBusy(true)
    setError('')
    try { await onImport(); setMenu(false) }
    catch (cause) { setError(cause.message || 'Could not add this page. Try again.') }
    finally { setBusy(false) }
  }
  const version = Number(artifact.current_version) || 1
  return (
    <article className="af-card" onContextMenu={openMenu}
      onKeyDown={event => {
        if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(false); menuButton.current?.focus() }
      }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !busy) setMenu(false) }}
    >
      <ArtifactThumbnail artifact={artifact} storage={storage} />
      <div className="af-card-body">
        <span className="af-card-main">
          <span className="af-card-topline">
            <span className="af-card-title">{artifact.title || 'Untitled artifact'}</span>
            {shared && <span className="af-badge af-badge-shared">Shared</span>}
          </span>
          {artifact.description && <span className="af-card-description">{artifact.description}</span>}
          <span className="af-card-meta">
            <span className="af-chip">v{version}</span>
            <span>{formatDate(artifact.updated_at || artifact.created_at)}</span>
          </span>
        </span>
        <span className="af-card-chevron" aria-hidden="true"><ChevronRightIcon size={18} /></span>
      </div>
      <button
        type="button"
        className="af-card-open"
        onPointerDown={event => {
          suppressClick.current = false
          if (!canImport || event.pointerType === 'mouse') return
          press.current = { x: event.clientX, y: event.clientY }
          cancelPress()
          timer.current = setTimeout(() => { suppressClick.current = true; setMenu(true) }, 550)
        }}
        onPointerMove={event => {
          if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress()
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return }
          onOpen(artifact.id)
        }}
        aria-label={`Open ${artifact.title || 'artifact'}, version ${version}`}
      />
      {canImport && <>
        <button type="button" className="af-card-options" ref={menuButton}
          aria-label={`Actions for ${artifact.title || 'page'}`} aria-expanded={menu}
          onClick={() => setMenu(value => !value)}>
          <DotsHorizontal width={20} height={20} />
        </button>
        {menu && <div className="af-card-actions" aria-label="Page actions">
          <button type="button" ref={actionRef} disabled={busy} onClick={addToProjects}>
            {busy ? 'Adding…' : 'Add to Projects'}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>}
      </>}
    </article>
  )
}
