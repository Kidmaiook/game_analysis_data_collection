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

sns.set_theme(style="whitegrid")

BASE_DIR = 'Data'
RAW_DIR = os.path.join(BASE_DIR, 'raw')
MONTHLY_DIR = os.path.join(BASE_DIR, 'monthly')
SITE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
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
    except ImportError:
        try:
            from parquet_fallback import read_parquet as fallback_read
            return fallback_read(path)
        except Exception as e:
            warnings.warn(f"No parquet engine available and fallback reader "
                           f"failed for {path}: {e}")
            return None
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


def prepare_twitch_time_data(df_twitch):
    df = df_twitch.copy()
    df['started_at_dt'] = pd.to_datetime(df['started_at'])
    df['day_of_week'] = df['started_at_dt'].dt.day_name()
    df['hour'] = df['snapshot_time'].str.slice(0, 2).astype(int)
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
        line_kws={'color': 'red', 'label': 'Regression Line'},
        scatter_kws={'alpha': 0.5},
    )
    stats_text = f"Pearson r: {r_val:.3f}\np-value: {p_val:.3e}\nn: {n_observations}"
    plt.gca().text(0.05, 0.95, stats_text, transform=plt.gca().transAxes, fontsize=12,
                    verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))
    plt.title(f'Q1 Correlation ({label})')
    plt.xlabel('Average Current Players (Steam)')
    plt.ylabel('Total Viewer Count (Twitch)')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q1.png'))
    plt.close()

    with open(os.path.join(out_dir, 'desc_q1.txt'), 'w') as f:
        significance = "strong" if abs(r_val) > 0.7 else "moderate" if abs(r_val) > 0.4 else "weak"
        p_status = "statistically significant" if p_val < 0.05 else "not statistically significant"
        f.write(f"The Pearson correlation coefficient is {r_val:.2f} ({significance}).\n")
        f.write(f"The result is {p_status} (p = {p_val:.4f}) based on {n_observations} samples.")


def q2_trends(fact_table, label, out_dir):
    if fact_table.empty:
        return
    plt.figure(figsize=(14, 7))
    data = fact_table.groupby('game')['potential_score'].mean().sort_values(ascending=False).head(10)
    data.plot(kind='barh', color='teal').invert_yaxis()
    plt.title(f'Q2 Top Games by Potential ({label})')
    plt.subplots_adjust(left=0.35)
    plt.savefig(os.path.join(out_dir, 'graph_q2.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q2.txt'), 'w') as f:
        top_game = data.index[0]
        f.write(f"Top game by potential score is '{top_game}'. This metric weighs viewer engagement "
                f"(60%) and player counts (40%) to find trending titles.")


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
        return
    importances = pd.Series(rf.feature_importances_, index=feats).sort_values()
    plt.figure(figsize=(10, 6))
    importances.plot(kind='barh', color='orange')
    plt.title(f'Q3 Factor Importance ({label})')
    plt.xlabel('Importance Score')
    plt.ylabel('Features')
    plt.subplots_adjust(left=0.25)
    plt.savefig(os.path.join(out_dir, 'graph_q3.png')); plt.close()

    preds = rf.predict(subset[feats])
    mae = mean_absolute_error(subset['viewer_count'], preds)
    r2 = r2_score(subset['viewer_count'], preds)

    with open(os.path.join(out_dir, 'model_and_data_summary.txt'), 'w') as f:
        f.write(f"SUMMARY FOR: {label}\nMAE: {mae:.2f}\nR2: {r2:.2f}\n\nSTATS:\n"
                f"{subset[feats + ['viewer_count']].describe().to_string()}")
    with open(os.path.join(out_dir, 'desc_q3.txt'), 'w') as f:
        top_feat = importances.index[-1]
        f.write(f"Random Forest Regression identifies '{top_feat}' as the most influential factor "
                f"on viewership for {label} (R2 Score: {r2:.2f}).")


