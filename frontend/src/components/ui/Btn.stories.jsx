import { Btn } from './index.jsx'

export default {
  title: 'Dizko UI/Button',
  component: Btn,
  parameters: { layout: 'centered' },
  args: { children: 'Open in Studio' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'ghost', 'danger'] },
    onClick: { action: 'clicked' },
  },
}

export const Primary = { args: { variant: 'primary', children: 'Play Mix' } }
export const Ghost   = { args: { variant: 'ghost',   children: 'Cancel' } }
export const Danger  = { args: { variant: 'danger',  children: 'Remove' } }

export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', gap: 10 }}>
      <Btn variant="primary">Play Mix</Btn>
      <Btn variant="ghost">Cancel</Btn>
      <Btn variant="danger">Remove</Btn>
    </div>
  ),
}
