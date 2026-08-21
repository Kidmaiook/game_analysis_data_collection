import os
import glob
import json
import shutil
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


def load_data(category, tag_month=False):
    csv_files = glob.glob(os.path.join(RAW_DIR, category, '*.csv'))
    parquet_files = sorted(glob.glob(os.path.join(MONTHLY_DIR, '**', category, '*.parquet'), recursive=True))
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


def prepare_twitch_time_data(df_twitch):
    df = df_twitch.copy()
    df['started_at_dt'] = pd.to_datetime(df['started_at'])
    df['day_of_week'] = df['started_at_dt'].dt.day_name()
    df['hour'] = df['snapshot_time'].str.slice(0, 2).astype(int)

    snapshot_dt = pd.to_datetime(
        df['snapshot_date'].astype(str) + ' ' + df['snapshot_time'].astype(str).str.replace('-', ':', regex=False),
        errors='coerce',
    )
    offsets = df.get('language', pd.Series('', index=df.index)).map(LANGUAGE_UTC_OFFSETS).fillna(0)
    local_dt = snapshot_dt + pd.to_timedelta(offsets, unit='h')
    df['day_of_week_local'] = local_dt.dt.day_name().fillna(df['day_of_week'])
    df['hour_local'] = local_dt.dt.hour.fillna(df['hour']).astype(int)
    return df


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
    plt.title(f'Q1 Correlation ({label})')
    plt.xlabel('Average Current Players (Steam)')
    plt.ylabel('Total Viewer Count (Twitch)')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q1.png'))
    plt.close()

    desc = None
    with open(os.path.join(out_dir, 'desc_q1.txt'), 'w') as f:
        significance = "strong" if abs(r_val) > 0.7 else "moderate" if abs(r_val) > 0.4 else "weak"
        p_status = "statistically significant" if p_val < 0.05 else "not statistically significant"
        desc = (f"The Pearson correlation coefficient is {r_val:.2f} ({significance}).\n"
                f"The result is {p_status} (p = {p_val:.4f}) based on {n_observations} samples.")
        f.write(desc)
    return desc


def q2_trends(fact_table, label, out_dir):
    if fact_table.empty:
        return
    plt.figure(figsize=(14, 7))
    data = fact_table.groupby('game')['potential_score'].mean().sort_values(ascending=False).head(10)
    data.plot(kind='barh', color=SITE_CUE).invert_yaxis()
    plt.title(f'Q2 Top Games by Potential ({label})')
    plt.subplots_adjust(left=0.35)
    plt.savefig(os.path.join(out_dir, 'graph_q2.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q2.txt'), 'w') as f:
        top_game = data.index[0]
        desc = (f"Top game by potential score is '{top_game}'. This metric weighs viewer engagement "
                f"(60%) and player counts (40%) to find trending titles.")
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
    plt.title(f'Q3 Factor Importance ({label})')
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
        desc = (f"Random Forest Regression identifies '{top_feat}' as the most influential factor "
                f"on viewership for {label} (R2 Score: {r2:.2f}).")
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
    plt.title(f'Q4 Daily Activity ({label})')
    plt.xlabel('Day of the Week')
    plt.ylabel('Unique Streamers')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q4.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q4.txt'), 'w') as f:
        peak_day = data.idxmax()
        desc = (f"Streamer activity peaked on {peak_day} during {label}, showing when the creator "
                f"community is most active.")
        f.write(desc)
    return desc


def q5_hourly_engagement(df_time, label, out_dir):
    if df_time.empty:
        return pd.Series(dtype=float), None
    hv = df_time.groupby('hour')['viewer_count'].mean()
    plt.figure(figsize=(10, 5))
    plt.plot(hv.index, hv.values, marker='o', color=SITE_CUE)
    plt.title(f'Q5 Hourly Engagement ({label})')
    plt.xlabel('Hour of Day (24h)')
    plt.ylabel('Average Viewer Count')
    plt.xticks(range(0, 24))
    plt.savefig(os.path.join(out_dir, 'graph_q5.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q5.txt'), 'w') as f:
        desc = (f"Visualizes average viewership throughout a 24-hour cycle. Peak engagement occurs at "
                f"{hv.idxmax()}:00.")
        f.write(desc)
    return hv, desc


def q6_peak_hour_dominance(df_time, hv, label, out_dir):
    if hv.empty:
        return None
    pk = df_time[df_time['hour'] == hv.idxmax()].groupby('game_name')['viewer_count'].sum().sort_values(ascending=False).head(5)
    if pk.empty:
        return None
    fig, ax = plt.subplots(figsize=(10, 8))
    wedges, texts, autotexts = ax.pie(
        pk, autopct='%1.1f%%', startangle=90, counterclock=False,
        colors=SITE_ACCENT[:len(pk)] if len(pk) <= len(SITE_ACCENT) else sns.color_palette("husl", len(pk)), pctdistance=0.85,
    )
    ax.legend(wedges, pk.index, title="Games", loc="center left", bbox_to_anchor=(1, 0, 0.5, 1))
    ax.axis('equal')
    plt.title(f'Q6 Peak Hour Market Share ({label})')
    plt.savefig(os.path.join(out_dir, 'graph_q6.png'), bbox_inches='tight'); plt.close()

    with open(os.path.join(out_dir, 'desc_q6.txt'), 'w') as f:
        desc = ("Top 5 games sorted by market share during peak hours. Plotted from highest to lowest "
                "moving clockwise starting from the top.")
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
    plt.title(f'Q7 Viewer/Streamer Ratio ({label})')
    plt.xlabel('Day of the Week')
    plt.ylabel('Viewers per Streamer')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q7.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q7.txt'), 'w') as f:
        best_day = ratio.idxmax()
        desc = (f"The best viewer-per-streamer ratio is found on {best_day}. This indicates the most "
                f"efficient time for streamers to gain audience share.")
        f.write(desc)
    return desc


