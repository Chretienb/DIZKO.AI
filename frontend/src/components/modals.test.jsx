import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ModalProject, ModalNewProject, ModalAccountSettings, ModalBilling,
  ModalKeyboardShortcuts, ModalInvite, ModalMessage, ModalViewWork,
  ModalNewTrack, ModalUpload, Modal, ModalSuccess,
} from './modals.jsx'

// ── Mock the network layer so modals mount without hitting a backend ──────────
const ok = (data = []) => Promise.resolve({ data, error: null, status: 200 })
vi.mock('../lib/api', () => ({
  projects:       { list: () => ok([]), get: () => ok(null), create: () => ok(null), uploadCover: () => ok(null) },
  files:          { list: () => ok([]) },
  collaborators:  { listByProject: () => ok([]), listAll: () => ok([]) },
  invitations:    { list: () => ok([]) },
  messagesApi:    { conversation: () => ok([]), send: () => ok(null) },
  auth:           { updateProfile: () => ok(null), uploadAvatar: () => ok(null), updatePassword: () => ok(null) },
  accessRequests: { list: () => ok([]) },
  billingApi:     { status: () => ok({}), checkout: () => ok({}), portal: () => ok({}) },
  foldersApi:     { create: () => ok(null) },
  cacheBust:      () => {},
}))
vi.mock('../lib/supabase', () => ({
  supabase: { channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }), removeChannel: () => {} },
  uploadStem: () => ok(null),
  setSupabaseToken: () => {},
}))

const user    = { id: 'u1', full_name: 'Test User', email: 'test@dizko.ai' }
const project = { id: 'p1', title: 'FIREMAN', type: 'Album', status: 'Draft', owner_id: 'u1' }
const collab  = { id: 'c1', user_id: 'u2', role: 'Collaborator', user: { full_name: 'Jane Doe', email: 'jane@dizko.ai' } }
const noop = () => {}

beforeEach(() => vi.clearAllMocks())

// The headline guarantee: every modal mounts without throwing.
// (This is exactly what would have caught the "collabName is not defined" crash.)
describe('modals mount without crashing', () => {
  const cases = [
    ['ModalNewProject',       <ModalNewProject onClose={noop} onCreated={noop} />],
    ['ModalProject',          <ModalProject project={project} onClose={noop} openModal={noop} playTrack={noop} nowPlaying={null} user={user} />],
    ['ModalAccountSettings',  <ModalAccountSettings user={user} onClose={noop} onProfileUpdate={noop} />],
    ['ModalBilling',          <ModalBilling onClose={noop} billingStatus={null} billingLoaded={true} />],
    ['ModalKeyboardShortcuts',<ModalKeyboardShortcuts onClose={noop} />],
    ['ModalInvite',           <ModalInvite onClose={noop} />],
    ['ModalMessage',          <ModalMessage collab={collab} onClose={noop} currentUserId="u1" />],
    ['ModalViewWork',         <ModalViewWork collab={collab} onClose={noop} playTrack={noop} />],
    ['ModalNewTrack',         <ModalNewTrack project={project} onClose={noop} onCreated={noop} />],
    ['ModalUpload',           <ModalUpload project={project} folderId={null} onClose={noop} user={user} />],
  ]
  it.each(cases)('%s renders', (_name, element) => {
    expect(() => render(element)).not.toThrow()
  })
})

describe('Modal shell', () => {
  it('renders title and subtitle', () => {
    render(<Modal title="Hello" sub="World" onClose={noop}><div>body</div></Modal>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('World')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('ModalSuccess shows its message', () => {
    render(<ModalSuccess title="Done!" body="All set" onClose={noop} />)
    expect(screen.getByText('Done!')).toBeInTheDocument()
  })
})

describe('ModalNewProject', () => {
  it('shows the form fields', () => {
    render(<ModalNewProject onClose={noop} onCreated={noop} />)
    expect(screen.getByText('New Project')).toBeInTheDocument()
    expect(screen.getByText(/Create Project/i)).toBeInTheDocument()
  })
})
