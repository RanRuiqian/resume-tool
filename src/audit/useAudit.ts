import { useMemo } from 'react';
import { useApp } from '../store';
import { auditResume } from './factAudit';

export function useAuditSummary() {
  const { profile, resume } = useApp();
  return useMemo(() => (resume ? auditResume(profile, resume).summary : null), [profile, resume]);
}
