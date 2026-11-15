# Spike results

## PC: Linux, Proton, 2026-11-15

Client 1.60.1 build 70938, 2560x1440, UI scale 0.64, about 100 fps.

| Question | Result |
|---|---|
| `Screenshot()` from a timer | Works. The call takes 0.01 ms, with no blocked-action event. `SCREENSHOT_SUCCEEDED` arrives after about 700 ms (60-80 frames). |
| Pitch | Exactly 1.000 x 1.000 px per unit. Gnomish's 3.875 px cells do not appear here. |
| Colour levels | The client maps 0-255 to about 3-252, always the same way. 1, 2 and 4 bits per channel decode exactly. 8 bits fails, because about 21 pairs of neighbouring values merge. |
| Cell size | 1, 2 and 4 px cells all decode exactly at 1, 2 and 4 bits. |
| Hide in the same frame as the call | The strip is never in the image (12 of 12). |
| Hide 1 frame after the call | The strip is always in the image (12 of 12). It is visible for 34 ms on average, 48 ms at most. |
| Hide 2 frames after the call | Always in the image. Visible for 45 ms on average. |
| Hide on the event | Visible for about 720 ms. |
| Strip build time (4096 cells) | 18 ms at 1 or 2 bits, 111 ms at 4 bits, 238 ms at 8 bits. The cost grows with the number of distinct colours. |
| Slot load | 1.3 ms for 20 chars, 1.1 ms for 64 KiB, 2.1 ms for 512 KiB. A second load of the same slot takes 0.04 ms and does not run the body. |
| Font probe | A loose TTF fails at the plain path, both empty and valid. |
| Texture probe | The plain path always returns a fixed negative file ID (-8552 and so on), empty or valid. |
| Sound probe | The plain path always says it will play, empty or valid. |
| Fresh paths (`probe\.\file`) | Never found: "file not found", no ID, no sound. |

## Conclusions

- The screenshot channel works on Proton. Use 2 bits per channel and 1 px cells. That decodes exactly, builds in about 18 ms, and holds about 192 KB in a 100 px tall strip across 2560 px.
- Hide the strip 1 frame after the call. The flash then lasts about 30-50 ms instead of 0.7 s.
- No non-consuming probe exists. The client indexes loose files at launch, and later content changes do not show in these APIs. Every slot load uses up the slot until `/reload`.
- Slot loads cost 1-2 ms even at 512 KiB, so request size is not a concern. The limit is the slot count per UI session.
