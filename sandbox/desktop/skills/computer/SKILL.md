---
name: computer
description: Operate this sandbox's shared desktop, and hand control to the person for a step only they can do — sign-in, MFA, CAPTCHA, OAuth consent, payment confirmation. Use whenever browser work reaches something that needs the account holder rather than an agent.
---

# The computer

This sandbox is a desktop, not a headless box. It runs KDE Plasma on display
`:0` at 1280x720, and the person who asked you for this work can watch it live
and take the keyboard at any time. Assume you are being watched.

## The browser is shared, and it is headed

There is one Chrome. You drive it with `playwright-cli`, which starts it on
first use and then reuses the same process; the person sees that same window.
Its profile lives on the persistent mount, so a sign-in completed once — by you
or by them — is still there in the next sandbox.

Two consequences worth acting on:

- Do not describe the screen back to them. They can see it. Say what you did
  and what you need.
- Do not open a second browser or a private window to "start clean". You would
  be throwing away the logins that make the next step possible.

## When a step needs the person

Some steps cannot be done by an agent, and no amount of retrying changes that:

- a sign-in form, and anything behind one
- a one-time code, an authenticator app, a push approval
- a CAPTCHA or any other are-you-human check
- an OAuth or permissions consent screen
- confirming a payment, or anything that spends money
- accepting terms on the account holder's behalf

For any of these, call `computer_request_user_action`.

**Call it instead of asking for the secret in chat.** Never ask for a password,
verification code, recovery phrase, or card number — not in a message, and not
in the tool's own instructions. The whole point of the handoff is that the
person types it themselves, on the screen, where you never see it.

**Call it instead of reporting failure.** "I cannot log in to that site" is not
a result when a person is one click away and already looking at the screen.

## How to hand over

1. Get there first. Navigate as far as automation safely can, so the page they
   need is the page on screen when the card appears. A handoff that opens on a
   blank tab makes them do your half of the work as well.
2. Call the tool once, with a short imperative `title` and one or two sentences
   of `instructions` saying what to do and how you will know you can continue.
3. Execution pauses. It spends no tokens while it waits, however long that is.
   They get a card with a live picture of this screen, a Take over button that
   opens the desktop over the whole window, and Done and Skip.
4. The call returns `completed` or `skipped`.

## After it returns

- `completed` — read the browser's current state before doing anything else.
  They may have navigated, closed a tab, or landed somewhere other than where
  you left off. Do not assume the page you handed over is the page you got
  back.
- `skipped` — continue without it if you can, or say plainly which part cannot
  proceed and why. Do not immediately ask again.

## Limits

- One wait per obstacle. Never call this tool in a loop.
- One concrete action per call. "Sign in and then buy the thing" is two
  handoffs, and the second one should not be asked for until the first is done.
- Not for work you can do yourself. A wait a person did not need to be part of
  is worse than a slow attempt.