def rising_trend_validation(fact_table, label, out_dir):
    if len(fact_table) < 3:
        return None
    df = fact_table.sort_values(['game', 'date']).copy()
    df['next_day_growth'] = df.groupby('game')['viewer_count'].shift(-1) - df['viewer_count']
    df = df.dropna(subset=['next_day_growth'])
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
    plt.title(f'Q8: Predictive Power for Rising Trends ({label})')
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
        desc = ("Analysis: Can we use factors other than current viewer count to find rising stars?\n"
                 f"The most accurate lead indicator is '{winner}'.\n"
                 f"This proves that the Scoring Logic is {'' if winner == 'Scoring Logic' else 'NOT'} "
                 f"the superior method for picking games on the rise.")
        f.write(desc)
    return desc


def weight_analysis(rf, subset, feats, label, out_dir):
    if rf is None:
        return None
    importances = pd.DataFrame({'Feature': feats, 'Importance': rf.feature_importances_}).sort_values(
        by='Importance', ascending=False)
    plt.figure(figsize=(10, 6))
    sns.barplot(data=importances, x='Importance', y='Feature', hue='Feature', palette=site_sequential_palette(len(importances)), legend=False)
    plt.title(f'Q9: Dominant Success Indicators ({label})')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q9.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q9.txt'), 'w') as f:
        top_stat = importances.iloc[0]['Feature']
        weight = importances.iloc[0]['Importance'] * 100
        desc = (f"The most critical indicator for success is '{top_stat}', accounting for "
                f"{weight:.1f}% of the model's decision-making.")
        f.write(desc)
    return desc


def viewer_distribution(df_time, label, out_dir):
    if df_time.empty:
        return None
    fig, ax1 = plt.subplots(figsize=(12, 6))
    ax1.hist(df_time['viewer_count'], bins=80, range=(0, 80000), color=SITE_CUE, alpha=0.55,
             edgecolor=SITE_BG, label='Record Count', bottom=0.1, log=True)
    ax1.set_ylabel('Number of Records (Log Scale)', color=SITE_CUE)
    ax1.set_ylim(0.1, 1000)

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
    return ""


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
    }


def build_schedule_recommendations(df_twitch_time):
    if df_twitch_time.empty:
        return {}

    return {
        'standardized': _compute_schedule_stats(df_twitch_time, 'day_of_week', 'hour'),
        'time_of_day': _compute_schedule_stats(df_twitch_time, 'day_of_week_local', 'hour_local'),
    }


def build_gpu_market(gpu_df, out_dir):
    if gpu_df is None or gpu_df.empty:
        return {}

    df = gpu_df.copy()
    price_col = 'price_usd' if 'price_usd' in df.columns else 'Price'
    name_col = 'gpu_name' if 'gpu_name' in df.columns else 'model'
    if price_col not in df.columns or name_col not in df.columns:
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

    return {
        'avg_price_by_month': {str(m): round(float(v), 2) for m, v in month_avg.items()},
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


def export_site_data(games, schedule, meta, gpu_market, out_path):
    payload = _sanitize_for_json({
        'generated_at': datetime.now(timezone.utc).isoformat(),
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
    'q9': 'Dominant success indicators',
    'distribution': 'Viewer count distribution',
}


def collect_insight_charts(period, assets_period_dir, desc_q1, desc_q2, desc_q3_and_summary,
                            desc_q4, desc_q5, desc_q6, desc_q7, desc_q8, desc_q9, desc_distribution):
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
        ('q9', desc_q9, None),
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


def export_insights_data(charts_by_period, out_path):
    periods = [p for p in charts_by_period if charts_by_period[p]]
    payload = _sanitize_for_json({
        'periods': periods,
        'charts': {p: charts_by_period[p] for p in periods},
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
    d_q9 = weight_analysis(rf, subset, feats, label, summary_dir)

    charts_by_period = {
        'GLOBAL': collect_insight_charts('GLOBAL', summary_dir, d_q1, d_q2, d_q3, d_q4, d_q5,
                                          d_q6, d_q7, d_q8, d_q9, d_dist)
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
        md_q9 = weight_analysis(m_rf, m_subset, m_feats, month, month_dir)

        month_assets_dir_rel = month
        charts_by_period[month] = collect_insight_charts(month_assets_dir_rel, month_dir, md_q1, md_q2, md_q3,
                                                           md_q4, md_q5, md_q6, md_q7, md_q8, md_q9, md_dist)

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

    export_insights_data(charts_by_period, os.path.join(SITE_DIR, 'insights.json'))

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
    export_site_data(games, schedule, meta, gpu_market, os.path.join(SITE_DIR, 'data.json'))

    print("Pipeline Execution Complete. Open index.html for the dashboard, "
          "or refresh data/Global_Summary and data/Visualizations for the charts.")


if __name__ == '__main__':
    run_analysis()