# ProjectBible — Claude Instructions

## "Push" and "push live"
Vercel only builds a commit whose message contains `[deploy]` — see `ignoreCommand` in vercel.json. Every other push is backed up to GitHub and costs nothing. So there are two commands, and both run as a single Bash call — do not split into separate tool calls that each require approval.

When the user says **"push"** — save to GitHub, do not deploy:
```
git add -A && git commit -m "<concise message>" && git push
```

When the user says **"push live"** or **"deploy"** — same, with the marker appended so Vercel builds it:
```
git add -A && git commit -m "<concise message> [deploy]" && git push
```

To deploy something already pushed without the marker, a dashboard Redeploy will not work — it re-runs the ignore step against the same message. Make an empty commit instead:
```
git commit --allow-empty -m "deploy [deploy]" && git push
```

## Plans
Keep plans short and direct — no code blocks, no long explanations. State what currently exists and what the proposed change is. Example: "Icon is currently 16px, we could bump to 20px." One or two sentences per step max.
