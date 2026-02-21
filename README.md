<img src="img/no_trojans.webp" width="150" align="right">

# troy

Troy is an experiment in an agentic helper bot that has personal
context. It tries to solve the lethal trifecta by only dealing with
trusted input.

## Trifecta: Avoid Untrusted Input

By default, Troy only consumes input from trusted sources. It only
receives input from trusted users, and only runs tools that will
output trusted content (e.g. my personal calendar).

## Trifecta: Subagent For Untrusted Inputs

Untrusted tools (web search, web fetch) are only available to an
isolated subagent. The trusted bot delegates to it via a
`delegate_to_untrusted` tool, and the subagent runs in a fresh
context with no access to conversation history or personal data.
Its response is returned directly to the user — never fed back
into the trusted bot's messages.

```
User:
  Suggest things to do on my May holiday.

Trusted bot:
  Tool: Calendar search
    Result: Holiday in Paris

  Subagent Prompt: Find things to do in Paris.
    Untrusted tool: Web Search
      ...
    Untrusted tool: Web Search
      ...

    Subagent Output: (shown to user)
      How about the Eiffel tower?
```

This ensures untrusted tool outputs are never consumed by the
trusted bot.

## Further Reading

Blog posts discussing the lethal trifecta and potential solutions:

- [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — Simon Willison's original post coining the term: the combination of private data access, untrusted content, and external communication creates an exploitable vulnerability in AI agents.
- [Agentic AI and Security](https://martinfowler.com/articles/agentic-ai-security.html) — Martin Fowler's overview of security challenges in agentic AI, including the lethal trifecta, with practical mitigation patterns.
- [How to Solve the Lethal Trifecta in AI Agents](https://www.cyera.com/blog/the-lethal-trifecta-why-ai-agents-require-architectural-boundaries) — Cyera's argument that guardrails aren't enough and agents need architectural boundaries like dual-LLM patterns and sandboxing.
- [Does the "lethal trifecta" kill the idea of fully autonomous AI Agents anytime soon?](https://blog.robbowley.net/2025/09/08/does-the-lethal-trifecta-kill-the-idea-of-fully-autonomous-ai-agents-anytime-soon/) — Rob Bowley explores whether the trifecta fundamentally limits fully autonomous agents.
- [Understanding the Lethal Trifecta of AI Agents](https://www.osohq.com/learn/lethal-trifecta-ai-agent-security) — Oso's take on using authorization and least privilege to mitigate the trifecta.
- [Testing AI's "Lethal Trifecta" with Promptfoo](https://www.promptfoo.dev/blog/lethal-trifecta-testing/) — Practical guide to testing whether your agent is vulnerable to trifecta attacks.
- [How the Lethal Trifecta Expose Agentic AI](https://www.hiddenlayer.com/research/the-lethal-trifecta-and-how-to-defend-against-it) — HiddenLayer's research on real-world trifecta exploits and defense strategies.
- [Living With the Lethal Trifecta: A Guide to Personal AI Agent Security](https://hackernoon.com/living-with-the-lethal-trifecta-a-guide-to-personal-ai-agent-security) — Practical guide for personal AI agent security, directly relevant to projects like Troy.
