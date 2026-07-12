import { ProgressRing } from './index.jsx'

export default {
  title: 'Dizko UI/ProgressRing',
  component: ProgressRing,
  parameters: { layout: 'centered' },
  args: { pct: 65, size: 64, stroke: 4, color: '#6D5AE6', bg: '#ECECEF' },
  argTypes: {
    pct: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    size: { control: { type: 'range', min: 32, max: 120, step: 4 } },
    color: { control: 'color' },
  },
}

export const Default = {
  args: {
    children: <span style={{ fontSize: 14, fontWeight: 800, color: '#1C1C1E' }}>65%</span>,
  },
}

export const Full = {
  args: { pct: 100, color: '#3CDA6F', children: (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#3CDA6F" strokeWidth={3} strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>
  ) },
}

export const Stages = {
  render: () => (
    <div style={{ display: 'flex', gap: 20 }}>
      {[20, 50, 80, 100].map(p => (
        <ProgressRing key={p} pct={p} size={56} stroke={4} color="#6D5AE6" bg="#ECECEF">
          <span style={{ fontSize: 12, fontWeight: 800, color: '#1C1C1E' }}>{p}%</span>
        </ProgressRing>
      ))}
    </div>
  ),
}
