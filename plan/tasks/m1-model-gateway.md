## What
Run the loop's model calls through CLIProxyAPI directly, with no LiteLLM in between. Configure it as it is first: routing.session-affinity on so one agent conversation stays on one account and the prompt cache holds; the loop sends a session id per run and agent; retries and cooldowns across accounts; paid API keys added as upstreams beside the subscription accounts. The loop gets a cap on concurrent model calls and backs off when refused. Then ramp 3, 5, 8, 12 agents and record where it starts refusing. Fork only for what configuration cannot do, and write down what that was. Record the gateway as a component in the blueprint.
## Why
Seven agents at once made the LiteLLM container unreachable (57 of 57 errors were the edge's 504, none a rate limit), and three at once still hit it. Parallel agents are how the plan gets done, and swarms are the direction, so the gateway is a blocker we must own. Aaron ruled on 10 November: LiteLLM is out of the path; the gateway is CLI proxy, as it is, forked, or taken apart.
## Done when
- The loop runs with no LiteLLM in its path and each agent stays on one account for its life, shown by the gateway's own usage record
- A ramp test gives the number of agents the gateway holds, with the first refusal's cause
- The gateway is a component record with its accounts, limits and owner
