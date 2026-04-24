"""Deep inspect ESPN summary - rosters + boxscore for season stats"""
import json

import requests

r = requests.get('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard')
data = r.json()
events = data.get('events', [])
event_id = events[0].get('id')
print(f"Event: {events[0].get('shortName')} id={event_id}")

summary = requests.get(f'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={event_id}')
s = summary.json()

# Check roster athlete for season stats
print("\n=== ROSTER PLAYER FULL DETAIL ===")
for roster in s.get('rosters', []):
    team = roster.get('team', {})
    print(f"\n{team.get('abbreviation')} roster:")
    for p in roster.get('roster', []):
        ath = p.get('athlete', {})
        stats = p.get('stats', [])
        stats_map = {}
        for st in stats:
            stats_map[st['abbreviation']] = st['displayValue']
        print(f"  #{p.get('jersey','')} {ath.get('displayName','')} ({p.get('position',{}).get('abbreviation','')}) batOrder={p.get('batOrder','')} "
              f"H={stats_map.get('H','-')} AB={stats_map.get('AB','-')} HR={stats_map.get('HR','-')} RBI={stats_map.get('RBI','-')} SB={stats_map.get('SB','-')}")
        # Check for season stats or additional athlete data
        ath_keys = list(ath.keys())
        print(f"    athlete keys: {ath_keys}")
        if 'statistics' in ath:
            print(f"    athlete.statistics: {ath['statistics']}")
        if 'stats' in ath:
            print(f"    athlete.stats: {ath['stats']}")
        break  # Just first player per team

# Check boxscore batting more fully
print("\n=== BOXSCORE BATTING FULL ===")
for psec in s.get('boxscore', {}).get('players', []):
    team = psec.get('team', {})
    print(f"\n{team.get('abbreviation')} boxscore batting:")
    for ss in psec.get('statistics', []):
        if ss.get('type') == 'batting':
            labels = ss.get('labels', [])
            print(f"  Labels: {labels}")
            totals = ss.get('totals', [])
            print(f"  Totals: {totals}")
            for a in ss.get('athletes', []):
                ath = a.get('athlete', {})
                stats = a.get('stats', [])
                # Check if stats array includes AVG
                print(f"  {ath.get('displayName','')} ({ath.get('position',{}).get('abbreviation','')}) "
                      f"batOrder={a.get('batOrder','')} stats={stats} (len={len(stats)})")
            break

# Check if there's a way to get season batting average
# Try to get athlete details for first player
print("\n=== CHECKING ATHLETE SEASON STATS ===")
first_roster = s.get('rosters', [{}])[0]
first_player = first_roster.get('roster', [{}])[0]
ath = first_player.get('athlete', {})
ath_id = ath.get('id', '')
print(f"Player: {ath.get('displayName')} id={ath_id}")

# Check the full athlete object
print(f"Full athlete keys: {list(ath.keys())}")
if 'headshot' in ath:
    hs = ath['headshot']
    print(f"  headshot type: {type(hs)}")
    if isinstance(hs, dict):
        print(f"  headshot: {hs.get('href', hs)}")
    else:
        print(f"  headshot: {hs}")

# Check the leaders from the scoreboard (these have season stats)
print("\n=== SCOREBOARD LEADERS (season stats) ===")
comp = events[0].get('competitions', [{}])[0]
for team in comp.get('competitors', []):
    tinfo = team.get('team', {})
    print(f"\n{tinfo.get('abbreviation')} leaders:")
    for l in team.get('leaders', []):
        cat = l.get('displayName', '')
        for leader in l.get('leaders', []):
            ath = leader.get('athlete', {})
            print(f"  {cat}: {ath.get('displayName')} = {leader.get('displayValue')}")
            # Check for season statistics on the athlete
            if 'statistics' in ath:
                print(f"    athlete.statistics: {ath['statistics']}")
