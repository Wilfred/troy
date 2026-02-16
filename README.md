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

Eventually I'd like a second set of untrusted tools that can be used
by an isolated subagent.

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

Crucially, this does not allow any untrusted tool outputs to be
consumed by the trusted bot.