def q4_daily_activity(df_time, label, out_dir):
    if df_time.empty:
        return
    plt.figure(figsize=(10, 6))
    order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    data = df_time.groupby('day_of_week')['user_id'].nunique().reindex(order)
    sns.barplot(x=data.index, y=data.values, hue=data.index, palette='magma', legend=False)
    plt.xticks(rotation=30)
    plt.title(f'Q4 Daily Activity ({label})')
    plt.xlabel('Day of the Week')
    plt.ylabel('Unique Streamers')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q4.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q4.txt'), 'w') as f:
        peak_day = data.idxmax()
        f.write(f"Streamer activity peaked on {peak_day} during {label}, showing when the creator "
                f"community is most active.")


def q5_hourly_engagement(df_time, label, out_dir):
    if df_time.empty:
        return pd.Series(dtype=float)
    hv = df_time.groupby('hour')['viewer_count'].mean()
    plt.figure(figsize=(10, 5))
    plt.plot(hv.index, hv.values, marker='o', color='blue')
    plt.title(f'Q5 Hourly Engagement ({label})')
    plt.xlabel('Hour of Day (24h)')
    plt.ylabel('Average Viewer Count')
    plt.xticks(range(0, 24))
    plt.savefig(os.path.join(out_dir, 'graph_q5.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q5.txt'), 'w') as f:
        f.write(f"Visualizes average viewership throughout a 24-hour cycle. Peak engagement occurs at "
                f"{hv.idxmax()}:00.")
    return hv


def q6_peak_hour_dominance(df_time, hv, label, out_dir):
    if hv.empty:
        return
    pk = df_time[df_time['hour'] == hv.idxmax()].groupby('game_name')['viewer_count'].sum().sort_values(ascending=False).head(5)
    if pk.empty:
        return
    fig, ax = plt.subplots(figsize=(10, 8))
    wedges, texts, autotexts = ax.pie(
        pk, autopct='%1.1f%%', startangle=90, counterclock=False,
        colors=sns.color_palette("viridis", len(pk)), pctdistance=0.85,
    )
    ax.legend(wedges, pk.index, title="Games", loc="center left", bbox_to_anchor=(1, 0, 0.5, 1))
    ax.axis('equal')
    plt.title(f'Q6 Peak Hour Market Share ({label})')
    plt.savefig(os.path.join(out_dir, 'graph_q6.png'), bbox_inches='tight'); plt.close()

    with open(os.path.join(out_dir, 'desc_q6.txt'), 'w') as f:
        f.write("Top 5 games sorted by market share during peak hours. Plotted from highest to lowest "
                "moving clockwise starting from the top.")


def q7_efficiency_ratio(df_time, label, out_dir):
    if df_time.empty:
        return
    plt.figure(figsize=(10, 5))
    order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    ds = df_time.groupby('day_of_week').agg(viewer_count=('viewer_count', 'sum'), user_id=('user_id', 'nunique')).reindex(order)
    ratio = ds['viewer_count'] / ds['user_id']
    plt.plot(ratio.index, ratio.values, marker='s', color='green', linewidth=2)
    plt.xticks(rotation=30)
    plt.title(f'Q7 Viewer/Streamer Ratio ({label})')
    plt.xlabel('Day of the Week')
    plt.ylabel('Viewers per Streamer')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q7.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q7.txt'), 'w') as f:
        best_day = ratio.idxmax()
        f.write(f"The best viewer-per-streamer ratio is found on {best_day}. This indicates the most "
                f"efficient time for streamers to gain audience share.")


