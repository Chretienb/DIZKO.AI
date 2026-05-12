// ── API response envelope ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data: T | null
  error: string | null
  status: number
}

// ── Hono context variables ───────────────────────────────────────────────────

export type HonoUser = {
  id: string
  email?: string
  role?: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type HonoVariables = {
  user: HonoUser
  /** Sanitized, parsed request body for POST / PUT / PATCH routes */
  body: Record<string, unknown>
}

// ── Domain models ────────────────────────────────────────────────────────────

export interface Project {
  id: string
  title: string
  type: string
  notes: string
  status: string
  owner_id: string
  release_date?: string | null
  created_at: string
  updated_at: string
}

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
  notes?: string
  uploaded_by: string
  created_at: string
}

export interface Collaborator {
  id: string
  project_id: string
  user_id: string | null
  email: string
  role: string
  status: 'active' | 'pending'
  invited_by: string
  created_at: string
}
