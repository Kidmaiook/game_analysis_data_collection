GREEN ROOM — STREAM PLANNING CONSOLE
README
=====================================

This file explains what every file in the project does, now that the
in-code comments have been removed. Read this instead of the source
if you just want to know "what does this do."


HOW THE SITE FITS TOGETHER
---------------------------
This is a static website. There is no server. EDA.py (a Python script you
run yourself, separately) reads raw Steam / Twitch / GPU-price data and
writes one file, data.json, which the website then reads with JavaScript
to draw everything on screen. To refresh the numbers on the site, you
re-run EDA.py and reload the page — nothing else needs to change.

Because the site fetches data.json with JavaScript, opening index.html by
double-clicking it (a file:// URL) will not work in most browsers — they
block local pages from reading local files. Run a tiny local server from
this folder instead, e.g.:

    python3 -m http.server 8000

...then open http://localhost:8000 in your browser.


WEBSITE PAGES (open these in a browser)
-----------------------------------------
index.html
    The homepage. Shows the live "on-air now" busy/free meter for Twitch
    (with the color legend explaining what red/amber/green mean), a
    teaser strip of top opportunity games, and the GPU market section
    (price trend chart + best-value cards).

games.html
    The full, sortable/filterable list of every game with a computed
    "opportunity score," plus a detail modal per game showing its own
    mini day/hour heatmap.

schedule.html
    The big day-by-hour heatmap ("signal board") showing when Twitch is
    most wide-open vs. most crowded, with a color legend.

insights.html
    Displays the statistical charts (Q1–Q9 and the viewer-distribution
    chart) that EDA.py generates from the raw dataset, with short
    plain-English write-ups next to each one.


STYLING
-------
style.css
    All visual styling for the four pages above: color variables (the
    "Palette" used everywhere: dark background, panel cards, the
    red/amber/green signal colors), typography, the heatmap cell colors,
    card layouts, the modal, etc. One shared stylesheet for the whole site.


JAVASCRIPT (in js/)
--------------------
js/common.js
    Shared helpers used by every page: loads data.json, formats numbers,
    computes the day/hour heat level (0–5) used to color heatmap cells,
    and shows a friendly error screen if data.json fails to load (usually
    because the site was opened as a file:// page instead of through a
    local server).

js/home.js
    Powers index.html: the on-air busy/free meter, the top-opportunity
    teaser cards, and the GPU market cards (price trend chart + best
    value list).

js/games.js
    Powers games.html: renders the game grid, search/genre/price filters,
    sorting, and the per-game detail modal with its mini heatmap.

js/schedule.js
    Powers schedule.html: builds the big day-by-hour heatmap grid and
    highlights the single best slot.

js/insights.js
    Powers insights.html: lists the Q1–Q9 charts and their write-ups for
    whichever month/period is selected, pulling image paths and
    descriptions out of data.json.


DATA
----
data.json
    The single file the whole website reads. Produced by EDA.py. Contains:
      - meta            : dataset-wide stats (months covered, totals, etc.)
      - games            : per-game stats + computed opportunity scores
      - schedule         : the day/hour viewer-per-streamer heatmap data
      - gpu_market        : average GPU price by month, cheapest/priciest
                            models, and the path to the price-trend chart

assets/
    Static images referenced by data.json and the insights page:
      assets/gpu/          - the GPU average-price-by-month chart (PNG)
      assets/insights/     - the Q1–Q9 and distribution charts (PNG),
                              one folder per month plus a GLOBAL folder


THE ANALYSIS SCRIPT
--------------------
EDA.py
    Run this yourself with Python (not from the browser) to (re)generate
    data.json and every chart in assets/. It:
      1. Loads the raw monthly Steam, Twitch, game-catalog and GPU-price
         snapshots from data/raw and data/monthly.
      2. Builds a fact table joining Steam player counts to Twitch
         viewer counts per game/day.
      3. Produces the Q1–Q9 statistical charts (correlation, trends,
         a Random-Forest feature-importance model, daily/hourly activity,
         peak-hour market share, viewer/streamer efficiency, a rising-
         trend validation check, and the viewer-count distribution).
      4. Builds the GPU market summary and its price-trend chart.
      5. Computes each game's "opportunity score" and the best day/hour
         to stream, and writes it all out to data.json for the website.

    All charts are drawn with a dark color theme that matches the
    website (dark panel background, the same green/amber/red accent
    colors used elsewhere on the site) instead of matplotlib's default
    white background, so the PNGs blend into the page instead of showing
    up as bright white boxes.

    To run it, you need Python 3 with: pandas, numpy, scipy, scikit-learn,
    matplotlib, seaborn, and either pyarrow or fastparquet (for reading
    the monthly .parquet files — if neither is installed, the script
    prints a warning and falls back to whatever raw files it can read).

    Run it from inside this folder:

        python3 EDA.py


UNUSED / LEGACY FILES — SAFE TO IGNORE OR DELETE
---------------------------------------------------
app.js
    An old, single-file version of the site's JavaScript from an earlier
    draft. Nothing in the current HTML pages references it anymore — the
    logic now lives in js/common.js, js/home.js, js/games.js,
    js/schedule.js and js/insights.js instead. Left in place in case you
    want to compare, but it can be deleted.

site/ (folder)
    An earlier single-page prototype of the whole site (its own
    index.html, app.js, style.css). Superseded by the multi-page site
    described above. Not linked from anywhere in the current site.


A NOTE ON RE-RUNNING THE ANALYSIS
------------------------------------
The charts currently sitting in assets/insights/ were generated by an
older version of EDA.py that used matplotlib's default white background.
The GPU price-trend chart in assets/gpu/ has already been regenerated
with the new dark theme. Once you re-run EDA.py in an environment with
pyarrow/fastparquet installed (needed to read the monthly .parquet
files), all the Q1–Q9 and distribution charts in assets/insights/ will
be regenerated in the same dark, site-matching style automatically.
