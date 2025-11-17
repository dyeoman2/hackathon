import type { VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { Crown, Scale, Shield, User } from 'lucide-react';
import { Badge, type badgeVariants } from '~/components/ui/badge';

type HackathonRole = 'owner' | 'admin' | 'judge' | 'contestant';

interface HackathonRoleBadgeProps {
  role: HackathonRole;
  className?: string;
}

type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

const roleConfig = {
  owner: {
    label: 'Owner',
    variant: 'primary-subtle' as BadgeVariant,
    icon: Crown,
  },
  admin: {
    label: 'Admin',
    variant: 'secondary' as BadgeVariant,
    icon: Shield,
  },
  judge: {
    label: 'Judge',
    variant: 'warning' as BadgeVariant,
    icon: Scale,
  },
  contestant: {
    label: 'Contestant',
    variant: 'outline' as BadgeVariant,
    icon: User,
  },
} satisfies Record<HackathonRole, { label: string; variant: BadgeVariant; icon: LucideIcon }>;

export function HackathonRoleBadge({ role, className }: HackathonRoleBadgeProps) {
  const config = roleConfig[role];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={className}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
