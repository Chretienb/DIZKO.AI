// Shared domain types for the Dizko frontend.
// Mirrors backend/src/types/index.ts so API calls are typed end-to-end.
// Consumed via JSDoc in .js/.jsx files (see api.js) and by tsc through jsconfig.json.

/** Every backend response has this envelope. `data` is the typed payload. */
export interface ApiResponse<T = unknown> {
  data: T | null
  error: string | null
  status: number
}

export interface Project {
  id: string
  title: string
  type: string
  notes: string
  status: string
  owner_id: string
  cover_url?: string | null
  release_date?: string | null
  created_at: string
  updated_at: string
}

/** A stem / uploaded audio file. */
export interface FileRecord {
  id: string
  project_id?: string
  track_id?: string
  original_name: string
  suggested_name: string
  file_url: string
  storage_path: string
  file_size: number
  mime_type: string
  instrument?: string
  /** JSON blob (bpm, key, peaks, liked_by, approved, parent_stem_id, …). */
  notes?: string
  uploaded_by: string
  created_at: string
}

export interface CollaboratorUser {
  id: string | null
  email: string
  full_name: string | null
  avatar_url: string | null
}

export interface Collaborator {
  id: string
  project_id: string
  user_id: string | null
  email?: string
  role: string
  status: 'active' | 'pending' | 'accepted'
  /** Enriched by the API: resolved user profile. */
  user?: CollaboratorUser
  /** Enriched by /collaborators/all: the project this row belongs to. */
  projectTitle?: string | null
  _isOwner?: boolean
  created_at?: string
}

export interface Folder {
  id: string
  project_id: string
  name: string
  created_by: string
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: string
  title?: string
  message?: string
  action_url?: string
  read: boolean
  created_at: string
}
