import {
  Server,
  Database,
  Folder,
  Table2,
  Layers,
  Cog,
  SquareFunction,
  Columns3,
  KeyRound,
  Link2,
  ListOrdered,
  SquareCheck,
  Zap,
  CornerUpRight,
  AtSign,
  Braces,
  Hash,
  User,
  Users,
  Box
} from 'lucide-react'

const wrap = (color: string): React.CSSProperties => ({ marginRight: 5, flexShrink: 0, color })

export const Icons = {
  server: <Server size={14} style={wrap('#c8a83a')} />,
  database: <Database size={14} style={wrap('#e8c15c')} />,
  folder: <Folder size={14} style={wrap('#dcb67a')} />,
  table: <Table2 size={14} style={wrap('#6ea1d8')} />,
  view: <Layers size={14} style={wrap('#8ec7eb')} />,
  proc: <Cog size={14} style={wrap('#d8a45c')} />,
  tvf: <SquareFunction size={14} style={wrap('#b18ce0')} />,
  scalar: <SquareFunction size={14} style={wrap('#b18ce0')} />,
  column: <Columns3 size={14} style={wrap('#9db4c8')} />,
  key: <KeyRound size={14} style={wrap('#e8c15c')} />,
  fk: <Link2 size={14} style={wrap('#9db4c8')} />,
  index: <ListOrdered size={14} style={wrap('#9db4c8')} />,
  constraint: <SquareCheck size={14} style={wrap('#c8a83a')} />,
  trigger: <Zap size={14} style={wrap('#e07f7f')} />,
  synonym: <CornerUpRight size={14} style={wrap('#8ec7eb')} />,
  param: <AtSign size={14} style={wrap('#7fb8e0')} />,
  type: <Braces size={14} style={wrap('#b18ce0')} />,
  sequence: <Hash size={14} style={wrap('#4cbb5f')} />,
  user: <User size={14} style={wrap('#c8c8c8')} />,
  role: <Users size={14} style={wrap('#c8c8c8')} />,
  schema: <Box size={14} style={wrap('#dcb67a')} />
}
