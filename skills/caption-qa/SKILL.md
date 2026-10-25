---
name: caption-qa
description: 'Check SRT or WebVTT captions and subtitles against published standards (Netflix English, BBC subtitle guidelines, DCMP Captioning Key) for reading speed, line length, line count, time on screen, gaps and overlaps, then fix failures by retiming before rewording. Use when asked to QA, lint or validate captions, check whether subtitles read too fast, prepare captions for Netflix, broadcast or educational delivery, or add a caption check to CI.'
license: MIT
---

# Caption QA

Captions fail delivery and accessibility review on numbers: characters a second, characters a line, time on screen and the gap between captions. Each standard publishes its own limits, and they differ, so "are these captions OK?" has no answer until you know where they are going. This skill picks the right set of limits, measures every cue the same way the published limits are written, and fixes failures without cutting the speaker's words.

## When to Use This Skill

- The user has an `.srt` or `.vtt` file and asks whether it is ready to ship, or why a platform rejected it.
- The user asks whether captions or subtitles read too fast, or have lines that are too long.
- Captions are headed for Netflix, a broadcaster, or US educational media, and must meet that spec.
- The user wants caption checks in CI so a bad file fails the build.

## Pick the Standard

If the user names no target, use Netflix English (adult) and say that you did.

| Standard | Reading speed | Line length | Lines | Time on screen | Gap between captions |
|---|---|---|---|---|---|
| Netflix English, adult | 20 characters a second | 42 characters | 2 | 5/6 s to 7 s | At least 2 frames; close gaps under 0.5 s to 2 frames |
| Netflix English, children's | 17 characters a second | 42 characters | 2 | 5/6 s to 7 s | Same as adult |
| BBC subtitle guidelines | 160-180 words a minute; aim for about 0.3 s a word | 37 characters (broadcast); online, 68% of the width of a 16:9 frame | 2 | - | If you leave a gap, at least 1 s, preferably 1.5 s |
| DCMP Captioning Key (US educational media) | 130 / 140 / 160 words a minute for lower / middle / upper level | - | 2 (preferred) | 40 frames (1 s 10 frames) to 6 s | - |

Sources: [Netflix English (USA) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide), [Netflix subtitle timing guidelines](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360051554394-Timed-Text-Style-Guide-Subtitle-Timing-Guidelines), [BBC subtitle guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/), [DCMP Captioning Key: text](https://dcmp.org/learn/597-captioning-key---text) and [presentation rate](https://dcmp.org/learn/601-captioning-key---presentation-rate). The BBC's per-word time and minimum gap are guidance, so report them as suggestions, not failures.

## Measure Every Cue the Same Way

- **Characters** are letters, digits, spaces and punctuation in the displayed text. Don't count line breaks, formatting tags (`<i>`, `<b>`, `{\an8}`) or the cue number.
- **Reading speed** is characters divided by duration (out-time minus in-time), in seconds.
- **Words a minute** is words divided by duration, times 60. A word is a run of characters that holds a letter or a digit, so a lone dash isn't one.
- **Gap** runs from one cue's out-time to the next cue's in-time. Frame limits depend on the frame rate: 2 frames is 0.083 s at 24 fps but 0.067 s at 30 fps. Ask for the frame rate, or state that you assumed 24 fps.
- **Overlap**: a cue that ends after the next one starts is always a failure, under every standard.
- Read both timestamp forms: `00:00:01,000` (SRT) and `00:00:01.000` or `01.000` (WebVTT). Skip WebVTT `NOTE`, `STYLE` and `REGION` blocks, and treat cue settings after the timestamps (`align:start`) as part of the timing line.

## Workflow

1. **Find the target** (platform, broadcaster or audience level) and pick the standard from the table.
2. **Measure every cue**, or run the command-line check below and read its output.
3. **Report** with a count line first ("212 of 240 captions meet Netflix English, adult"). Then group failures by rule, with cue numbers and timecodes. Show the first few cues of each kind instead of hundreds of lines.
4. **Fix, keeping the words**, in this order:
   1. Extend the out-time into the following gap, keeping the minimum gap.
   2. Start the cue earlier if the previous cue ends well before it.
   3. Split a long cue into two at a phrase boundary, each one meeting the minimum time on screen.
   4. Merge a flash cue (under the minimum time) into its neighbor.
   5. Re-break lines: break after punctuation or before a conjunction or preposition, and keep an article with its noun and a first name with a last name.
   6. Edit the wording only when the user asks for edited (not verbatim) captions.
5. **Measure again** after fixing. A retime can create a new overlap or a gap under the minimum.

## Command-Line Check

[caption-checker](https://github.com/markksantos/caption-checker) is an MIT-licensed, zero-dependency Node.js 18+ CLI that applies the limits above and exits with 1 when any caption breaks a limit, so it can gate CI. It runs offline.

```bash
npx -y github:markksantos/caption-checker captions.srt
npx -y github:markksantos/caption-checker captions.vtt --standard bbc
npx -y github:markksantos/caption-checker ep1.srt ep2.srt --standard netflix --fps 25 --json
```

Standards: `netflix`, `netflix-kids`, `bbc`, `dcmp-lower`, `dcmp-middle`, `dcmp-upper`. An excerpt of the text output:

```text
travel-vlog.srt: 2 of 8 captions meet Netflix English, adult programs
  #3  0:06.600 -> 0:07.100  First,
      ✗ On screen 0.50 s (minimum 5/6 of a second)
  #4  0:07.200 -> 0:09.000  we packed water, snacks, a rain jacket and a spare battery for the cam
      ✗ Reading speed 41.1 characters a second (limit 20)
      ✗ Line 1 is 74 characters (limit 42)
```

In GitHub Actions:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx -y github:markksantos/caption-checker captions/*.srt --standard netflix
```

## Gotchas

- Meeting these numbers doesn't certify a file. Netflix and broadcasters also review style: italics, speaker labels, sound descriptions and position.
- The limits were read from each standard's own page in October 2026. Check the source before quoting a limit as current.
- Only SRT and WebVTT are covered. Convert ASS first with `ffmpeg -i subs.ass subs.srt`, which keeps the timing and wraps the text in font tags that the character count ignores.
