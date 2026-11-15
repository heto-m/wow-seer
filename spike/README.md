# Seer spike

A throwaway test that answers the questions Seer's design depends on, on the real client (WoW: Forever 1.60.1, Proton on Linux and native on macOS):

1. Can an addon call `Screenshot()` from a timer, with no key press?
2. Does a colour strip survive in the PNG, and how dense can it be: 1, 2, 4 or 8 bits per channel; cells of 4, 2 or 1 px?
3. Can the strip disappear right after the call (0, 1 or 2 frames) and still be in the image? This decides how long the flash lasts.
4. How long does loading a slot addon take, at different sizes?
5. Is there a check that does not use up a slot? The spike tests fonts, textures and sounds whose files change between empty and valid while the game runs, at a fixed path and at a new path on every call.

`spike.py` needs only the Python standard library and runs on Python 3.9 or newer. It finds the game in the default Faugus path on Linux and in `/Applications/World of Warcraft/_forever_` on macOS. Set `WOW_DIR` to use another folder.

## Install

With the game closed:

```sh
python3 spike/spike.py install
```

This copies `SeerSpike` into `Interface/AddOns` and creates 20 slot addons, `SeerSpike_S01` to `SeerSpike_S20`. It also creates empty probe files in `SeerSpike/probe/`. Start the game and log in. Then type:

```
/seerspike png
/seerspike status
```

Stay out of combat during the tests. A city or an inn is a good place.

## 1. One screenshot

```
/seerspike shot
```

The chat shows the call time, the event time and how long the strip was visible. Then decode the newest screenshot:

```sh
python3 spike/spike.py decode
```

## 2. Sweep: density and flash length

This takes 48 shots: every mix of bits {1, 2, 4, 8}, cell {4, 2, 1} px and hide {on the event, 0, 1, 2 frames}. It lasts about 80 seconds and flashes a strip at the top left of the screen.

```
/seerspike sweep
```

When the chat says the sweep is done:

```sh
python3 spike/spike.py decode --last 48
```

A line that says `no strip` means the strip was hidden before the capture. To test one setting by hand, use `/seerspike shot <bits> <cell> <hide> <pre>`, for example `/seerspike shot 8 2 1 1`. Here `hide` is `e` (wait for the event) or a number of frames, and `pre` is the number of frames between showing the strip and calling `Screenshot()`.

## 3. Slot loads

While the game runs:

```sh
python3 spike/spike.py slot 1 hello from the shell
python3 spike/spike.py slot 2 --kb 64
python3 spike/spike.py slot 3 --kb 512
```

In game:

```
/seerspike slot 1
/seerspike slot 2
/seerspike slot 3
/seerspike slot 1
```

Each line shows the load time and the text the slot holds. The last command should report `body did not run`, because each slot loads only once until `/reload`.

## 4. Probes

Run these steps in order. Shell commands start with `python3`; the other lines are typed in game.

```
/seerspike probe 1-2
python3 spike/spike.py probe 1-4 valid
/seerspike probe 1-4
python3 spike/spike.py probe 3 empty
/seerspike probe 3,5
```

Each probe line shows the result at the plain path and at a fresh path. The fresh path adds one more `\.` segment on every call, so it never repeats.

## Collect the results

```
/reload
```

```sh
python3 spike/spike.py results > results.txt
python3 spike/spike.py decode --last 49 >> results.txt
```

Send `results.txt`, plus anything odd you saw on screen. Run `python3 spike/spike.py watch --delete` in a terminal to decode screenshots as they arrive and delete them afterwards. To uninstall, close the game and run `python3 spike/spike.py remove`.
