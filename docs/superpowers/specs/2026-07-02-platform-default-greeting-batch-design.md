# Platform Default Greeting Batch Design

## Goal

One click processes every approved task within the daily quota by using BOSS's platform-default greeting only. Custom draft text remains stored but is not filled or sent.

## Execution flow

The extension claims one approved task at a time, opens its BOSS detail page, and asks the page adapter to start communication. If the page already has a ready chat, or the communication click leads to a ready chat, the runner records structured confirmation evidence and marks the task sent. It then closes extension-created task tabs, waits for the existing pacing interval, and claims the next task.

The runner must not call `SEND_GREETING_IN_CHAT` in this mode. The workbench action is labelled `一键平台默认打招呼 N 条` so the UI describes the actual behavior.

## Failure policy

- Risk, login, verification, CAPTCHA, or a communication click followed by an unconfirmed chat transition pauses the current task and stops the batch.
- Missing or ambiguous communication controls before any click mark only that task failed; the batch continues.
- Quota exhaustion stops normally. The existing daily limit and confirmed-send accounting remain authoritative.
- A task is never marked sent from a click alone. A ready BOSS chat is required as evidence.

## Compatibility and safety

Custom drafts and their APIs remain unchanged for later use. Existing confirmation persistence, quota accounting, duplicate-run prevention, and risk detection remain enabled. Tests use fixtures and dependency fakes; browser verification must not click the batch button.

## Acceptance criteria

1. A batch with multiple approved tasks processes all safe tasks sequentially.
2. No custom-message send command is issued.
3. A no-click page mismatch fails one task and continues.
4. Risk or an uncertain post-click transition stops the batch.
5. UI wording explicitly says platform-default greeting.
