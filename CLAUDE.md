# ProjectBible — Claude Instructions

## "Push" command
When the user says "push", run a single terminal command that stages all changes, commits with a concise message, and pushes to the remote:
```
git add -A && git commit -m "<concise message>" && git push
```
Do this in one Bash call — do not split into separate tool calls that each require approval.

## Plans
Keep plans short and direct — no code blocks, no long explanations. State what currently exists and what the proposed change is. Example: "Icon is currently 16px, we could bump to 20px." One or two sentences per step max.
