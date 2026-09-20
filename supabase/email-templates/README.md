# Auth email templates

Supabase renders these and hands the finished message to Resend over SMTP.
Nothing here is read at runtime — the dashboard holds the live copy, and these
files are the version-controlled original, because dashboard content is
otherwise recorded nowhere.

## Getting a change live

Supabase dashboard → **Authentication → Emails → Templates**, pick the
template, paste the whole `.html` file into the message body, **Save**. There
is no import; it is a paste each time.

| File | Dashboard template |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset password |
| `magic-link.html` | Magic link (only if magic links get turned on) |

The `.txt` files are the plain-text alternates for the same three, for clients
that refuse HTML.

**Reply-To** is set per template in the dashboard's Reply-To field, pointing at
a Namecheap alias (`hello@hexapla.app`), so replies reach a real inbox rather
than the `send.hexapla.app` sending subdomain, which has no mailbox.

## Previewing a change

`{{ .ConfirmationURL }}` is Supabase's placeholder and is not valid HTML to a
browser. To look at one locally, copy the file, replace that token with any
URL, and open it.

## Things that will break if changed carelessly

- **The gem** is loaded from `https://hexapla.app/pb-gem.png`, and the
  wordmark from `https://hexapla.app/email/hexapla-wordmark.png`. Both must
  stay served from the live app; an email cannot carry a local file path. The
  `email/` folder is excluded from the service-worker precache in
  `vite.config.ts` — only mail clients ever fetch it.
- **The wordmark is an image, not a webfont.** Gmail's web and Android
  clients strip `<link>` webfonts, so Fredericka the Great as live text would
  have fallen back to a plain serif for most people receiving these. The
  rendered PNG cannot be substituted by any client. Its `alt` is "Hexapla", so
  a client with images turned off still reads the name.
- **Inline styles and tables only.** A `<style>` block and flexbox are both
  widely stripped or ignored by mail clients. There is one `<style>` here, an
  mso conditional, which is the accepted way to reach Outlook.
- **The NET footer** is a licence condition, not decoration. NET may be quoted
  freely in a free app provided the quotation is followed by `(NET)` and, where
  there is internet access, those letters link to netbible.org. Both the verse
  credit and the footer line satisfy that; do not trim them.

## Checking delivery

**Resend → Logs** lists every message with delivered / bounced / spam. If an
email does not arrive, look there before touching code — it shows whether
Supabase even handed the message over.

## Regenerating the wordmark

`apps/pwa-polished/public/email/hexapla-wordmark.png` is Fredericka the Great
set in the app's gold `#e6b84a`, rendered at 2x (380×121 px) and declared in
the templates at 190×60. The source face is the same one Tutorial Mode ships,
`apps/pwa-polished/public/fonts/tutorial/fredericka-the-great-400.woff2`;
Pillow cannot read woff2, so regenerating it means taking the TTF from the
Google Fonts CSS at
`https://fonts.googleapis.com/css2?family=Fredericka+the+Great` and drawing the
word onto a transparent canvas, cropped to the ink with a 6 px margin so the
descender on the "p" is not clipped.

It only needs redoing if the wordmark text or the brand gold changes.
