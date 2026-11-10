/** What a step leaves behind, as a person reads it: a builder's hand-back, a reviewer's verdict, the checks. */
import { CircleCheck, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Check, Finding, Handback } from "./types.ts";

const List = ({ title, items }: { title: string; items?: string[] }) => !items?.length ? null : (
  <div><p className="text-xs font-medium text-muted-foreground">{title}</p><ul className="mt-1 list-disc space-y-1 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
);

export const HandbackCard = ({ handback }: { handback: Handback }) => (
  <div className="space-y-3 rounded-lg border p-3 text-sm">
    <p className="flex items-center gap-2 font-medium"><Badge variant="secondary">{handback.ask ? "Asked a question" : "Handed back"}</Badge></p>
    {handback.ask && <p>{handback.ask.text}</p>}
    {handback.submit?.note && <p className="leading-relaxed">{handback.submit.note}</p>}
    <List title="Done" items={handback.handover?.done} />
    <List title="Left" items={handback.handover?.left} />
    <List title="Decisions" items={handback.handover?.decisions} />
    <List title="Where" items={handback.handover?.where} />
  </div>
);

export const FindingCard = ({ finding }: { finding: Finding }) => (
  <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm">
    <p className="flex flex-wrap items-center gap-2">
      {finding.id && <span className="font-mono text-xs font-medium">{finding.id}</span>}
      <Badge variant="outline" className="border-amber-600/40 text-amber-700">{finding.severity}</Badge>
      {finding.where && <span className="font-mono text-xs text-muted-foreground">{finding.where.path}{finding.where.line ? `:${finding.where.line}` : ""}</span>}
    </p>
    <p className="mt-1.5 leading-relaxed">{finding.text}</p>
  </div>
);

export const VerdictCard = ({ review }: { review: { verdict: string; findings: Finding[]; fixed?: string[] } }) => (
  <div className="space-y-3 rounded-lg border p-3 text-sm">
    <p className="flex items-center gap-2 font-medium">
      {review.verdict === "approve" ? <Badge variant="secondary"><CircleCheck /> Approved</Badge> : <Badge variant="outline" className="border-amber-600/40 text-amber-700">Asked for changes</Badge>}
      <span className="text-muted-foreground">{review.findings.length === 0 ? "No findings" : `${review.findings.length} finding${review.findings.length === 1 ? "" : "s"}`}{review.fixed?.length ? ` · ${review.fixed.length} marked fixed` : ""}</span>
    </p>
    {review.findings.map((f, i) => <FindingCard key={i} finding={f} />)}
  </div>
);

export const ChecksList = ({ checks }: { checks: Check[] }) => (
  <div className="divide-y rounded-lg border text-sm">
    {checks.map((c) => (
      <Collapsible key={c.name} defaultOpen={!c.ok}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50">
          {c.ok ? <CircleCheck className="size-4 text-muted-foreground" /> : <CircleX className="size-4 text-amber-600" />}
          <span className="flex-1 font-medium">{c.name}</span>
          <span className={c.ok ? "text-xs text-muted-foreground" : "text-xs font-medium text-amber-700"}>{c.ok ? "pass" : "FAIL"}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3"><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-72">{c.tail}</CodeBlockContent></CodeBlock></CollapsibleContent>
      </Collapsible>
    ))}
  </div>
);
