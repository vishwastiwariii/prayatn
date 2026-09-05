import { Card, CardHeader } from '@/components/ui/card';
import { RootCauseBadge } from '@/components/payments/status-badges';
import type { PaymentDetail } from '@/lib/api/payments';
import type { ClassificationSource } from '@/lib/api/types';
import { AISourceBadge } from '@/components/ui/ai-source-badge';

const SOURCE_LABEL: Record<ClassificationSource, string> = {
  RULE: 'Deterministic rules',
  HUMAN: 'Human reviewer',
  LLM_SUGGESTION: 'AI suggestion',
};

export function ClassificationCard({
  classification,
}: {
  classification: PaymentDetail['failures'][number]['classifications'][number];
}) {
  const isSuggestion = classification.source === 'LLM_SUGGESTION';

  return (
    <Card>
      <CardHeader
        title={isSuggestion ? 'AI suggestion' : 'Root cause'}
        subtitle={
          isSuggestion
            ? 'A suggestion only — never the official classification'
            : 'This is where the deterministic / AI boundary is drawn'
        }
      />
      <div className="space-y-3 p-4 text-sm">
        {isSuggestion && (
          <div className="flex justify-end">
            <AISourceBadge source="AI" />
          </div>
        )}
        <div className="flex items-center justify-between">
          <RootCauseBadge cause={classification.cause} />
          <span className="font-semibold tabular-nums text-text-primary">
            {Math.round(classification.confidence * 100)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Classified by</span>
          <span className="font-medium text-text-secondary">{SOURCE_LABEL[classification.source]}</span>
        </div>
        {classification.ruleId && (
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Rule</span>
            <span className="font-mono text-text-secondary">{classification.ruleId}</span>
          </div>
        )}
        {classification.evidence.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Evidence</p>
            <ul className="mt-1 space-y-0.5">
              {classification.evidence.map((e, i) => (
                <li key={i} className="font-mono text-[11px] text-text-secondary">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
        {classification.explanation && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Why?</p>
            <p className="mt-0.5 text-text-secondary">{classification.explanation}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