def rising_trend_validation(fact_table, label, out_dir):
    if len(fact_table) < 3:
        return
    df = fact_table.sort_values(['game', 'date']).copy()
    df['next_day_growth'] = df.groupby('game')['viewer_count'].shift(-1) - df['viewer_count']
    df = df.dropna(subset=['next_day_growth'])
    if len(df) < 3:
        return

    r_potential, _ = pearsonr(df['potential_score'], df['next_day_growth'])
    r_viewers, _ = pearsonr(df['viewer_count'], df['next_day_growth'])
    r_peak, _ = pearsonr(df['peak_players'], df['next_day_growth'])

    plt.figure(figsize=(10, 6))
    metrics = ['Scoring Logic', 'Current Viewers', 'Peak Players']
    values = [r_potential, r_viewers, r_peak]
    colors = ['#2ca02c' if v == max(values) else '#7f7f7f' for v in values]
    bars = plt.bar(metrics, values, color=colors)
    plt.title(f'Q8: Predictive Power for Rising Trends ({label})')
    plt.ylabel('Correlation with Future Viewer Growth')
    plt.axhline(0, color='black', linewidth=0.8)
    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2, yval, f'{yval:.3f}',
                  va='bottom' if yval > 0 else 'top', ha='center', fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q8.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q8.txt'), 'w', encoding='utf-8') as f:
        winner = metrics[int(np.argmax(values))]
        f.write("Analysis: Can we use factors other than current viewer count to find rising stars?\n")
        f.write(f"The most accurate lead indicator is '{winner}'.\n")
        f.write(f"This proves that the Scoring Logic is {'' if winner == 'Scoring Logic' else 'NOT'} "
                f"the superior method for picking games on the rise.")


def weight_analysis(rf, subset, feats, label, out_dir):
    if rf is None:
        return
    importances = pd.DataFrame({'Feature': feats, 'Importance': rf.feature_importances_}).sort_values(
        by='Importance', ascending=False)
    plt.figure(figsize=(10, 6))
    sns.barplot(data=importances, x='Importance', y='Feature', hue='Feature', palette='viridis', legend=False)
    plt.title(f'Q9: Dominant Success Indicators ({label})')
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'graph_q9.png')); plt.close()

    with open(os.path.join(out_dir, 'desc_q9.txt'), 'w') as f:
        top_stat = importances.iloc[0]['Feature']
        weight = importances.iloc[0]['Importance'] * 100
        f.write(f"The most critical indicator for success is '{top_stat}', accounting for "
                f"{weight:.1f}% of the model's decision-making.")


