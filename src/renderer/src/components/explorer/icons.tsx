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
  server: <Server size={14} style={wrap('#fbbf24')} />,
  database: <Database size={14} style={wrap('#fcd34d')} />,
  folder: <Folder size={14} style={wrap('#8b97ad')} />,
  table: <Table2 size={14} style={wrap('#22d3ee')} />,
  view: <Layers size={14} style={wrap('#67e8f9')} />,
  proc: <Cog size={14} style={wrap('#c4b5fd')} />,
  tvf: <SquareFunction size={14} style={wrap('#a78bfa')} />,
  scalar: <SquareFunction size={14} style={wrap('#a78bfa')} />,
  column: <Columns3 size={14} style={wrap('#7e8ba1')} />,
  key: <KeyRound size={14} style={wrap('#fcd34d')} />,
  fk: <Link2 size={14} style={wrap('#7e8ba1')} />,
  index: <ListOrdered size={14} style={wrap('#7e8ba1')} />,
  constraint: <SquareCheck size={14} style={wrap('#fbbf24')} />,
  trigger: <Zap size={14} style={wrap('#fb7185')} />,
  synonym: <CornerUpRight size={14} style={wrap('#67e8f9')} />,
  param: <AtSign size={14} style={wrap('#38bdf8')} />,
  type: <Braces size={14} style={wrap('#a78bfa')} />,
  sequence: <Hash size={14} style={wrap('#34d399')} />,
  user: <User size={14} style={wrap('#8b97ad')} />,
  role: <Users size={14} style={wrap('#8b97ad')} />,
  schema: <Box size={14} style={wrap('#8b97ad')} />
}
