/**
 * SPIKE. The one object a client attaches to: an agent's conversation as a view that updates, plus send and stop.
 * Both ends build it from their own copy of Chord, so the contract is a function of Chord's builders.
 */
interface Chord { remote: (name: string, spec: never) => unknown; hostNamed: (name: string) => unknown; method: (...a: never[]) => unknown }
interface Schema { obj: (shape: never) => unknown; str: () => unknown; num: () => unknown; unknown: () => unknown }

export const agentContract = <T>(chord: Chord, s: Schema): T => chord.remote("loop.agent", {
  version: 1, input: s.obj({ run: s.str(), agent: s.str() } as never), host: chord.hostNamed("loop"),
  variants: { participant: { state: { view: s.unknown() }, methods: { send: chord.method(s.obj({ text: s.str(), whenBusy: s.str() } as never) as never, s.obj({ submission: s.num() } as never) as never), stop: chord.method() } } },
} as never) as T;

export const SPIKE_PORT = 4394;
