import { Spinner } from './index.jsx'

export default {
  title: 'Dizko UI/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' },
  args: { size: 28 },
  argTypes: {
    size: { control: { type: 'range', min: 12, max: 64, step: 2 } },
    color: { control: 'color' },
  },
}

// On-brand animated equalizer bars
export const Coral = { args: { size: 32, color: '#E95A51' } }
export const Purple = { args: { size: 32, color: '#7E77D0' } }
export const Green = { args: { size: 32, color: '#3CDA6F' } }

export const Sizes = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
      <Spinner size={16} color="#E95A51" />
      <Spinner size={28} color="#E95A51" />
      <Spinner size={44} color="#E95A51" />
    </div>
  ),
}
