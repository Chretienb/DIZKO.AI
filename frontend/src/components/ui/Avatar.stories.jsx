import { Avatar } from './index.jsx'

export default {
  title: 'Dizko UI/Avatar',
  component: Avatar,
  parameters: { layout: 'centered' },
  args: { name: 'Oswald Venus', size: 48 },
  argTypes: {
    size: { control: { type: 'range', min: 24, max: 96, step: 4 } },
    color: { control: 'color' },
  },
}

export const Initials = {}

export const Large = { args: { name: 'Chretien Banza', size: 72, color: '#7E77D0' } }

export const FromImage = {
  args: { name: 'Drake', url: 'https://i.pravatar.cc/120?img=12', size: 56 },
}

export const Row = {
  render: () => (
    <div style={{ display: 'flex', gap: 10 }}>
      <Avatar name="Oswald Venus" size={44} color="#6D5AE6" />
      <Avatar name="Chretien Banza" size={44} color="#7E77D0" />
      <Avatar name="Noah Shebib" size={44} color="#3CDA6F" />
      <Avatar name="Boi 1da" size={44} color="#EA9F1E" />
    </div>
  ),
}
