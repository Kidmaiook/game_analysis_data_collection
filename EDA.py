import os
import re
import glob
import json
import shutil
import calendar
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, zscore
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

SITE_BG = '#0d1315'
SITE_PANEL = '#141b1e'
SITE_TEXT = '#ECEEE9'
SITE_DIM = '#8B9A9B'
SITE_LINE = '#2B3538'
SITE_CUE = '#63D9A0'
SITE_TALLY = '#E1483A'
SITE_AMBER = '#E3A23C'
SITE_ACCENT = ['#63D9A0', '#E3A23C', '#E1483A', '#4FA8D8', '#B37FE0']

THEME_RC = {
    'figure.facecolor': SITE_BG,
    'axes.facecolor': SITE_PANEL,
    'savefig.facecolor': SITE_BG,
    'savefig.edgecolor': SITE_BG,
    'text.color': SITE_TEXT,
    'axes.labelcolor': SITE_TEXT,
    'axes.edgecolor': SITE_LINE,
    'axes.titlecolor': SITE_TEXT,
    'xtick.color': SITE_TEXT,
    'ytick.color': SITE_TEXT,
    'grid.color': SITE_LINE,
    'grid.alpha': 0.35,
    'legend.facecolor': SITE_PANEL,
    'legend.edgecolor': SITE_LINE,
    'legend.labelcolor': SITE_TEXT,
    'font.family': 'sans-serif',
}
sns.set_theme(style='darkgrid')
plt.rcParams.update(THEME_RC)

def site_sequential_palette(n_colors):
    return sns.light_palette(SITE_CUE, n_colors=max(n_colors, 2) + 1, reverse=False)[1:]

BASE_DIR = 'data'
RAW_DIR = os.path.join(BASE_DIR, 'raw')
MONTHLY_DIR = os.path.join(BASE_DIR, 'monthly')
SITE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(SITE_DIR, 'assets')
GPU_ASSETS_DIR = os.path.join(ASSETS_DIR, 'gpu')
SUB_FOLDERS = ['game_data', 'gpu', 'steam', 'twitch']
MIN_GAME_SAMPLES = 20
MIN_STREAMERS_FOR_COMPETITION = 2

for sub in SUB_FOLDERS:
    os.makedirs(os.path.join(RAW_DIR, sub), exist_ok=True)
os.makedirs(MONTHLY_DIR, exist_ok=True)


def setup_initial_files():
    move_map = {
        'steam_napshot_*.csv': os.path.join(RAW_DIR, 'steam'),
        'twitch_streams_at_*.csv': os.path.join(RAW_DIR, 'twitch'),
        'gpu_prices_*.csv': os.path.join(RAW_DIR, 'gpu'),
        'game_data.csv': os.path.join(RAW_DIR, 'game_data'),
        'game_unknow_data.csv': os.path.join(RAW_DIR, 'game_data'),
    }
    for pattern, target_folder in move_map.items():
        for f in glob.glob(pattern):
            dest = os.path.join(target_folder, os.path.basename(f))
            if not os.path.exists(dest):
                shutil.copy(f, dest)


def _read_parquet_safe(path):
    try:
        if os.path.getsize(path) == 0:
            warnings.warn(f"Skipping empty parquet file: {path}")
            return None
        return pd.read_parquet(path)
    except Exception as e:
        warnings.warn(f"Skipping unreadable parquet file: {path} ({e})")
        return None


def _month_from_path(path):
    parts = os.path.normpath(path).split(os.sep)
    for p in parts:
        if len(p) == 7 and p[4] == '-' and p[:4].isdigit() and p[5:].isdigit():
            return p
    return None


def _month_from_filename(filename):
    """Pulls a YYYY-MM out of a raw scrape filename like
    'twitch_streams_at_2026-08-10_11-07-51.csv' or
    'steam_napshot_2026-08-10_11-07-51.csv', so freshly-scraped files can be
    dated without needing to already sit in a data/monthly/<month>/ folder."""
    m = re.search(r'(\d{4})-(\d{2})-\d{2}', filename)
    return f'{m.group(1)}-{m.group(2)}' if m else None


# Where each category's freshly-scraped (not yet monthly-partitioned) CSVs
# actually land. load_data() below reads these automatically for any month
# that doesn't already have a data/monthly/<month>/<category>/ folder, so a
# new month of scraped data shows up on the site without a manual
# conversion step every time.
RAW_DUMP_FOLDERS = {
    'twitch': ['twitch_streams'],
    'steam': ['steam_daily'],
    'gpu': ['gpu_prices'],
}


def load_data(category, tag_month=False):
    csv_files = glob.glob(os.path.join(RAW_DIR, category, '*.csv'))
    parquet_files = sorted(glob.glob(os.path.join(MONTHLY_DIR, '**', category, '*.parquet'), recursive=True))
    already_processed_months = {m for m in (_month_from_path(f) for f in parquet_files) if m}

    dfs = []
    for f in csv_files:
        try:
            d = pd.read_csv(f)
            if tag_month:
                d['source_month'] = _month_from_path(f) or 'unknown'
            dfs.append(d)
        except Exception as e:
            warnings.warn(f"Skipping unreadable CSV file: {f} ({e})")
    for f in parquet_files:
        d = _read_parquet_safe(f)
        if d is None or d.empty:
            continue
        if tag_month:
            d['source_month'] = _month_from_path(f) or 'unknown'
        dfs.append(d)

    for dump_folder in RAW_DUMP_FOLDERS.get(category, []):
        for f in sorted(glob.glob(os.path.join(RAW_DIR, dump_folder, '*.csv'))):
            month = _month_from_filename(os.path.basename(f))
            if month is None or month in already_processed_months:
                continue  # this month is already covered by a monthly parquet
            try:
                d = pd.read_csv(f)
            except Exception as e:
                warnings.warn(f"Skipping unreadable CSV file: {f} ({e})")
                continue
            if tag_month:
                d['source_month'] = month
            dfs.append(d)

    return pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()


def dedupe_game_info(game_info):
    if game_info.empty:
        return game_info
    df = game_info.copy()
    if 'source_month' in df.columns:
        df = df.sort_values('source_month')
    return df.drop_duplicates(subset='Game_Name', keep='last').reset_index(drop=True)

def prepare_fact_table(df_steam, df_twitch):
    df_steam = df_steam.copy()
    df_steam['date'] = pd.to_datetime(df_steam['snapshot_day']).dt.date
    steam_agg = df_steam.groupby(['date', 'game'])[['current_players', 'peak_players']].mean().reset_index()

    df_twitch = df_twitch.copy()
    df_twitch['date'] = pd.to_datetime(df_twitch['snapshot_date']).dt.date
    twitch_agg = df_twitch.groupby(['date', 'game_name'])['viewer_count'].sum().reset_index()

    fact_table = pd.merge(
        steam_agg, twitch_agg,
        left_on=['date', 'game'], right_on=['date', 'game_name'], how='inner'
    ).drop(columns=['game_name'])

    for col in ['current_players', 'viewer_count']:
        std = fact_table[col].std()
        fact_table[f'{col}_zscore'] = zscore(fact_table[col]) if std > 0 else 0.0

    fact_table['potential_score'] = (
        fact_table['viewer_count_zscore'] * 0.6 + fact_table['current_players_zscore'] * 0.4
    )
    return fact_table


