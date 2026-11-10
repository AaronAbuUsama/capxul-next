/**
 * What an agent showed for what it said. Each capture is drawn as what it is (a recording of a terminal, a screenshot, a
 * recording of steps in the browser) with two things beside it that are kept apart: what the agent says it shows, and what the loop
 * itself recorded about how it was made. A claim that names no capture is listed as thrown out, with why.
 */
import { CircleAlert, CircleCheck, Film, Image as ImageIcon, SquareTerminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clock, duration } from "./format.ts";
import { fileUrl } from "./live.ts";
import { href } from "./router.ts";
import type { Capture, Run, Shown } from "./types.ts";

const KIND: Record<Capture["kind"], { label: string; Icon: typeof Film }> = {
  terminal: { label: "Terminal recording", Icon: SquareTerminal }, screenshot: { label: "Screenshot", Icon: ImageIcon }, "screen-recording": { label: "Screen recording", Icon: Film },
};
const size = (bytes: number): string => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`);

/** The capture itself: a picture or a video from the host. A replay has no host, so it says what would be here. */
export const Media = ({ run, capture, className }: { run: Run; capture: Capture; className?: string }) => {
  const file = capture.files[0], url = file && !run.replay ? fileUrl(run.id, file.name) : null;
  if (!file || !url) return <p className={cn("grid place-items-center bg-neutral-950 p-6 text-xs text-neutral-500", className)}>{file ? "the file is with the loop's host" : "no file was kept"}</p>;
  return file.type.startsWith("video/")
    ? <video className={cn("w-full bg-neutral-950", className)} src={url} controls playsInline preload="metadata" />
    : <a href={url} target="_blank" rel="noreferrer" className={cn("block bg-neutral-950", className)}><img className="mx-auto max-h-[70vh] w-auto max-w-full" src={url} alt={capture.id} loading="lazy" /></a>;
};

/** What the loop wrote down when the capture was made: the command and how it ended, or the page. */
const Recorded = ({ capture }: { capture: Capture }) => "command" in capture.source ? (
  <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
    <span className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5">$ {capture.source.command}</span>
    <Badge variant="outline" className={capture.source.exit === 0 ? "" : "border-amber-600/40 text-amber-700"}>exit {capture.source.exit}</Badge>
  </p>
) : (
  <p className="min-w-0 text-xs break-all"><span className="font-medium">{capture.source.title || "a page"}</span> <span className="font-mono text-muted-foreground">{capture.source.url}</span></p>
);

const Card = ({ run, shown }: { run: Run; shown: Shown }) => {
  const { capture, claim } = shown;
  if (!capture) return (
    <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-amber-800"><CircleAlert className="size-4" /> Thrown out <span className="font-mono text-xs font-normal">{claim?.capture || "(no name)"}</span></p>
      <p className="mt-1">{claim?.why}.</p>
      {claim?.shows && <p className="mt-1 text-muted-foreground">The agent said it shows: “{claim.shows}”</p>}
    </div>
  );
  const kind = KIND[capture.kind], bad = claim && !claim.ok;
  return (
    <figure className="overflow-hidden rounded-lg border">
      <Media run={run} capture={capture} />
      <figcaption className="space-y-2.5 p-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary"><kind.Icon /> {kind.label}</Badge>
          <span className="font-mono text-xs">{capture.id}</span>
          {claim?.eval && <Badge variant="outline" className="font-mono">{claim.eval}</Badge>}
        </p>
        <div>
          <p className="text-xs font-medium text-muted-foreground">The agent says it shows</p>
          {claim ? <p className={cn("leading-relaxed", bad && "text-amber-800")}>{claim.shows || "(nothing)"}{bad ? ` — thrown out: ${claim.why}` : ""}</p> : <p className="text-muted-foreground">Nothing: it made this capture and did not name it in its answer.</p>}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">The loop recorded</p>
          <Recorded capture={capture} />
        </div>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{clock(capture.at)}</span>{capture.ms > 0 && <span>took {duration(capture.ms)}</span>}
          {capture.files.map((f) => <a key={f.name} className="underline underline-offset-2 hover:text-foreground" href={run.replay ? undefined : fileUrl(run.id, f.name)} target="_blank" rel="noreferrer" title={`sha256 ${f.sha256}`}>{f.name.split(".").at(-1)} · {size(f.bytes)}</a>)}
        </p>
      </figcaption>
    </figure>
  );
};

/** A step's evidence, whole. */
export const EvidenceView = ({ run, title, by, shown }: { run: Run; title: string; by: string; shown: Shown[] }) => {
  const stands = shown.filter((s) => s.capture && s.claim?.ok).length, out = shown.filter((s) => s.claim && !s.claim.ok).length;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CircleCheck className="size-3.5" /> {stands} shown</span>
            {out > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><CircleAlert className="size-3.5" /> {out} thrown out</span>}
            <a className="underline underline-offset-2 hover:text-foreground" href={href("runs", run.id, by.replace(/\.agent$/, ""))}>open the conversation</a>
          </p>
        </div>
        {shown.map((s, i) => <Card key={s.capture?.id ?? `claim-${i}`} run={run} shown={s} />)}
      </div>
    </div>
  );
};

/** Small pictures of a run's captures, each a link to its step's evidence. */
export const EvidenceStrip = ({ run }: { run: Run }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {(run.captures ?? []).map((c) => {
      const kind = KIND[c.kind];
      return (
        <a key={c.id} href={href("runs", run.id, `evidence.${c.by}`)} className="overflow-hidden rounded-lg border hover:border-foreground/30">
          {run.replay || !c.files[0]?.type.startsWith("image/") ? <p className="grid aspect-video place-items-center bg-neutral-950 text-neutral-500"><kind.Icon className="size-6" /></p> : <img className="aspect-video w-full bg-neutral-950 object-cover object-left-top" src={fileUrl(run.id, c.files[0]?.name ?? "")} alt={c.id} loading="lazy" />}
          <p className="truncate px-2 py-1.5 font-mono text-xs">{c.id}</p>
        </a>
      );
    })}
  </div>
);