def viewer_distribution(df_time, label, out_dir):
    if df_time.empty:
        return
    fig, ax1 = plt.subplots(figsize=(12, 6))
    ax1.hist(df_time['viewer_count'], bins=80, range=(0, 80000), color='purple', alpha=0.7,
             edgecolor='black', label='Record Count', bottom=0.1, log=True)
    ax1.set_ylabel('Number of Records (Log Scale)', color='purple')
    ax1.set_ylim(0.1, 1000)

    ax2 = ax1.twinx()
    sns.kdeplot(data=df_time['viewer_count'], color='red', linewidth=3, ax=ax2, label='Trend Line')
    ax2.set_ylabel('Density Trend', color='red')
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

        day_group = g.groupby('day_of_week')['viewer_count'].mean()
        day_group = day_group.reindex(DAY_ORDER).dropna()
        best_day = day_group.idxmax() if len(day_group) else None

        hour_group = g.groupby('hour')['viewer_count'].mean()
        best_hour = int(hour_group.idxmax()) if len(hour_group) else None

        rec = {
            'game': game_name,
            'samples': int(n),
            'unique_streamers_seen': unique_streamers_total,
            'confidence': round(confidence, 2),
            'avg_viewers': round(avg_viewers, 1),
            'avg_concurrent_streamers': round(avg_streamers, 1),
            'viewers_per_streamer': round(viewer_per_streamer, 1),
            'growth_pct': round(growth_pct, 1),
            'best_day': best_day,
            'best_hour': best_hour,
            'by_day': {d: round(float(v), 1) for d, v in day_group.items()},
            'by_hour': {int(h): round(float(v), 1) for h, v in hour_group.items()},
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


def build_schedule_recommendations(df_twitch_time):
    if df_twitch_time.empty:
        return {}

    by_day = df_twitch_time.groupby('day_of_week').agg(
        total_viewers=('viewer_count', 'sum'), streamers=('user_id', 'nunique')
    ).reindex(DAY_ORDER)
    by_day['ratio'] = by_day['total_viewers'] / by_day['streamers']

    by_hour = df_twitch_time.groupby('hour').agg(
        total_viewers=('viewer_count', 'sum'), streamers=('user_id', 'nunique')
    )
    by_hour['ratio'] = by_hour['total_viewers'] / by_hour['streamers']

    heat = df_twitch_time.groupby(['day_of_week', 'hour']).agg(
        total_viewers=('viewer_count', 'sum'), streamers=('user_id', 'nunique')
    ).reset_index()
    heat['ratio'] = heat['total_viewers'] / heat['streamers']

    return {
        'best_day_overall': by_day['ratio'].idxmax(),
        'best_hour_overall': int(by_hour['ratio'].idxmax()),
        'by_day': {d: round(float(v), 1) for d, v in by_day['ratio'].dropna().items()},
        'by_hour': {int(h): round(float(v), 1) for h, v in by_hour['ratio'].dropna().items()},
        'heatmap': [
            {'day': r['day_of_week'], 'hour': int(r['hour']), 'ratio': round(float(r['ratio']), 1)}
            for _, r in heat.dropna(subset=['ratio']).iterrows()
        ],
    }


def _sanitize_for_json(obj):
    if isinstance(obj, float):
        return None if (np.isnan(obj) or np.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    return obj


def export_site_data(games, schedule, meta, out_path):
    payload = _sanitize_for_json({
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'meta': meta,
        'schedule': schedule,
        'games': games,
    })
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(payload, f, indent=2, default=str, allow_nan=False)
    print(f"Wrote {len(games)} game recommendations to {out_path}")


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

    q1_correlation(fact_table, label, summary_dir)
    q2_trends(fact_table, label, summary_dir)
    q3_ml_influence(rf, subset, feats, label, summary_dir)
    q4_daily_activity(df_twitch_time, label, summary_dir)

    hv_g = q5_hourly_engagement(df_twitch_time, label, summary_dir)
    q6_peak_hour_dominance(df_twitch_time, hv_g, label, summary_dir)
    q7_efficiency_ratio(df_twitch_time, label, summary_dir)

    viewer_distribution(df_twitch_time, label, summary_dir)
    rising_trend_validation(fact_table, label, summary_dir)
    weight_analysis(rf, subset, feats, label, summary_dir)

    fact_table['year_month'] = pd.to_datetime(fact_table['date']).dt.to_period('M').astype(str)
    df_twitch_time['year_month'] = pd.to_datetime(df_twitch_time['started_at_dt']).dt.to_period('M').astype(str)

    for month in sorted(fact_table['year_month'].unique()):
        print(f"Processing Month: {month}")
        month_dir = os.path.join(orig_dir, BASE_DIR, 'Visualizations', month)
        os.makedirs(month_dir, exist_ok=True)

        m_fact = fact_table[fact_table['year_month'] == month]
        m_time = df_twitch_time[df_twitch_time['year_month'] == month]

        m_rf, m_subset, m_feats = _fit_rf(m_fact, game_info)

        q1_correlation(m_fact, month, month_dir)
        q2_trends(m_fact, month, month_dir)
        q3_ml_influence(m_rf, m_subset, m_feats, month, month_dir)
        q4_daily_activity(m_time, month, month_dir)

        hv = q5_hourly_engagement(m_time, month, month_dir)
        q6_peak_hour_dominance(m_time, hv, month, month_dir)
        q7_efficiency_ratio(m_time, month, month_dir)
        viewer_distribution(m_time, month, month_dir)
        rising_trend_validation(m_fact, month, month_dir)
        weight_analysis(m_rf, m_subset, m_feats, month, month_dir)

    print("Building game & schedule recommendations for the website...")
    games = build_game_recommendations(df_twitch_time, fact_table, game_info)
    games = compute_opportunity_scores(games)
    schedule = build_schedule_recommendations(df_twitch_time)
    meta = {
        'months_covered': sorted(fact_table['year_month'].unique().tolist()),
        'total_games_tracked': int(df_twitch_time['game_name'].nunique()),
        'total_games_with_recommendations': len(games),
        'total_streamers_seen': int(df_twitch_time['user_id'].nunique()),
        'total_twitch_snapshots': int(len(df_twitch_time)),
    }
    export_site_data(games, schedule, meta, os.path.join(SITE_DIR, 'data.json'))

    print("Pipeline Execution Complete. Open site/index.html for the dashboard, "
          "or refresh Data/Global_Summary and Data/Visualizations for the charts.")


if __name__ == '__main__':
    run_analysis()
