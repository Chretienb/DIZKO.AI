/**
 * Role-Based Access Control for Dizko.ai
 *
 * Each collaborator role restricts which instrument types they can upload.
 * Owners bypass all restrictions.
 */

import { supabase } from './supabase'

/**
 * True if `userId` may access `projectId` (owner OR active collaborator).
 * The service-role client bypasses Postgres RLS, so every by-id route must
 * call this — there is no DB-level safety net.
 */
export async function assertProjectAccess(projectId: string, userId: string): Promise<boolean> {
  if (!projectId || !userId) return false
  const { data: project } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  if (!project) return false
  if ((project as any).owner_id === userId) return true

  const { data: collab } = await supabase
    .from('collaborators').select('id')
    .eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').maybeSingle()
  return !!collab
}

/** True only if userId is the project's owner (not just a collaborator). */
export async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
  if (!projectId || !userId) return false
  const { data: project } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  return (project as any)?.owner_id === userId
}

/**
 * Song scope for a user in a project: null = unrestricted (the owner, or a
 * collaborator with full access); an array = only these folder (song) ids.
 * Tolerates the folder_ids column not existing yet (migration 038) — scoping
 * simply stays off until it lands.
 */
export async function songScopeFor(projectId: string, userId: string): Promise<string[] | null> {
  if (!projectId || !userId) return null
  const { data: project } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  if ((project as any)?.owner_id === userId) return null
  const { data: collab, error } = await supabase
    .from('collaborators').select('folder_ids')
    .eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (error) return null
  const ids = (collab as any)?.folder_ids
  return Array.isArray(ids) && ids.length > 0 ? ids : null
}

/** Resolve the project id that owns a given stem, or null. */
export async function projectIdForStem(stemId: string): Promise<string | null> {
  const { data: stem } = await supabase
    .from('stems').select('track_id').eq('id', stemId).single()
  if (!(stem as any)?.track_id) return null
  const { data: track } = await supabase
    .from('tracks').select('project_id').eq('id', (stem as any).track_id).single()
  return (track as any)?.project_id ?? null
}

/**
 * Resolve everything a clip mutation needs to know about its stem in one
 * query: which project it belongs to (for access checks), which song/folder
 * it's grouped into (clips are placed on a per-song timeline, so track_index
 * is scoped per project+folder — see 035_clips.sql), and its notes (used to
 * skip take-history children / archived stems the same way the frontend's
 * mixerStems filter does). Returns null if the stem or its project can't be
 * resolved.
 */
export async function stemContext(stemId: string): Promise<{ projectId: string; folderId: string | null; notes: string | null } | null> {
  const { data: stem } = await supabase
    .from('stems')
    .select('folder_id, notes, tracks(project_id)')
    .eq('id', stemId)
    .maybeSingle()
  const projectId = (stem as any)?.tracks?.project_id
  if (!projectId) return null
  return { projectId, folderId: (stem as any).folder_id ?? null, notes: (stem as any).notes ?? null }
}

// Map role → allowed instrument types ('*' = unrestricted)
export const ROLE_INSTRUMENTS: Record<string, string[]> = {
  'Owner':        ['*'],
  'Collaborator': ['*'],           // general collaborator can upload anything
  'Vocalist':     ['vocals', 'harmony', 'recording'],
  'Guitarist':    ['guitar', 'recording'],
  'Drummer':      ['drums', 'percussion', 'recording'],
  'Producer':     ['beats', 'demo', 'recording', 'other'],
  'Engineer':     ['exports', 'finals', 'recording', 'other'],
  'Mixer':        ['exports', 'finals', 'recording', 'other'],
}

/** Returns true if the role allows uploading the given instrument type */
export function roleCanUpload(role: string, instrument: string): boolean {
  const allowed = ROLE_INSTRUMENTS[role] ?? []
  return allowed.includes('*') || allowed.includes(instrument)
}

/** Infer a human-readable role label from an instrument type */
export function instrumentToRoleHint(instrument: string): string {
  const map: Record<string, string> = {
    vocals:    'Vocalist',
    harmony:   'Vocalist',
    guitar:    'Guitarist',
    drums:     'Drummer',
    percussion:'Drummer',
    beats:     'Producer',
    demo:      'Producer',
    exports:   'Engineer / Mixer',
    finals:    'Engineer / Mixer',
  }
  return map[instrument] ?? 'Collaborator'
}