LANGUAGE_UTC_OFFSETS = {
    'en': -5, 'es': 1, 'pt': -3, 'fr': 1, 'de': 1, 'ru': 3, 'it': 1, 'pl': 1,
    'ja': 9, 'ko': 9, 'zh': 8, 'th': 7, 'vi': 7, 'id': 7, 'hi': 5,
    'ar': 3, 'tr': 3, 'uk': 2, 'cs': 1, 'sv': 1, 'da': 1, 'no': 1,
    'nl': 1, 'fi': 2, 'el': 2, 'ro': 2, 'hu': 1, 'bg': 2,
}

# The raw data only records broadcast *language*, not a verified viewer
# location. This maps each language to one representative country so the
# site can offer a "country" filter — it's a reasonable proxy (and labeled
# as such in the UI) but isn't literal geolocation data.
COUNTRY_BY_LANGUAGE = {
    'en': 'United States', 'es': 'Spain', 'pt': 'Brazil', 'fr': 'France',
    'de': 'Germany', 'ru': 'Russia', 'it': 'Italy', 'pl': 'Poland',
    'ja': 'Japan', 'ko': 'South Korea', 'zh': 'China', 'th': 'Thailand',
    'vi': 'Vietnam', 'id': 'Indonesia', 'hi': 'India', 'ar': 'Saudi Arabia',
    'tr': 'Turkey', 'uk': 'Ukraine', 'cs': 'Czech Republic', 'sv': 'Sweden',
    'da': 'Denmark', 'no': 'Norway', 'nl': 'Netherlands', 'fi': 'Finland',
    'el': 'Greece', 'ro': 'Romania', 'hu': 'Hungary', 'bg': 'Bulgaria',
}
MIN_SAMPLES_FOR_COUNTRY_BREAKDOWN = 40


def prepare_twitch_time_data(df_twitch):
    df = df_twitch.copy()
    df['started_at_dt'] = pd.to_datetime(df['started_at'])
    df['day_of_week'] = df['started_at_dt'].dt.day_name()
    df['hour'] = df['snapshot_time'].str.slice(0, 2).astype(int)

    snapshot_dt = pd.to_datetime(
        df['snapshot_date'].astype(str) + ' ' + df['snapshot_time'].astype(str).str.replace('-', ':', regex=False),
        errors='coerce',
    )
    lang = df.get('language', pd.Series('', index=df.index)).fillna('')
    offsets = lang.map(LANGUAGE_UTC_OFFSETS).fillna(0)
    local_dt = snapshot_dt + pd.to_timedelta(offsets, unit='h')
    df['day_of_week_local'] = local_dt.dt.day_name().fillna(df['day_of_week'])
    df['hour_local'] = local_dt.dt.hour.fillna(df['hour']).astype(int)
    df['country'] = lang.map(COUNTRY_BY_LANGUAGE).fillna('Other')
    df['date'] = pd.to_datetime(df['started_at_dt']).dt.date
    return df


