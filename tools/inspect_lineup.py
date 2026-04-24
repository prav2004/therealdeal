"""Inspect ESPN game summary for batting lineup data"""
import json

import requests

# Get today's scoreboard to find an event ID
r = requests.get('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard')
data = r.json()
events = data.get('events', [])

if not events:
    print("No events today")
    exit()

# Pick first game
ev = events[0]
event_id = ev.get('id')
print(f"Event: {ev.get('shortName')} id={event_id}")

# Hit the summary/detail endpoint
summary = requests.get(f'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={event_id}')
s = summary.json()

print(f"\n=== TOP-LEVEL KEYS ===")
print(list(s.keys()))

# Check for rosters
if 'rosters' in s:
    print(f"\n=== ROSTERS ({len(s['rosters'])}) ===")
    for i, roster in enumerate(s['rosters']):
        team_info = roster.get('team', {})
        print(f"\nTeam {i}: {team_info.get('displayName', 'Unknown')} ({team_info.get('abbreviation', '?')})")
        print(f"  Roster keys: {list(roster.keys())}")
        entries = roster.get('roster', [])
        print(f"  Players: {len(entries)}")
        for j, p in enumerate(entries[:5]):
            print(f"    [{j}] keys={list(p.keys())}")
            ath = p.get('athlete', {}) if 'athlete' in p else p
            print(f"        name={ath.get('displayName', '?')} pos={p.get('position', {}).get('abbreviation', '?')}")
            if 'starter' in p:
                print(f"        starter={p['starter']}")
            if 'batOrder' in p:
                print(f"        batOrder={p['batOrder']}")
            if 'statistics' in p:
                print(f"        statistics keys={list(p['statistics'].keys()) if isinstance(p['statistics'], dict) else 'array'}")
            if 'stats' in p:
                print(f"        stats={p['stats'][:5]}")

# Check for boxscore
if 'boxscore' in s:
    print(f"\n=== BOXSCORE ===")
    box = s['boxscore']
    print(f"  Keys: {list(box.keys())}")
    
    if 'players' in box:
        print(f"\n  Players sections: {len(box['players'])}")
        for i, psec in enumerate(box['players']):
            team = psec.get('team', {})
            print(f"\n  Team {i}: {team.get('displayName', '?')} ({team.get('abbreviation', '?')})")
            print(f"    Keys: {list(psec.keys())}")
            
            stats_sections = psec.get('statistics', [])
            for ss in stats_sections:
                print(f"    Stat group: {ss.get('name', '?')} ({ss.get('type', '?')})")
                print(f"      Labels: {ss.get('labels', [])[:10]}")
                athletes = ss.get('athletes', [])
                print(f"      Athletes: {len(athletes)}")
                for j, a in enumerate(athletes[:4]):
                    ath = a.get('athlete', {})
                    print(f"        [{j}] {ath.get('displayName','?')} starter={a.get('starter','')} batOrder={a.get('batOrder','')}")
                    print(f"            stats={a.get('stats', [])[:8]}")
                    if j == 0:
                        print(f"            athlete keys={list(ath.keys())}")

# Check for gameInfo
if 'gameInfo' in s:
    gi = s['gameInfo']
    print(f"\n=== GAME INFO ===")
    print(f"  Keys: {list(gi.keys())}")

# Check header
if 'header' in s:
    h = s['header']
    print(f"\n=== HEADER ===")
    print(f"  Keys: {list(h.keys())}")
    comps = h.get('competitions', [])
    if comps:
        c0 = comps[0]
        print(f"  Competition keys: {list(c0.keys())}")
        for comp in c0.get('competitors', []):
            print(f"    {comp.get('team', {}).get('abbreviation','?')}: roster len={len(comp.get('roster', []))}")
            for p in comp.get('roster', [])[:3]:
                print(f"      {p.get('displayName','?')} pos={p.get('position','?')} batOrder={p.get('batOrder','?')}")

print("\n=== DONE ===")
