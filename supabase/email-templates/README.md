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
a Namecheap alias (`hello@irisbible.com`), so replies reach a real inbox rather
than the `send.irisbible.com` sending subdomain, which has no mailbox.

## Previewing a change

`{{ .ConfirmationURL }}` is Supabase's placeholder and is not valid HTML to a
browser. To look at one locally, copy the file, replace that token with any
URL, and open it.

## Things that will break if changed carelessly

- **The wordmark** is loaded from
  `https://irisbible.com/email/irisbible-wordmark.png`. It must stay served
  from the live app; an email cannot carry a local file path. The
  `email/` folder is excluded from the service-worker precache in
  `vite.config.ts` — only mail clients ever fetch it.
- **The wordmark is an image, not a webfont.** Gmail's web and Android
  clients strip `<link>` webfonts, so Milonga as live text would
  have fallen back to a plain serif for most people receiving these. The
  rendered PNG cannot be substituted by any client. Its `alt` is "irisBible", so
  a client with images turned off still reads the name.
- **Inline styles and tables only.** A `<style>` block and flexbox are both
  widely stripped or ignored by mail clients. There is one `<style>` here, an
  mso conditional, which is the accepted way to reach Outlook.
- **The NET footer** is a license condition, not decoration. NET may be quoted
  freely in a free app provided the quotation is followed by `(NET)` and, where
  there is internet access, those letters link to netbible.org. Both the verse
  credit and the footer line satisfy that; do not trim them.

## Checking delivery

**Resend → Logs** lists every message with delivered / bounced / spam. If an
email does not arrive, look there before touching code — it shows whether
Supabase even handed the message over.

## Regenerating the wordmark

`apps/pwa-polished/public/email/irisbible-wordmark.png` is the plain wordmark,
black on cream: Milonga letters in `#0b0e14` on `#fffaed`, the iris as the dot
of the "i" in Bible, the same picture as the plain artboard in the logo design.
It is a PNG at 2x (520×160 px, with the cream ground baked in so a mail client's
dark mode cannot turn the black letters invisible) and is declared in the
templates at 260×80 inside a cream header band. The iris in the word is the
only one in the email.

To redraw it, set the word in a page that loads
`public/fonts/milonga-400.woff2` and `public/pb-gem.png` using the layout in
`Wordmark.svelte` with no shadows, screenshot it at 200px type, trim to the
ink, resize to 440 px wide and pad it to 520×160 with cream.
`hexapla-wordmark.png` beside it is the same picture under its old name, kept
so emails already sent from hexapla.app keep their header.