def week_of_month(date_obj):
    """Simple calendar week-within-month: days 1-7 = week 1, 8-14 = week 2,
    etc. Ties cleanly to a single month (unlike ISO week numbers, which can
    straddle a month boundary), matching how the site's dropdowns present
    'week within the selected month'."""
    return ((date_obj.day - 1) // 7) + 1


def _normalize_name(name):
    return str(name).replace('™', '').replace('®', '').strip().lower()

def q1_correlation(fact_table, label, out_dir):
    if len(fact_table) < 2:
        return
    plt.figure(figsize=(8, 6))
    r_val, p_val = pearsonr(fact_table['current_players'], fact_table['viewer_count'])
    n_observations = len(fact_table)

    sns.regplot(
        data=fact_table, x='current_players', y='viewer_count',
        line_kws={'color': SITE_TALLY, 'label': 'Regression Line'},
        scatter_kws={'alpha': 0.5, 'color': SITE_CUE},
    )
    stats_text = f"Pearson r: {r_val:.3f}\np-value: {p_val:.3e}\nn: {n_observations}"
    plt.gca().text(0.05, 0.95, stats_text, transform=plt.gca().transAxes, fontsize=12,
                    verticalalignment='top', color=SITE_TEXT,
                    bbox=dict(boxstyle='round', facecolor=SITE_PANEL, edgecolor=SITE_LINE, alpha=0.9))
    plt.title(f'Steam Players vs. Twitch Viewers ({label})')
    plt.xlabel('Average Current Players (Steam)')
    plt.ylabel('Total Viewer Count (Twitch)')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q1.png'))
    plt.close()

    desc = None
    with open(os.path.join(out_dir, 'desc_q1.txt'), 'w') as f:
        significance = "strong" if abs(r_val) > 0.7 else "moderate" if abs(r_val) > 0.4 else "weak"
        direction = "rise together" if r_val > 0 else "move in opposite directions"
        p_status = "a real pattern, not noise" if p_val < 0.05 else "not statistically distinguishable from noise"
        desc = (f"Steam player counts and Twitch viewer counts have a {significance} relationship "
                f"(r = {r_val:.2f}): the two tend to {direction}. Across {n_observations} matched "
                f"game/day snapshots, that relationship is {p_status} (p = {p_val:.4f}). "
                f"{'A strong link means Steam player counts alone are a decent stand-in for stream audience size when Twitch data is thin.' if abs(r_val) > 0.7 else 'The link is loose enough that a game can be big on one platform and modest on the other — treat them as complementary signals, not substitutes.'}")
        f.write(desc)
    return desc


def q2_trends(fact_table, label, out_dir):
    if fact_table.empty:
        return
    plt.figure(figsize=(14, 7))
    data = fact_table.groupby('game')['potential_score'].mean().sort_values(ascending=False).head(10)
    data.plot(kind='barh', color=SITE_CUE).invert_yaxis()
    plt.title(f'Top Games by Potential Score ({label})')
    plt.subplots_adjust(left=0.35)
    plt.savefig(os.path.join(out_dir, 'graph_q2.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q2.txt'), 'w') as f:
        top_game = data.index[0]
        runner_up = data.index[1] if len(data) > 1 else None
        gap_note = (f" It's clear of the next name on the list, '{runner_up}', by a real margin — this "
                    f"wasn't a close call." if runner_up is not None and data.iloc[0] - data.iloc[1] > 0.15
                    else f" It's only narrowly ahead of '{runner_up}', though — treat the top few as a tier, "
                         f"not a strict ranking." if runner_up is not None else "")
        desc = (f"'{top_game}' is the standout this period.{gap_note} Potential score is NOT the same metric "
                f"as the 0-100 Opportunity score used on the Call Sheet: it standardizes Twitch viewer_count "
                f"and Steam current_players into z-scores (how many standard deviations each snapshot is "
                f"above/below that period's average across ALL games) and blends them 60/40 in favor of "
                f"viewers, per game/day snapshot, then averages per game. Because it's z-scores, it's "
                f"centered on 0 and can go negative (below-average) — it flags titles whose viewership AND "
                f"player counts are unusually high relative to everything else tracked that period, not "
                f"just titles with the biggest raw audience.")
        f.write(desc)
    return desc


def _fit_rf(fact_table, game_info, feats=('current_players', 'peak_players', 'Price', 'Total_reviews')):
    feats = list(feats)
    ml_data = pd.merge(fact_table, game_info, left_on='game', right_on='Game_Name', how='left')
    subset = ml_data.dropna(subset=feats + ['viewer_count'])
    if len(subset) < 10:
        return None, None, None
    rf = RandomForestRegressor(n_estimators=100, random_state=42).fit(subset[feats], subset['viewer_count'])
    return rf, subset, feats


def q3_ml_influence(rf, subset, feats, label, out_dir):
    if rf is None:
        return None, None
    importances = pd.Series(rf.feature_importances_, index=feats).sort_values()
    plt.figure(figsize=(10, 6))
    importances.plot(kind='barh', color=SITE_AMBER)
    plt.title(f'What Drives Viewership ({label})')
    plt.xlabel('Importance Score')
    plt.ylabel('Features')
    plt.subplots_adjust(left=0.25)
    plt.savefig(os.path.join(out_dir, 'graph_q3.png')); plt.close()

    preds = rf.predict(subset[feats])
    mae = mean_absolute_error(subset['viewer_count'], preds)
    r2 = r2_score(subset['viewer_count'], preds)

    with open(os.path.join(out_dir, 'model_and_data_summary.txt'), 'w') as f:
        model_summary = (f"SUMMARY FOR: {label}\nMAE: {mae:.2f}\nR2: {r2:.2f}\n\nSTATS:\n"
                          f"{subset[feats + ['viewer_count']].describe().to_string()}")
        f.write(model_summary)
    with open(os.path.join(out_dir, 'desc_q3.txt'), 'w') as f:
        top_feat = importances.index[-1]
        second_feat = importances.index[-2] if len(importances) > 1 else None
        second_clause = f", with '{second_feat}' as its next-strongest signal," if second_feat else ""
        fit_quality = ("explains most of the variation" if r2 > 0.7 else
                        "captures a real but partial pattern" if r2 > 0.3 else
                        "only weakly explains what's happening")
        desc = (f"A Random Forest model trained to predict viewer count leans hardest on '{top_feat}'"
                f"{second_clause} for {label}. The model {fit_quality} (R\u00b2 = {r2:.2f}, average "
                f"prediction error \u00b1{mae:,.0f} viewers). Take the exact ranking with a grain of "
                f"salt when R\u00b2 is low \u2014 it means factors outside this dataset (game genre "
                f"trends, streamer skill, real-world events) are doing a lot of the work too.")
        f.write(desc)
    return desc, model_summary


def q4_daily_activity(df_time, label, out_dir):
    if df_time.empty:
        return None
    plt.figure(figsize=(10, 6))
    order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    data = df_time.groupby('day_of_week')['user_id'].nunique().reindex(order)
    sns.barplot(x=data.index, y=data.values, hue=data.index, palette=site_sequential_palette(len(data)), legend=False)
    plt.xticks(rotation=30)
    plt.title(f'Streamer Activity by Day ({label})')
    plt.xlabel('Day of the Week')
    plt.ylabel('Unique Streamers')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q4.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q4.txt'), 'w') as f:
        peak_day = data.idxmax()
        quiet_day = data.idxmin()
        spread_pct = round((data.max() - data.min()) / data.max() * 100) if data.max() else 0
        desc = (f"Streamer supply isn't flat across the week: {peak_day} draws the most unique broadcasters "
                f"during {label}, while {quiet_day} is the quietest, roughly {spread_pct}% fewer streamers "
                f"active. More streamers on {peak_day} means more competition for the same audience, so a "
                f"big crowd there doesn't automatically mean an easy night \u2014 pair this with the "
                f"viewer-per-streamer chart below to see which days are actually easiest to stand out on.")
        f.write(desc)
    return desc


def q5_hourly_engagement(df_time, label, out_dir):
    if df_time.empty:
        return pd.Series(dtype=float), None
    hv = df_time.groupby('hour')['viewer_count'].mean()
    plt.figure(figsize=(10, 5))
    plt.plot(hv.index, hv.values, marker='o', color=SITE_CUE)
    plt.title(f'Viewer Engagement by Hour ({label})')
    plt.xlabel('Hour of Day (24h)')
    plt.ylabel('Average Viewer Count')
    plt.xticks(range(0, 24))
    plt.savefig(os.path.join(out_dir, 'graph_q5.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q5.txt'), 'w') as f:
        peak_hour = int(hv.idxmax())
        quiet_hour = int(hv.idxmin())
        multiple = round(hv.max() / hv.min(), 1) if hv.min() > 0 else None
        scale_note = (f" That's roughly {multiple}\u00d7 the average viewership of the quietest hour "
                       f"({quiet_hour:02d}:00) \u2014 " if multiple else " ")
        desc = (f"Average viewership across a 24-hour UTC cycle peaks at {peak_hour:02d}:00 during {label}."
                f"{scale_note}going live near the peak reaches the largest possible pool of viewers, but "
                f"remember the Signal Board factors in streamer competition too, which can make an "
                f"off-peak hour the smarter play for standing out.")
        f.write(desc)
    return hv, desc


def q6_peak_hour_dominance(df_time, hv, label, out_dir):
    if hv.empty:
        return None
    peak_hour_games = df_time[df_time['hour'] == hv.idxmax()].groupby('game_name')['viewer_count'].sum().sort_values(ascending=False)
    if peak_hour_games.empty:
        return None
    top_n = 5
    pk = peak_hour_games.head(top_n).copy()
    others_total = peak_hour_games.iloc[top_n:].sum()
    if others_total > 0:
        pk['Others'] = others_total

    fig, ax = plt.subplots(figsize=(10, 8))
    slice_colors = SITE_ACCENT[:len(pk)] if len(pk) <= len(SITE_ACCENT) else sns.color_palette("husl", len(pk))
    slice_colors = list(slice_colors)
    if 'Others' in pk.index:
        slice_colors[list(pk.index).index('Others')] = SITE_DIM
    wedges, texts, autotexts = ax.pie(
        pk, autopct='%1.1f%%', startangle=90, counterclock=False,
        colors=slice_colors, pctdistance=0.85,
    )
    ax.legend(wedges, pk.index, title="Games", loc="center left", bbox_to_anchor=(1, 0, 0.5, 1))
    ax.axis('equal')
    plt.title(f'Peak-Hour Game Market Share ({label})')
    plt.savefig(os.path.join(out_dir, 'graph_q6.png'), bbox_inches='tight'); plt.close()

    with open(os.path.join(out_dir, 'desc_q6.txt'), 'w') as f:
        leader = pk.index[0] if pk.index[0] != 'Others' else (pk.index[1] if len(pk) > 1 else pk.index[0])
        leader_share = round(float(pk.get(leader, 0)) / float(pk.sum()) * 100, 1)
        others_share = round(float(others_total) / float(peak_hour_games.sum()) * 100, 1) if others_total > 0 else 0
        others_note = (f" Everything outside the top {top_n} is grouped into 'Others', which still adds up "
                        f"to {others_share}% of peak-hour viewership \u2014 a reminder that the long tail of "
                        f"less-tracked games is collectively a real audience, even if no single one of them "
                        f"cracks the leaderboard." if others_total > 0 else "")
        desc = (f"At the single busiest hour of the day during {label}, '{leader}' pulls in the largest slice "
                f"of viewership ({leader_share}% of peak-hour viewers).{others_note} Ranked from the top slice "
                f"clockwise.")
        f.write(desc)
    return desc


def q7_efficiency_ratio(df_time, label, out_dir):
    if df_time.empty:
        return None
    plt.figure(figsize=(10, 5))
    order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    ds = df_time.groupby('day_of_week').agg(viewer_count=('viewer_count', 'sum'), user_id=('user_id', 'nunique')).reindex(order)
    ratio = ds['viewer_count'] / ds['user_id']
    plt.plot(ratio.index, ratio.values, marker='s', color=SITE_CUE, linewidth=2)
    plt.xticks(rotation=30)
    plt.title(f'Viewer-per-Streamer Ratio by Day ({label})')
    plt.xlabel('Day of the Week')
    plt.ylabel('Viewers per Streamer')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q7.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q7.txt'), 'w') as f:
        best_day = ratio.idxmax()
        worst_day = ratio.idxmin()
        gap_pct = round((ratio.max() - ratio.min()) / ratio.max() * 100) if ratio.max() else 0
        desc = (f"{best_day} gives streamers the best payoff during {label}: the most viewers per streamer, "
                f"meaning less competition per unit of audience. {worst_day} is the weakest, about "
                f"{gap_pct}% lower. This is the real efficiency signal behind the Opportunity score's "
                f"saturation component \u2014 a day can have huge total viewership (see the activity chart "
                f"above) and still be a bad day to stream, if the streamer count grew even faster.")
        f.write(desc)
    return desc


def rising_trend_validation(fact_table, label, out_dir):
    if len(fact_table) < 3:
        return None
    df = fact_table.sort_values(['game', 'date']).copy()
    df['next_day_growth'] = df.groupby('game')['viewer_count'].shift(-1) - df['viewer_count']
    # All three columns being correlated need to be NaN-free, not just
    # next_day_growth -- pearsonr silently returns NaN if any input row has
    # a NaN, which was quietly mislabeling the "winning" metric below.
    df = df.dropna(subset=['next_day_growth', 'potential_score', 'viewer_count', 'peak_players'])
    if len(df) < 3:
        return None

    r_potential, _ = pearsonr(df['potential_score'], df['next_day_growth'])
    r_viewers, _ = pearsonr(df['viewer_count'], df['next_day_growth'])
    r_peak, _ = pearsonr(df['peak_players'], df['next_day_growth'])

    plt.figure(figsize=(10, 6))
    metrics = ['Scoring Logic', 'Current Viewers', 'Peak Players']
    values = [r_potential, r_viewers, r_peak]
    colors = [SITE_CUE if v == max(values) else SITE_DIM for v in values]
    bars = plt.bar(metrics, values, color=colors)
    plt.title(f'Predicting Rising Games ({label})')
    plt.ylabel('Correlation with Future Viewer Growth')
    plt.axhline(0, color=SITE_LINE, linewidth=0.8)
    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2, yval, f'{yval:.3f}',
                  va='bottom' if yval > 0 else 'top', ha='center', fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q8.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q8.txt'), 'w', encoding='utf-8') as f:
        winner = metrics[int(np.argmax(values))]
        verdict = ("backs up the scoring logic used elsewhere on this site" if winner == 'Scoring Logic'
                    else f"suggests a simpler signal ('{winner}') actually predicts tomorrow's growth "
                         f"better than the built-in Potential score does")
        desc = (f"The real test for any 'trending' metric isn't how big a game looks today \u2014 it's "
                f"whether that signal predicts tomorrow's growth. Comparing three candidate signals "
                f"against each game's next-day viewer change for {label}, '{winner}' comes out ahead "
                f"(r = {max(values):.3f}). That {verdict}.")
        f.write(desc)
    return desc


def viewer_distribution(df_time, label, out_dir):
    if df_time.empty:
        return None
    fig, ax1 = plt.subplots(figsize=(12, 6))
    counts, bin_edges = np.histogram(df_time['viewer_count'], bins=80, range=(0, 80000))
    ax1.hist(df_time['viewer_count'], bins=80, range=(0, 80000), color=SITE_CUE, alpha=0.55,
             edgecolor=SITE_BG, label='Record Count', bottom=0.1, log=True)
    ax1.set_ylabel('Number of Records (Log Scale)', color=SITE_CUE)

    # The y-axis ceiling used to be hardcoded to 1000, which silently clipped
    # any bin taller than that (the bar would just run off the top of the
    # plot with no visual cue that it had been cut). Size the ceiling to the
    # tallest bin actually in the data instead, with headroom, so the top of
    # every bar is always inside the visible plot area.
    max_count = int(counts.max()) if counts.size else 0
    y_top = max(10, max_count * 1.25)
    ax1.set_ylim(0.1, y_top)
    # Make the ceiling itself visible: a light boundary line plus a tick at
    # the top so it's clear the axis was sized to the tallest bar, not cut
    # off arbitrarily.
    ax1.axhline(y_top, color=SITE_LINE, linewidth=1, alpha=0.6)
    ax1.spines['top'].set_visible(True)
    ax1.spines['top'].set_color(SITE_LINE)

    ax2 = ax1.twinx()
    sns.kdeplot(data=df_time['viewer_count'], color=SITE_TALLY, linewidth=3, ax=ax2, label='Trend Line')
    ax2.set_ylabel('Density Trend', color=SITE_TALLY)
    ax2.get_yaxis().set_visible(False)

    plt.title(f'Viewer Distribution & Records: {label}')
    ax1.set_xlabel('Viewer Count')
    ax1.set_xlim(0, 80000)
    ax1.set_xticks(np.arange(0, 80001, 10000))

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper right')

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_distribution_viewers.png')); plt.close()

    median_v = float(df_time['viewer_count'].median())
    p90 = float(df_time['viewer_count'].quantile(0.9))
    share_under_1k = float((df_time['viewer_count'] < 1000).mean() * 100)
    desc = (f"The typical stream during {label} pulls a median of {median_v:,.0f} viewers, but the top 10% "
            f"of snapshots reach {p90:,.0f}+ \u2014 viewership is heavily right-skewed, dominated by a small "
            f"number of very large streams. About {share_under_1k:.0f}% of all snapshots sit under 1,000 "
            f"viewers. That's why averages elsewhere on this site can look inflated by a handful of giants: "
            f"medians and percentiles tell the more honest story of what a typical stream actually looks like.")
    return desc


def compute_chart_data(fact_subset, twitch_subset, game_info, fit_ml=True):
    """Lightweight, JSON-serializable numbers behind the interactive charts
    (q1, q2, q3, q6, q8, viewer distribution) -- the client renders these as
    hoverable/clickable SVG instead of a baked-pixel matplotlib image, which
    is also what makes arbitrary week/day granularity practical: re-running
    matplotlib for every day of every month would be far too slow, but this
    is just a handful of groupby/correlation calls.
    `fit_ml=False` skips the Random Forest fit behind q3 (used for single-day
    slices, where the sample is both too small and too slow to refit)."""
    data = {}

    if len(fact_subset) >= 2 and fact_subset['current_players'].nunique() > 1 and fact_subset['viewer_count'].nunique() > 1:
        try:
            r_val, p_val = pearsonr(fact_subset['current_players'], fact_subset['viewer_count'])
            sample = fact_subset if len(fact_subset) <= 600 else fact_subset.sample(600, random_state=42)
            data['q1'] = {
                'points': [{'x': round(float(r['current_players']), 1), 'y': round(float(r['viewer_count']), 1), 'game': str(r['game'])}
                           for _, r in sample.iterrows()],
                'r': round(float(r_val), 4),
                'p': float(p_val),
                'n': int(len(fact_subset)),
            }
        except Exception:
            pass

    if not fact_subset.empty:
        scores = fact_subset.groupby('game')['potential_score'].mean().sort_values(ascending=False)
        top5 = scores.head(5)
        remaining = scores.drop(top5.index)
        bottom5 = remaining.tail(5).sort_values(ascending=False)
        if len(top5):
            data['q2'] = {
                'top': [{'game': str(g), 'score': round(float(v), 3)} for g, v in top5.items()],
                'bottom': [{'game': str(g), 'score': round(float(v), 3)} for g, v in bottom5.items()],
            }

    if fit_ml:
        rf, subset, feats = _fit_rf(fact_subset, game_info)
        if rf is not None:
            importances = pd.Series(rf.feature_importances_, index=feats).sort_values(ascending=False)
            preds = rf.predict(subset[feats])
            data['q3'] = {
                'features': [{'feature': f, 'importance': round(float(v), 4)} for f, v in importances.items()],
                'r2': round(float(r2_score(subset['viewer_count'], preds)), 3),
                'mae': round(float(mean_absolute_error(subset['viewer_count'], preds)), 1),
                'n': int(len(subset)),
            }

    # Note: q6 (game market share by hour) moved to build_schedule_charts_data /
    # _compute_activity_series, since it now lives in the Timing Signals
    # section and shares that section's Timezone + Region controls instead
    # of only ever being UTC/global.

    if len(fact_subset) >= 3:
        df = fact_subset.sort_values(['game', 'date']).copy()
        df['next_day_growth'] = df.groupby('game')['viewer_count'].shift(-1) - df['viewer_count']
        df = df.dropna(subset=['next_day_growth', 'potential_score', 'viewer_count', 'peak_players'])
        if len(df) >= 3:
            try:
                r_potential, _ = pearsonr(df['potential_score'], df['next_day_growth'])
                r_viewers, _ = pearsonr(df['viewer_count'], df['next_day_growth'])
                r_peak, _ = pearsonr(df['peak_players'], df['next_day_growth'])
                data['q8'] = {
                    'metrics': [
                        {'label': 'Scoring Logic', 'r': round(float(r_potential), 4)},
                        {'label': 'Current Viewers', 'r': round(float(r_viewers), 4)},
                        {'label': 'Peak Players', 'r': round(float(r_peak), 4)},
                    ],
                    'n': int(len(df)),
                }
            except Exception:
                pass

    if not twitch_subset.empty:
        counts, edges = np.histogram(twitch_subset['viewer_count'], bins=40, range=(0, 80000))
        data['distribution'] = {
            'bins': [round(float(e), 0) for e in edges],
            'counts': [int(c) for c in counts],
            'median': round(float(twitch_subset['viewer_count'].median()), 1),
            'p90': round(float(twitch_subset['viewer_count'].quantile(0.9)), 1),
            'n': int(len(twitch_subset)),
        }

    return data


DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def build_game_recommendations(df_twitch_time, fact_table, game_info):
    game_info_norm = game_info.copy()
    if not game_info_norm.empty:
        game_info_norm['_norm_name'] = game_info_norm['Game_Name'].map(_normalize_name)

    games_out = []
    grouped = df_twitch_time.groupby('game_name')
    for game_name, g in grouped:
        n = len(g)
        if n < MIN_GAME_SAMPLES:
            continue

        avg_viewers = float(g['viewer_count'].mean())
        unique_streamers_total = int(g['user_id'].nunique())
        streamers = g.groupby(['snapshot_date', 'snapshot_time'])['user_id'].nunique()
        avg_streamers = float(streamers.mean()) if len(streamers) else 0.0
        viewer_per_streamer = avg_viewers if avg_streamers == 0 else float(
            g.groupby(['snapshot_date', 'snapshot_time'])['viewer_count'].sum().mean() / avg_streamers
        )

        by_date = g.groupby('snapshot_date')['viewer_count'].mean().sort_index()
        if len(by_date) >= 4:
            half = len(by_date) // 2
            first_half, second_half = by_date.iloc[:half].mean(), by_date.iloc[half:].mean()
            growth_pct = 0.0 if first_half == 0 else float((second_half - first_half) / first_half * 100)
            growth_pct = float(np.clip(growth_pct, -100, 300))
        else:
            growth_pct = 0.0

        confidence = float(np.clip(np.log1p(unique_streamers_total) / np.log1p(15), 0, 1))

        day_group_utc = g.groupby('day_of_week')['viewer_count'].mean().reindex(DAY_ORDER).dropna()
        best_day_utc = day_group_utc.idxmax() if len(day_group_utc) else None
        hour_group_utc = g.groupby('hour')['viewer_count'].mean()
        best_hour_utc = int(hour_group_utc.idxmax()) if len(hour_group_utc) else None

        day_group_local = g.groupby('day_of_week_local')['viewer_count'].mean().reindex(DAY_ORDER).dropna()
        best_day_local = day_group_local.idxmax() if len(day_group_local) else None
        hour_group_local = g.groupby('hour_local')['viewer_count'].mean()
        best_hour_local = int(hour_group_local.idxmax()) if len(hour_group_local) else None

        rec = {
            'game': game_name,
            'samples': int(n),
            'unique_streamers_seen': unique_streamers_total,
            'confidence': round(confidence, 2),
            'avg_viewers': round(avg_viewers, 1),
            'avg_concurrent_streamers': round(avg_streamers, 1),
            'viewers_per_streamer': round(viewer_per_streamer, 1),
            'growth_pct': round(growth_pct, 1),
            'best_day_utc': best_day_utc,
            'best_hour_utc': best_hour_utc,
            'by_day_utc': {d: round(float(v), 1) for d, v in day_group_utc.items()},
            'by_hour_utc': {int(h): round(float(v), 1) for h, v in hour_group_utc.items()},
            'best_day_local': best_day_local,
            'best_hour_local': best_hour_local,
            'by_day_local': {d: round(float(v), 1) for d, v in day_group_local.items()},
            'by_hour_local': {int(h): round(float(v), 1) for h, v in hour_group_local.items()},
        }

        if not game_info_norm.empty:
            match = game_info_norm[game_info_norm['_norm_name'] == _normalize_name(game_name)]
            if not match.empty:
                row = match.iloc[0]
                rec.update({
                    'price': float(row.get('Price', np.nan)) if pd.notna(row.get('Price', np.nan)) else None,
                    'free': bool(row['Free']) if pd.notna(row.get('Free', np.nan)) else None,
                    'genres': _safe_list(row.get('Genres')),
                    'total_reviews': int(row['Total_reviews']) if pd.notna(row.get('Total_reviews', np.nan)) else None,
                    'review_score': float(row['review_score']) if pd.notna(row.get('review_score', np.nan)) else None,
                    'review_score_desc': row.get('review_score_desc'),
                })

        if not fact_table.empty:
            fmatch = fact_table[fact_table['game'].map(_normalize_name) == _normalize_name(game_name)]
            if not fmatch.empty:
                rec['avg_current_players_steam'] = round(float(fmatch['current_players'].mean()), 1)
                rec['avg_peak_players_steam'] = round(float(fmatch['peak_players'].mean()), 1)
                rec['potential_score'] = round(float(fmatch['potential_score'].mean()), 3)

        games_out.append(rec)

    return games_out


def _safe_list(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return []
    if isinstance(val, list):
        return val
    try:
        import ast
        parsed = ast.literal_eval(val)
        return parsed if isinstance(parsed, list) else [str(val)]
    except Exception:
        return [str(val)]


def compute_opportunity_scores(games):
    if not games:
        return games
    avg_v = np.array([g['avg_viewers'] for g in games], dtype=float)
    vps = np.array([g['viewers_per_streamer'] for g in games], dtype=float)
    growth = np.array([g['growth_pct'] for g in games], dtype=float)

    def norm(x):
        lo, hi = np.percentile(x, 5), np.percentile(x, 95)
        if hi - lo < 1e-9:
            return np.zeros_like(x)
        return np.clip((x - lo) / (hi - lo), 0, 1)

    confidence = np.array([g.get('confidence', 1.0) for g in games], dtype=float)
    raw_score = 0.4 * norm(avg_v) + 0.35 * norm(vps) + 0.25 * norm(growth)
    final_score = raw_score * (0.35 + 0.65 * confidence)
    for g, s in zip(games, final_score):
        g['opportunity_score'] = round(float(s) * 100, 1)
    return sorted(games, key=lambda g: g['opportunity_score'], reverse=True)


def _compute_schedule_stats(df_twitch_time, day_col, hour_col):
    by_day = df_twitch_time.groupby(day_col).agg(
        total_viewers=('viewer_count', 'sum'), streamers=('user_id', 'nunique')
    ).reindex(DAY_ORDER)
    by_day['ratio'] = by_day['total_viewers'] / by_day['streamers']

    by_hour = df_twitch_time.groupby(hour_col).agg(
        total_viewers=('viewer_count', 'sum'), streamers=('user_id', 'nunique')
    )
    by_hour['ratio'] = by_hour['total_viewers'] / by_hour['streamers']

    heat = df_twitch_time.groupby([day_col, hour_col]).agg(
        total_viewers=('viewer_count', 'sum'), streamers=('user_id', 'nunique')
    ).reset_index()
    heat['ratio'] = heat['total_viewers'] / heat['streamers']

    day_ratio = by_day['ratio'].dropna()
    hour_ratio = by_hour['ratio'].dropna()
    if day_ratio.empty or hour_ratio.empty:
        return {}

    return {
        'best_day_overall': day_ratio.idxmax(),
        'best_hour_overall': int(hour_ratio.idxmax()),
        'by_day': {d: round(float(v), 1) for d, v in day_ratio.items()},
        'by_hour': {int(h): round(float(v), 1) for h, v in hour_ratio.items()},
        'heatmap': [
            {'day': r[day_col], 'hour': int(r[hour_col]), 'ratio': round(float(r['ratio']), 1)}
            for _, r in heat.dropna(subset=['ratio']).iterrows()
        ],
        'sample_count': int(len(df_twitch_time)),
    }


def build_schedule_recommendations(df_twitch_time):
    if df_twitch_time.empty:
        return {}

    schedule = {
        'standardized': _compute_schedule_stats(df_twitch_time, 'day_of_week', 'hour'),
        'time_of_day': _compute_schedule_stats(df_twitch_time, 'day_of_week_local', 'hour_local'),
    }

    by_country = {}
    if 'country' in df_twitch_time.columns:
        counts = df_twitch_time['country'].value_counts()
        for country, n in counts.items():
            if n < MIN_SAMPLES_FOR_COUNTRY_BREAKDOWN:
                continue
            sub = df_twitch_time[df_twitch_time['country'] == country]
            entry = {
                'standardized': _compute_schedule_stats(sub, 'day_of_week', 'hour'),
                'time_of_day': _compute_schedule_stats(sub, 'day_of_week_local', 'hour_local'),
            }
            if entry['standardized'] or entry['time_of_day']:
                by_country[country] = entry
    schedule['by_country'] = by_country
    return schedule


def _stack_by_game(df_time, axis_col, axis_values):
    """Consistent top-5-games-by-total-viewership + 'Others' stack across a
    given axis (day-of-week or hour-of-day), so the resulting chart keeps
    one stable game-to-color mapping across every bucket instead of
    reshuffling which games are shown/colored in each slot."""
    if df_time.empty or 'game_name' not in df_time.columns:
        return None
    total_by_game = df_time.groupby('game_name')['viewer_count'].sum().sort_values(ascending=False)
    top_games = total_by_game.head(5).index.tolist()
    if not top_games:
        return None
    axis_game = df_time.groupby([axis_col, 'game_name'])['viewer_count'].sum()
    stack = []
    for val in axis_values:
        axis_total = float(df_time.loc[df_time[axis_col] == val, 'viewer_count'].sum())
        segments = []
        accounted = 0.0
        for g in top_games:
            v = float(axis_game.get((val, g), 0.0))
            segments.append({'game': str(g), 'viewers': round(v, 1)})
            accounted += v
        others = max(0.0, axis_total - accounted)
        if others > 0:
            segments.append({'game': 'Others', 'viewers': round(others, 1)})
        stack.append({'key': val, 'segments': segments, 'total': round(axis_total, 1)})
    totals = {s['key']: s['total'] for s in stack}
    peak_key = max(totals, key=totals.get) if totals else None
    return {
        'stack': stack,
        'top_games_overall': [str(g) for g in top_games],
        'peak_key': peak_key,
        'peak_total': totals.get(peak_key, 0) if peak_key is not None else 0,
    }


def _compute_activity_series(df_time, day_col, hour_col, include_stacks=True):
    """Raw per-day / per-hour series behind Q4 (streamer activity by day),
    Q5 (viewer engagement by hour), Q6 (game market share by hour) and Q7
    (viewer/streamer ratio by day), broken out so the site can re-render
    them client-side for any timezone-mode + country combination without a
    Python re-run. `include_stacks=False` skips the (much bulkier) per-game
    breakdowns behind Q4's stacked view and Q6 -- used for single-day
    slices and per-country breakdowns, where a country x day x game (or
    country x hour x game) cross gets huge fast for little payoff."""
    if df_time.empty:
        return None

    by_day = df_time.groupby(day_col).agg(
        streamers=('user_id', 'nunique'),
        total_viewers=('viewer_count', 'sum'),
    ).reindex(DAY_ORDER)
    by_day['ratio'] = by_day['total_viewers'] / by_day['streamers']

    by_hour = df_time.groupby(hour_col)['viewer_count'].mean()

    result = {
        'daily_streamers': {d: (int(v) if pd.notna(v) else None) for d, v in by_day['streamers'].items()},
        'hourly_avg_viewers': {int(h): round(float(v), 1) for h, v in by_hour.items()},
        'daily_viewer_per_streamer': {d: (round(float(v), 1) if pd.notna(v) else None) for d, v in by_day['ratio'].items()},
        'sample_count': int(len(df_time)),
    }
    if include_stacks:
        day_stack = _stack_by_game(df_time, day_col, DAY_ORDER)
        hour_stack = _stack_by_game(df_time, hour_col, list(range(24)))
        if day_stack:
            result['daily_stack'] = day_stack['stack']
            result['daily_stack_games'] = day_stack['top_games_overall']
            result['daily_stack_peak_day'] = day_stack['peak_key']
        if hour_stack:
            result['hourly_stack'] = hour_stack['stack']
            result['hourly_stack_games'] = hour_stack['top_games_overall']
            result['peak_hour'] = hour_stack['peak_key']
            result['peak_hour_total'] = hour_stack['peak_total']
    return result


def build_schedule_charts_data(df_twitch_time, include_stacks=True):
    """Same country x timezone-mode matrix as build_schedule_recommendations,
    but for the Q4/Q5/Q6/Q7 series instead of the heatmap ratio."""
    if df_twitch_time.empty:
        return {}

    def modes_for(df, stacks):
        out = {}
        std = _compute_activity_series(df, 'day_of_week', 'hour', include_stacks=stacks)
        loc = _compute_activity_series(df, 'day_of_week_local', 'hour_local', include_stacks=stacks)
        if std:
            out['standardized'] = std
        if loc:
            out['time_of_day'] = loc
        return out

    result = {'ALL': modes_for(df_twitch_time, include_stacks)}
    if 'country' in df_twitch_time.columns:
        counts = df_twitch_time['country'].value_counts()
        for country, n in counts.items():
            if n < MIN_SAMPLES_FOR_COUNTRY_BREAKDOWN:
                continue
            sub = df_twitch_time[df_twitch_time['country'] == country]
            # Per-country breakdowns never get the (much bulkier) per-game
            # stacks -- a country x hour/day x game cross multiplies out
            # fast for comparatively little payoff. Q4/Q5/Q7's core metrics
            # are still fully available per country; Q6 and Q4's stacked
            # view fall back to "All regions" if a country lacks this.
            m = modes_for(sub, stacks=False)
            if m:
                result[country] = m
    return result


def build_gpu_market(gpu_df, out_dir):
    if gpu_df is None or gpu_df.empty:
        return {}

    df = gpu_df.copy()
    # The raw source data changed its price column name partway through the
    # tracked period: Feb-Apr (and part of May) call it 'price (us-dollar)',
    # May onward calls it 'price_usd'. Only ever reading 'price_usd' silently
    # dropped every Feb-Apr row (and part of May) as NaN. Coalesce both into
    # one canonical column so nothing gets lost.
    price_variants = ['price_usd', 'price (us-dollar)', 'Price']
    present_variants = [c for c in price_variants if c in df.columns]
    if not present_variants:
        return {}
    # Coalesce into a fresh column name first, THEN overwrite price_usd, so
    # we don't wipe out real price_usd data before reading it back out.
    coalesced = pd.Series(np.nan, index=df.index)
    for col in present_variants:
        coalesced = coalesced.fillna(df[col])
    df['price_usd'] = coalesced
    price_col = 'price_usd'
    name_col = 'gpu_name' if 'gpu_name' in df.columns else 'model'
    if name_col not in df.columns:
        return {}

    df = df.dropna(subset=[price_col, name_col])
    df = df[df[price_col] > 0]
    if df.empty:
        return {}

    month_avg = pd.Series(dtype=float)
    if 'source_month' in df.columns:
        month_avg = df.groupby('source_month')[price_col].mean().sort_index()

    model_avg = df.groupby(name_col)[price_col].mean().sort_values()

    os.makedirs(out_dir, exist_ok=True)
    chart_rel_path = os.path.join('assets', 'gpu', 'graph_gpu_price_trend.png')
    chart_abs_path = os.path.join(out_dir, 'graph_gpu_price_trend.png')

    plt.figure(figsize=(10, 5))
    if len(month_avg) >= 2:
        x = range(len(month_avg))
        plt.plot(x, month_avg.values, marker='o', color=SITE_CUE, linewidth=2.5, markersize=7)
        plt.fill_between(x, month_avg.values, color=SITE_CUE, alpha=0.14)
        plt.xticks(list(x), month_avg.index, rotation=20)
    else:
        plt.bar(month_avg.index.astype(str), month_avg.values, color=SITE_CUE)
    plt.title('GPU Market: Average Tracked Price by Month')
    plt.xlabel('Month')
    plt.ylabel('Average Price (USD)')
    plt.grid(True, axis='y', alpha=0.3)
    plt.tight_layout()
    plt.savefig(chart_abs_path)
    plt.close()

    cheapest = list(model_avg.head(5).items())
    priciest = list(model_avg.tail(5).items())[::-1]

    # Per-(year, model) pricing too, so the site can offer a year picker
    # instead of only ever showing every month lumped together.
    by_year_month = {}
    if 'source_month' in df.columns:
        for month_key, g in df.groupby('source_month'):
            if month_key == 'unknown' or '-' not in str(month_key):
                continue
            year = str(month_key).split('-')[0]
            by_year_month.setdefault(year, {})[str(month_key)] = round(float(g[price_col].mean()), 2)

    return {
        'avg_price_by_month': {str(m): round(float(v), 2) for m, v in month_avg.items()},
        'avg_price_by_year': {y: dict(sorted(m.items())) for y, m in sorted(by_year_month.items())},
        'cheapest_models': [{'model': str(k), 'avg_price': round(float(v), 2)} for k, v in cheapest],
        'priciest_models': [{'model': str(k), 'avg_price': round(float(v), 2)} for k, v in priciest],
        'total_models_tracked': int(df[name_col].nunique()),
        'chart': chart_rel_path.replace(os.sep, '/'),
    }


def _sanitize_for_json(obj):
    if isinstance(obj, float):
        return None if (np.isnan(obj) or np.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    return obj


def export_site_data(games, schedule, meta, gpu_market, generated_at, out_path):
    payload = _sanitize_for_json({
        'generated_at': generated_at.isoformat(),
        'last_updated_display': generated_at.strftime('%d/%m/%Y'),
        'meta': meta,
        'schedule': schedule,
        'games': games,
        'gpu_market': gpu_market,
    })
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(payload, f, indent=2, default=str, allow_nan=False)
    print(f"Wrote {len(games)} game recommendations to {out_path}")


INSIGHT_TITLES = {
    'q1': 'Steam players vs. Twitch viewers',
    'q2': 'Top games by potential score',
    'q3': 'What drives viewership',
    'q4': 'Streamer activity by day',
    'q5': 'Viewer engagement by hour',
    'q6': 'Peak-hour game market share',
    'q7': 'Viewer-per-streamer ratio by day',
    'q8': 'Predicting rising games',
    'distribution': 'Viewer count distribution',
}


def collect_insight_charts(period, assets_period_dir, desc_q1, desc_q2, desc_q3_and_summary,
                            desc_q4, desc_q5, desc_q6, desc_q7, desc_q8, desc_distribution):
    desc_q3, model_summary = desc_q3_and_summary if desc_q3_and_summary else (None, None)
    entries_spec = [
        ('q1', desc_q1, None),
        ('q2', desc_q2, None),
        ('q3', desc_q3, model_summary),
        ('q4', desc_q4, None),
        ('q5', desc_q5, None),
        ('q6', desc_q6, None),
        ('q7', desc_q7, None),
        ('q8', desc_q8, None),
        ('distribution', desc_distribution, None),
    ]
    charts = []
    for key, desc, model_summary_val in entries_spec:
        image_name = f'graph_distribution_viewers.png' if key == 'distribution' else f'graph_{key}.png'
        image_path = os.path.join(assets_period_dir, image_name)
        if desc is None or not os.path.exists(image_path):
            continue
        entry = {
            'key': key,
            'title': INSIGHT_TITLES[key],
            'image': f'assets/insights/{period}/{image_name}',
            'description': desc,
        }
        if model_summary_val:
            entry['model_summary'] = model_summary_val
        charts.append(entry)
    return charts


def export_insights_data(charts_by_period, schedule_charts_by_period, chart_data_by_period, generated_at, out_path):
    periods = [p for p in charts_by_period if charts_by_period[p]]
    all_countries = set()
    for period_data in schedule_charts_by_period.values():
        base = period_data.get('base', {}) if isinstance(period_data, dict) else {}
        for country in base:
            if country != 'ALL':
                all_countries.add(country)

    days_in_month = {}
    for p in periods:
        if p == 'GLOBAL':
            continue
        try:
            year, mon = p.split('-')
            days_in_month[p] = calendar.monthrange(int(year), int(mon))[1]
        except Exception:
            pass

    payload = _sanitize_for_json({
        'generated_at': generated_at.isoformat(),
        'last_updated_display': generated_at.strftime('%d/%m/%Y'),
        'periods': periods,
        'charts': {p: charts_by_period[p] for p in periods},
        'schedule_charts': {p: schedule_charts_by_period.get(p, {}) for p in periods},
        'chart_data': {p: chart_data_by_period.get(p, {}) for p in periods},
        'days_in_month': days_in_month,
        'countries': sorted(all_countries),
    })
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(payload, f, indent=2, default=str, allow_nan=False)
    print(f"Wrote insights for {len(periods)} period(s) to {out_path}")


def run_analysis():
    setup_initial_files()

    df_steam = load_data('steam')
    df_twitch = load_data('twitch')
    game_info_raw = load_data('game_data', tag_month=True)
    gpu = load_data('gpu', tag_month=True)  

    game_info = dedupe_game_info(game_info_raw)

    if df_steam.empty or df_twitch.empty:
        print("Steam or Twitch data missing entirely. Nothing to analyze.")
        return

    fact_table = prepare_fact_table(df_steam, df_twitch)
    df_twitch_time = prepare_twitch_time_data(df_twitch)

    orig_dir = os.getcwd()

    print("Generating Global Summary...")
    summary_dir = os.path.join(orig_dir, BASE_DIR, 'Global_Summary')
    os.makedirs(summary_dir, exist_ok=True)
    label = "GLOBAL_TOTAL"

    rf, subset, feats = _fit_rf(fact_table, game_info)

    d_q1 = q1_correlation(fact_table, label, summary_dir)
    d_q2 = q2_trends(fact_table, label, summary_dir)
    d_q3 = q3_ml_influence(rf, subset, feats, label, summary_dir)
    d_q4 = q4_daily_activity(df_twitch_time, label, summary_dir)

    hv_g, d_q5 = q5_hourly_engagement(df_twitch_time, label, summary_dir)
    d_q6 = q6_peak_hour_dominance(df_twitch_time, hv_g, label, summary_dir)
    d_q7 = q7_efficiency_ratio(df_twitch_time, label, summary_dir)

    d_dist = viewer_distribution(df_twitch_time, label, summary_dir)
    d_q8 = rising_trend_validation(fact_table, label, summary_dir)

    charts_by_period = {
        'GLOBAL': collect_insight_charts('GLOBAL', summary_dir, d_q1, d_q2, d_q3, d_q4, d_q5,
                                          d_q6, d_q7, d_q8, d_dist)
    }
    schedule_charts_by_period = {
        'GLOBAL': {'base': build_schedule_charts_data(df_twitch_time), 'weeks': {}, 'days': {}}
    }
    chart_data_by_period = {
        'GLOBAL': {'base': compute_chart_data(fact_table, df_twitch_time, game_info, fit_ml=True), 'weeks': {}, 'days': {}}
    }

    fact_table['year_month'] = pd.to_datetime(fact_table['date']).dt.to_period('M').astype(str)
    df_twitch_time['year_month'] = pd.to_datetime(df_twitch_time['started_at_dt']).dt.to_period('M').astype(str)

    for month in sorted(fact_table['year_month'].unique()):
        print(f"Processing Month: {month}")
        month_dir = os.path.join(orig_dir, BASE_DIR, 'Visualizations', month)
        os.makedirs(month_dir, exist_ok=True)

        m_fact = fact_table[fact_table['year_month'] == month]
        m_time = df_twitch_time[df_twitch_time['year_month'] == month]

        m_rf, m_subset, m_feats = _fit_rf(m_fact, game_info)

        md_q1 = q1_correlation(m_fact, month, month_dir)
        md_q2 = q2_trends(m_fact, month, month_dir)
        md_q3 = q3_ml_influence(m_rf, m_subset, m_feats, month, month_dir)
        md_q4 = q4_daily_activity(m_time, month, month_dir)

        hv, md_q5 = q5_hourly_engagement(m_time, month, month_dir)
        md_q6 = q6_peak_hour_dominance(m_time, hv, month, month_dir)
        md_q7 = q7_efficiency_ratio(m_time, month, month_dir)
        md_dist = viewer_distribution(m_time, month, month_dir)
        md_q8 = rising_trend_validation(m_fact, month, month_dir)

        month_assets_dir_rel = month
        charts_by_period[month] = collect_insight_charts(month_assets_dir_rel, month_dir, md_q1, md_q2, md_q3,
                                                           md_q4, md_q5, md_q6, md_q7, md_q8, md_dist)

        # Week (calendar week-within-month) and day breakdowns, for the
        # Deep Analysis page's Week/Day dropdowns. Cheap groupby/correlation
        # calls only -- no matplotlib, no per-day model refits -- so this
        # scales fine even across ~180 days of tracked history.
        wk_fact = m_fact.assign(week=m_fact['date'].map(week_of_month))
        wk_time = m_time.assign(week=m_time['date'].map(week_of_month))
        week_keys = sorted(set(wk_fact['week'].unique().tolist()) | set(wk_time['week'].unique().tolist()))
        weeks_chart_data, weeks_schedule = {}, {}
        for wk in week_keys:
            wk_fact_sub = wk_fact[wk_fact['week'] == wk]
            wk_time_sub = wk_time[wk_time['week'] == wk]
            weeks_chart_data[str(wk)] = compute_chart_data(wk_fact_sub, wk_time_sub, game_info, fit_ml=True)
            weeks_schedule[str(wk)] = build_schedule_charts_data(wk_time_sub)

        day_fact = m_fact.assign(day=m_fact['date'].map(lambda d: d.day))
        day_time = m_time.assign(day=m_time['date'].map(lambda d: d.day))
        day_keys = sorted(set(day_fact['day'].unique().tolist()) | set(day_time['day'].unique().tolist()))
        days_chart_data, days_schedule = {}, {}
        for dy in day_keys:
            dy_fact_sub = day_fact[day_fact['day'] == dy]
            dy_time_sub = day_time[day_time['day'] == dy]
            days_chart_data[f'{dy:02d}'] = compute_chart_data(dy_fact_sub, dy_time_sub, game_info, fit_ml=False)
            days_schedule[f'{dy:02d}'] = build_schedule_charts_data(dy_time_sub, include_stacks=False)

        chart_data_by_period[month] = {
            'base': compute_chart_data(m_fact, m_time, game_info, fit_ml=True),
            'weeks': weeks_chart_data,
            'days': days_chart_data,
        }
        schedule_charts_by_period[month] = {
            'base': build_schedule_charts_data(m_time),
            'weeks': weeks_schedule,
            'days': days_schedule,
        }

    print("Publishing insight charts to the website's assets folder...")
    insights_assets_dir = os.path.join(ASSETS_DIR, 'insights')
    global_assets_dir = os.path.join(insights_assets_dir, 'GLOBAL')
    os.makedirs(global_assets_dir, exist_ok=True)
    for f in glob.glob(os.path.join(summary_dir, '*.png')):
        shutil.copy(f, global_assets_dir)
    for month in sorted(fact_table['year_month'].unique()):
        month_src_dir = os.path.join(orig_dir, BASE_DIR, 'Visualizations', month)
        month_assets_dir = os.path.join(insights_assets_dir, month)
        os.makedirs(month_assets_dir, exist_ok=True)
        for f in glob.glob(os.path.join(month_src_dir, '*.png')):
            shutil.copy(f, month_assets_dir)

    generated_at = datetime.now(timezone.utc)
    export_insights_data(charts_by_period, schedule_charts_by_period, chart_data_by_period, generated_at,
                          os.path.join(SITE_DIR, 'insights.json'))

    print("Building game & schedule recommendations for the website...")
    games = build_game_recommendations(df_twitch_time, fact_table, game_info)
    games = compute_opportunity_scores(games)
    schedule = build_schedule_recommendations(df_twitch_time)
    gpu_market = build_gpu_market(gpu, GPU_ASSETS_DIR)
    meta = {
        'months_covered': sorted(fact_table['year_month'].unique().tolist()),
        'total_games_tracked': int(df_twitch_time['game_name'].nunique()),
        'total_games_with_recommendations': len(games),
        'total_streamers_seen': int(df_twitch_time['user_id'].nunique()),
        'total_twitch_snapshots': int(len(df_twitch_time)),
    }
    export_site_data(games, schedule, meta, gpu_market, generated_at, os.path.join(SITE_DIR, 'data.json'))

    print("Pipeline Execution Complete. Open index.html for the dashboard, "
          "or refresh data/Global_Summary and data/Visualizations for the charts.")


if __name__ == '__main__':
    run_analysis()