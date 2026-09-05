import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { StatusTone } from '@/lib/palette';
import {
  ACTION_LABEL,
  RECOVERY_STATUS_LABEL,
  ROOT_CAUSE_LABEL,
  type RecoveryActionType,
  type RecoveryStatus,
  type RootCause,
} from '@/lib/api/types';

const RECOVERY_STATUS_TONE: Record<RecoveryStatus, StatusTone> = {
  FAILED: 'critical',
  CLASSIFIED: 'neutral',
  SCHEDULED: 'warning',
  RETRYING: 'warning',
  RECOVERED: 'good',
  HARD_STOPPED: 'critical',
  EXHAUSTED: 'serious',
  HUMAN_REVIEW: 'serious',
};

const RECOVERY_STATUS_ICON: Record<RecoveryStatus, typeof Clock> = {
  FAILED: XCircle,
  CLASSIFIED: HelpCircle,
  SCHEDULED: Clock,
  RETRYING: RefreshCw,
  RECOVERED: CheckCircle2,
  HARD_STOPPED: ShieldAlert,
  EXHAUSTED: AlertTriangle,
  HUMAN_REVIEW: UserCheck,
};

export function RecoveryStatusBadge({ status }: { status: RecoveryStatus | null }) {
  if (!status) return <Badge tone="neutral">—</Badge>;
  const Icon = RECOVERY_STATUS_ICON[status];
  return (
    <Badge tone={RECOVERY_STATUS_TONE[status]} icon={<Icon size={12} />}>
      {RECOVERY_STATUS_LABEL[status]}
    </Badge>
  );
}

const ACTION_TONE: Record<RecoveryActionType, StatusTone> = {
  RETRY: 'warning',
  WAIT: 'neutral',
  SWITCH_RAIL: 'warning',
  MESSAGE: 'neutral',
  HARD_STOP: 'critical',
  HUMAN_REVIEW: 'serious',
};

const ACTION_ICON: Record<RecoveryActionType, typeof Clock> = {
  RETRY: RefreshCw,
  WAIT: Clock,
  SWITCH_RAIL: ArrowLeftRight,
  MESSAGE: MessageSquare,
  HARD_STOP: ShieldAlert,
  HUMAN_REVIEW: UserCheck,
};

export function ActionBadge({ action }: { action: RecoveryActionType | null }) {
  if (!action) return <Badge tone="neutral">—</Badge>;
  const Icon = ACTION_ICON[action];
  return (
    <Badge tone={ACTION_TONE[action]} icon={<Icon size={12} />}>
      {ACTION_LABEL[action]}
    </Badge>
  );
}

export function RootCauseBadge({ cause }: { cause: RootCause | null }) {
  if (!cause) return <Badge tone="neutral">—</Badge>;
  return <Badge tone={cause === 'UNKNOWN' ? 'serious' : 'neutral'}>{ROOT_CAUSE_LABEL[cause]}</Badge>;
}
